import json
import os
import unittest
from unittest import mock

from fastapi import FastAPI
from fastapi.testclient import TestClient

import whatsapp_agent as wa
from test_agent_actions import CO, MemStore, seed, slot

SECRET = "router-secret"
OPS_PHONE = "27821234567"
CONS_PHONE = "27829998888"


class Model:
    """Scripted model: returns queued replies and records the payloads it was given."""

    def __init__(self, *replies):
        self.replies, self.payloads, self.systems = list(replies), [], []

    def __call__(self, system, payload, max_tokens, mime):
        self.systems.append(system)
        self.payloads.append(json.loads(json.dumps(payload, default=str)))
        return self.replies.pop(0)


def call(name, args, reply=""):
    return json.dumps({"reply": reply, "toolCall": {"name": name, "arguments": args}})


def say(text):
    return json.dumps({"reply": text, "toolCall": None})


class WhatsAppAgentTests(unittest.TestCase):
    def setUp(self):
        self.db = seed()
        self.db.data["users"]["ops1"]["whatsappPhoneNumbers"] = [OPS_PHONE]
        self.db.data["users"]["cons1"].update(phone="082 999 8888", phoneIsWhatsApp=True)
        self.env = mock.patch.dict(os.environ, {"WHATSAPP_ROUTER_SECRET": SECRET, "QTX_WHATSAPP_ROUTER_SECRET": "", "AGENT_ACTIONS_ENABLED": "true"})
        self.env.start()
        self.addCleanup(self.env.stop)
        patch = mock.patch.object(wa, "ProposalStore", MemStore)  # in-memory claim; real one needs a live transaction
        patch.start()
        self.addCleanup(patch.stop)

    def client(self, *replies):
        self.model = Model(*replies)
        app = FastAPI()
        app.include_router(wa.create_whatsapp_agent_router(self.db, self.model, json.loads, "You are Q."))
        return TestClient(app)

    @staticmethod
    def headers(secret=SECRET):
        return {"X-WhatsApp-Router-Secret": secret}

    @staticmethod
    def body(message="hi", user="ops1", phone=OPS_PHONE):
        return {"channel": "whatsapp", "userId": user, "phone": phone, "message": message}

    # ---- authentication --------------------------------------------------------------------

    def test_requires_router_secret(self):
        c = self.client()
        self.assertEqual(c.post("/api/whatsapp/agent", json=self.body()).status_code, 401)
        self.assertEqual(c.post("/api/whatsapp/agent", json=self.body(), headers=self.headers("nope")).status_code, 401)
        self.assertEqual(self.model.payloads, [])

    def test_fails_closed_when_secret_unset(self):
        with mock.patch.dict(os.environ, {"WHATSAPP_ROUTER_SECRET": ""}):
            r = self.client().post("/api/whatsapp/agent", json=self.body(), headers=self.headers(""))
        self.assertEqual(r.status_code, 503)

    def test_engine_specific_secret_accepted(self):
        with mock.patch.dict(os.environ, {"WHATSAPP_ROUTER_SECRET": "", "QTX_WHATSAPP_ROUTER_SECRET": "qtx-only"}):
            r = self.client(say("Hello")).post("/api/whatsapp/agent", json=self.body(), headers=self.headers("qtx-only"))
        self.assertEqual(r.status_code, 200)

    def test_phone_must_belong_to_claimed_user(self):
        c = self.client(say("x"))
        for body in (self.body(phone="27820000000"), self.body(user="ghost"), self.body(user="cons1", phone=OPS_PHONE)):
            r = c.post("/api/whatsapp/agent", json=body, headers=self.headers())
            self.assertEqual((r.status_code, r.json()["error"]["code"]), (403, "IDENTITY_MISMATCH"), body)
        self.assertEqual(self.model.payloads, [])  # the model is never reached

    def test_phone_matching_rules(self):
        user = {"whatsappPhoneNumbers": ["+27 82 123 4567"], "phone": "0829998888", "phoneIsWhatsApp": True, "alternativePhone": "0831112222"}
        self.assertTrue(wa.phone_matches_user(user, "27821234567"))
        self.assertTrue(wa.phone_matches_user(user, "+27829998888"))      # local-format marked number
        self.assertFalse(wa.phone_matches_user(user, "27831112222"))       # alternative not marked as WhatsApp
        self.assertFalse(wa.phone_matches_user(user, "1234"))              # too short to compare
        self.assertFalse(wa.phone_matches_user({}, "27821234567"))

    def test_request_body_is_strict(self):
        c = self.client()
        r = c.post("/api/whatsapp/agent", json={**self.body(), "role": "systemadmin"}, headers=self.headers())
        self.assertEqual(r.status_code, 422)

    def test_disabled_flag(self):
        with mock.patch.dict(os.environ, {"AGENT_ACTIONS_ENABLED": "false"}):
            r = self.client().post("/api/whatsapp/agent", json=self.body(), headers=self.headers())
        self.assertEqual(r.status_code, 404)

    # ---- behaviour -------------------------------------------------------------------------

    def test_identity_comes_from_user_record_not_request(self):
        self.db.data["users"]["ops1"]["role"] = "incubatee"
        r = self.client(say("should not run")).post("/api/whatsapp/agent", json=self.body(), headers=self.headers())
        self.assertIn("aren't available", r.json()["reply"])
        self.assertEqual(self.model.payloads, [])

    def test_read_then_propose_returns_button_text(self):
        c = self.client(
            call("find_participants", {"query": "acme"}),
            call("schedule_appointment", {"assignmentId": "as1", **slot()}, "Ready to book."),
        )
        r = c.post("/api/whatsapp/agent", json=self.body("book acme tomorrow at 10"), headers=self.headers()).json()
        self.assertTrue(r["ok"])
        self.assertEqual(r["reply"], "Ready to book.")
        proposal = r["proposal"]
        self.assertEqual(proposal["tool"], "schedule_appointment")
        self.assertIn("*Schedule appointment*", proposal["text"])
        self.assertIn("Acme Bakery", proposal["text"])
        self.assertLessEqual(len(proposal["text"]), wa.BUTTON_BODY_LIMIT)
        self.assertEqual(self.db.data["appointments"], {})  # proposing writes nothing
        self.assertIn("WhatsApp", self.model.systems[0])

    def test_conversation_memory_carries_over_and_expires(self):
        c = self.client(say("Which SME?"), say("Thanks."))
        c.post("/api/whatsapp/agent", json=self.body("book a meeting"), headers=self.headers())
        c.post("/api/whatsapp/agent", json=self.body("acme"), headers=self.headers())
        history = self.model.payloads[1]["recentConversation"]
        self.assertEqual([(t["role"], t["content"]) for t in history], [("user", "book a meeting"), ("agent", "Which SME?")])

        from datetime import datetime, timedelta, timezone
        self.db.data["agentChannelSessions"]["whatsapp_ops1"]["updatedAt"] = datetime.now(timezone.utc) - timedelta(hours=1)
        c2 = self.client(say("Hi again"))
        c2.post("/api/whatsapp/agent", json=self.body("hello"), headers=self.headers())
        self.assertEqual(self.model.payloads[0]["recentConversation"], [])

    def test_model_failure_returns_safe_message(self):
        def boom(*args, **kwargs):
            raise RuntimeError("GEMINI_API_KEY=abc leaked")

        app = FastAPI()
        app.include_router(wa.create_whatsapp_agent_router(self.db, boom, json.loads, "Q"))
        r = TestClient(app).post("/api/whatsapp/agent", json=self.body(), headers=self.headers())
        self.assertEqual(r.status_code, 500)
        self.assertNotIn("abc", r.text)

    # ---- confirm / cancel ------------------------------------------------------------------

    def propose(self, c):
        return c.post("/api/whatsapp/agent", json=self.body("book"), headers=self.headers()).json()["proposal"]

    def test_confirm_executes_once(self):
        c = self.client(call("schedule_appointment", {"assignmentId": "as1", **slot()}))
        proposal = self.propose(c)
        confirm = {"userId": "ops1", "phone": OPS_PHONE, "proposalId": proposal["id"]}
        ok = c.post("/api/whatsapp/agent/confirm", json=confirm, headers=self.headers())
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(len(self.db.data["appointments"]), 1)
        again = c.post("/api/whatsapp/agent/confirm", json=confirm, headers=self.headers())
        self.assertEqual((again.status_code, again.json()["error"]["code"]), (409, "ACTION_REJECTED"))
        self.assertEqual(len(self.db.data["appointments"]), 1)

    def test_other_user_cannot_confirm_someone_elses_proposal(self):
        c = self.client(call("schedule_appointment", {"assignmentId": "as1", **slot()}))
        proposal = self.propose(c)
        r = c.post("/api/whatsapp/agent/confirm", json={"userId": "cons1", "phone": CONS_PHONE, "proposalId": proposal["id"]}, headers=self.headers())
        self.assertEqual(r.status_code, 409)
        self.assertEqual(self.db.data["appointments"], {})

    def test_confirm_needs_matching_phone(self):
        c = self.client(call("schedule_appointment", {"assignmentId": "as1", **slot()}))
        proposal = self.propose(c)
        r = c.post("/api/whatsapp/agent/confirm", json={"userId": "ops1", "phone": "27820000000", "proposalId": proposal["id"]}, headers=self.headers())
        self.assertEqual(r.status_code, 403)
        self.assertEqual(self.db.data["appointments"], {})

    def test_cancel_discards(self):
        c = self.client(call("schedule_appointment", {"assignmentId": "as1", **slot()}))
        proposal = self.propose(c)
        payload = {"userId": "ops1", "phone": OPS_PHONE, "proposalId": proposal["id"]}
        self.assertEqual(c.post("/api/whatsapp/agent/cancel", json=payload, headers=self.headers()).status_code, 200)
        self.assertEqual(c.post("/api/whatsapp/agent/confirm", json=payload, headers=self.headers()).status_code, 409)
        self.assertEqual(self.db.data["appointments"], {})

    def test_consultant_can_log_outcome_over_whatsapp(self):
        from datetime import datetime, timedelta, timezone
        start = datetime.now(timezone.utc) - timedelta(days=1)
        self.db.data["appointments"]["past1"] = {
            "companyCode": CO, "assignedInterventionId": "as1", "interventionTitle": "Financial Compliance",
            "participantId": "p1", "participantName": "Acme Bakery", "assigneeId": "cons1", "status": "accepted",
            "startTime": start, "endTime": start + timedelta(hours=1), "attendance": {},
        }
        c = self.client(
            call("list_appointments", {"needsOutcome": True}),
            call("log_appointment_outcome", {"appointmentId": "past1", "attendanceStatus": "present", "discussionSummary": "Went well", "progressAfter": 40}),
        )
        r = c.post("/api/whatsapp/agent", json=self.body("log yesterday's meeting", "cons1", CONS_PHONE), headers=self.headers()).json()
        self.assertEqual(r["proposal"]["tool"], "log_appointment_outcome")
        self.assertIn("→ 40%", r["proposal"]["text"])
        done = c.post("/api/whatsapp/agent/confirm", json={"userId": "cons1", "phone": CONS_PHONE, "proposalId": r["proposal"]["id"]}, headers=self.headers())
        self.assertEqual(done.status_code, 200)
        self.assertEqual(self.db.data["assignedInterventions"]["as1"]["progress"], 40)

    def test_format_truncates_long_text(self):
        text = wa.format_proposal_text({"title": "T", "summary": [{"label": "Notes", "value": "x" * 3000}], "warnings": []})
        self.assertLessEqual(len(text), wa.BUTTON_BODY_LIMIT)
        self.assertTrue(text.endswith("…"))


if __name__ == "__main__":
    unittest.main()
