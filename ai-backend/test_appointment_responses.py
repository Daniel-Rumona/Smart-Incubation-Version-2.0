import os
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest import mock

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import appointment_responses as ar
import whatsapp_agent as wa
from agent_actions import ActionError
from test_agent_actions import CO, future, seed

SME_PHONE = "27835550000"


def make_db():
    db = seed()
    db.data["users"]["sme1"] = {"companyCode": CO, "role": "incubatee", "email": "sme@x.co", "displayName": "Sam SME",
                                "whatsappPhoneNumbers": [SME_PHONE]}
    db.data["users"]["sme2"] = {"companyCode": CO, "role": "incubatee", "email": "other@x.co", "whatsappPhoneNumbers": ["27836660000"]}
    db.data["participants"]["p1"] = {"email": "sme@x.co"}
    db.data["participants"]["p2"] = {"email": "other@x.co"}
    start = ar.parse_when(future(3, 10))
    db.data["appointments"]["apt1"] = {
        "companyCode": CO, "assignedInterventionId": "as1", "interventionTitle": "Financial Compliance",
        "participantId": "p1", "participantName": "Acme Bakery", "participantEmail": "sme@x.co",
        "assigneeId": "cons1", "status": "pending", "startTime": start, "endTime": start + timedelta(hours=1),
        "acceptanceBundle": "intervention_and_first_appointment", "attendance": {},
    }
    db.data["assignedInterventions"]["as1"].update(participantStatus="pending", progress=0)
    return db


def sme_for(db, uid="sme1"):
    user = db.data["users"][uid]
    return ar.resolve_sme(db, uid, user.get("email"), user.get("companyCode"))


class CoreTests(unittest.TestCase):
    def setUp(self):
        self.db = make_db()
        self.sme = sme_for(self.db)

    def respond(self, **args):
        return ar.respond_to_appointment(self.db, self.sme, "apt1", args, via="web")

    @property
    def apt(self):
        return self.db.data["appointments"]["apt1"]

    def kinds(self):
        return [n["type"] for n in self.db.data.get("notifications", {}).values()]

    # ---- ownership / context ---------------------------------------------------------------

    def test_sme_resolves_all_their_ids(self):
        self.assertIn("p1", self.sme.participant_ids)
        self.assertIn("sme1", self.sme.participant_ids)

    def test_cannot_touch_someone_elses_or_other_company_appointment(self):
        other = sme_for(self.db, "sme2")
        with self.assertRaisesRegex(ActionError, "couldn't find"):
            ar.respond_to_appointment(self.db, other, "apt1", {"response": "accept"}, via="web")
        self.apt["companyCode"] = "CO2"
        with self.assertRaisesRegex(ActionError, "couldn't find"):
            self.respond(response="accept")
        with self.assertRaisesRegex(ActionError, "couldn't find"):
            ar.rsvp_context(self.db, self.sme, "missing")

    def test_context_offers_drop_option_only_before_any_session(self):
        ctx = ar.rsvp_context(self.db, self.sme, "apt1")
        self.assertTrue(ctx["canDeclineIntervention"])
        self.assertEqual([o["code"] for o in ctx["declineOptions"]], ["not_available", "other_engagement", "no_longer_needed"])
        self.assertEqual([o["proposeTime"] for o in ctx["declineOptions"]], [True, True, False])

        self.db.data["assignedInterventions"]["as1"]["progress"] = 10
        ctx = ar.rsvp_context(self.db, self.sme, "apt1")
        self.assertFalse(ctx["canDeclineIntervention"])
        self.assertNotIn("no_longer_needed", [o["code"] for o in ctx["declineOptions"]])

    def test_completed_sibling_appointment_means_not_first(self):
        self.db.data["appointments"]["done"] = {**self.apt, "status": "completed"}
        self.assertFalse(ar.rsvp_context(self.db, self.sme, "apt1")["canDeclineIntervention"])

    # ---- decline: reschedulable reasons ---------------------------------------------------

    def test_decline_with_proposed_time_text(self):
        result = self.respond(response="decline", reasonCode="other_engagement", proposedText="Thursday afternoon")
        self.assertEqual((result["status"], result["needsReview"]), ("declined", False))
        self.assertEqual(self.apt["status"], "declined")
        self.assertEqual(self.apt["declineReasonCode"], "other_engagement")
        self.assertEqual(self.apt["declineReason"], "I have another engagement")
        self.assertFalse(self.apt["declineNeedsReview"])
        self.assertEqual(self.apt["rescheduleRequest"]["status"], "requested")
        self.assertEqual(self.apt["rescheduleRequest"]["requestedDateText"], "Thursday afternoon")
        self.assertEqual(self.kinds(), ["appointment_declined"])
        self.assertNotIn("declineRequest", self.db.data["assignedInterventions"]["as1"])

    def test_decline_with_structured_proposed_time(self):
        self.respond(response="decline", reasonCode="not_available", proposedStart=future(5, 14), proposedEnd=future(5, 15))
        request = self.apt["rescheduleRequest"]
        self.assertEqual(request["requestedStart"], ar.parse_when(future(5, 14)))
        self.assertIn("14:00", request["requestedDateText"])

    def test_bad_proposed_times_rejected(self):
        for bad in ({"proposedStart": future(-1)}, {"proposedStart": future(5, 15), "proposedEnd": future(5, 14)}, {"proposedStart": "soon"}):
            with self.assertRaises(ActionError, msg=str(bad)):
                self.respond(response="decline", reasonCode="not_available", **bad)
        self.assertEqual(self.apt["status"], "pending")

    def test_decline_without_time_is_fine(self):
        self.respond(response="decline", reasonCode="not_available")
        self.assertIsNone(self.apt["rescheduleRequest"])

    def test_reason_validation(self):
        for args, pattern in (
            ({"response": "decline"}, "why"),
            ({"response": "decline", "reasonCode": "bored"}, "why"),
            ({"response": "decline", "reasonCode": "other"}, "briefly"),
            ({"response": "maybe"}, "accept, decline"),
        ):
            with self.assertRaisesRegex(ActionError, pattern, msg=str(args)):
                self.respond(**args)
        self.assertEqual(self.apt["status"], "pending")

    def test_other_reason_uses_free_text(self):
        self.respond(response="decline", reasonCode="other", detail="Away on family leave")
        self.assertEqual(self.apt["declineReason"], "Away on family leave")

    # ---- decline: no longer needed -----------------------------------------------------------

    def test_no_longer_needed_creates_review_request(self):
        result = self.respond(response="decline", reasonCode="no_longer_needed", proposedText="ignored")
        self.assertTrue(result["needsReview"])
        self.assertTrue(self.apt["declineNeedsReview"])
        self.assertIsNone(self.apt["rescheduleRequest"])  # no time is proposed for dropping the intervention
        request = self.db.data["assignedInterventions"]["as1"]["declineRequest"]
        self.assertEqual((request["status"], request["reasonCode"], request["appointmentId"], request["requestedVia"]), ("requested", "no_longer_needed", "apt1", "web"))
        self.assertEqual(self.kinds(), ["intervention_decline_requested"])
        # the assignment itself is NOT closed by the SME: operations confirms
        self.assertEqual(self.db.data["assignedInterventions"]["as1"]["status"], "assigned")

    def test_no_longer_needed_blocked_after_work_started(self):
        self.db.data["assignedInterventions"]["as1"]["progress"] = 30
        with self.assertRaisesRegex(ActionError, "before its first session"):
            self.respond(response="decline", reasonCode="no_longer_needed")
        self.assertEqual(self.apt["status"], "pending")
        self.assertNotIn("declineRequest", self.db.data["assignedInterventions"]["as1"])

    # ---- idempotency and changing one's mind ---------------------------------------------

    def test_repeat_decline_is_a_no_op(self):
        self.respond(response="decline", reasonCode="not_available", proposedText="Friday")
        again = self.respond(response="decline", reasonCode="not_available", proposedText="Friday")
        self.assertFalse(again["changed"])
        self.assertEqual(len(self.db.data["notifications"]), 1)

    def test_switching_reason_withdraws_drop_request(self):
        self.respond(response="decline", reasonCode="no_longer_needed")
        self.respond(response="decline", reasonCode="not_available", proposedText="Monday")
        self.assertEqual(self.db.data["assignedInterventions"]["as1"]["declineRequest"]["status"], "withdrawn")
        self.assertFalse(self.apt["declineNeedsReview"])

    def test_accepting_after_declining_withdraws_drop_request(self):
        self.respond(response="decline", reasonCode="no_longer_needed")
        self.respond(response="accept")
        self.assertEqual(self.apt["status"], "accepted")
        self.assertEqual(self.db.data["assignedInterventions"]["as1"]["declineRequest"]["status"], "withdrawn")

    # ---- accept / reschedule / closed ----------------------------------------------------------

    def test_accept_sets_status_and_accepts_bundled_intervention_once(self):
        self.assertTrue(self.respond(response="accept")["changed"])
        self.assertEqual((self.apt["status"], self.apt["beneficiaryConfirmation"], self.apt["confirmationSource"]), ("accepted", "confirmed", "web"))
        a = self.db.data["assignedInterventions"]["as1"]
        self.assertEqual((a["participantStatus"], a["status"]), ("accepted", "in-progress"))
        self.assertFalse(self.respond(response="accept")["changed"])
        self.assertEqual(len(self.db.data["notifications"]), 1)

    def test_accept_does_not_touch_unbundled_or_foreign_assignment(self):
        self.apt.pop("acceptanceBundle")
        self.respond(response="accept")
        self.assertEqual(self.db.data["assignedInterventions"]["as1"]["participantStatus"], "pending")

    def test_reschedule_request_keeps_status(self):
        self.respond(response="reschedule_request", proposedText="next Tuesday", detail="clash")
        self.assertEqual(self.apt["status"], "pending")
        self.assertEqual(self.apt["rescheduleRequest"]["requestedDateText"], "next Tuesday")
        with self.assertRaisesRegex(ActionError, "When would"):
            self.respond(response="reschedule_request")

    def test_closed_appointments_cannot_be_changed(self):
        for status in ("cancelled", "completed"):
            self.apt["status"] = status
            with self.assertRaisesRegex(ActionError, f"already {status}"):
                self.respond(response="accept")


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.db = make_db()
        self.identity = SimpleNamespace(uid="sme1", role="incubatee", company_code=CO, email="sme@x.co", is_service=False)
        env = mock.patch.dict(os.environ, {"WHATSAPP_ROUTER_SECRET": "sec", "QTX_WHATSAPP_ROUTER_SECRET": ""})
        env.start()
        self.addCleanup(env.stop)

        def authenticate(header):
            if not header:
                raise HTTPException(status_code=401, detail="Authentication is required")
            return self.identity

        app = FastAPI()
        app.include_router(ar.create_appointment_responses_router(
            self.db, authenticate, lambda request, uid, phone: wa.authorize_router_user(self.db, request, uid, phone)))
        self.c = TestClient(app)

    AUTH = {"Authorization": "Bearer t"}
    WA = {"X-WhatsApp-Router-Secret": "sec"}

    def test_web_context_and_respond(self):
        ctx = self.c.get("/api/appointments/apt1/rsvp-context", headers=self.AUTH).json()
        self.assertTrue(ctx["canDeclineIntervention"])
        r = self.c.post("/api/appointments/apt1/respond", headers=self.AUTH, json={"response": "decline", "reasonCode": "no_longer_needed"})
        self.assertEqual((r.status_code, r.json()["needsReview"]), (200, True))
        self.assertEqual(self.db.data["appointments"]["apt1"]["declinedVia"], "web")

    def test_web_rejections(self):
        self.assertEqual(self.c.post("/api/appointments/apt1/respond", json={"response": "accept"}).status_code, 401)
        self.identity.role = "operations"
        self.assertEqual(self.c.post("/api/appointments/apt1/respond", headers=self.AUTH, json={"response": "accept"}).status_code, 403)
        self.identity.role, self.identity.is_service = "incubatee", True
        self.assertEqual(self.c.post("/api/appointments/apt1/respond", headers=self.AUTH, json={"response": "accept"}).status_code, 403)
        self.identity.is_service = False
        r = self.c.post("/api/appointments/apt1/respond", headers=self.AUTH, json={"response": "decline"})
        self.assertEqual((r.status_code, "why" in r.json()["detail"]), (409, True))
        self.assertEqual(self.c.post("/api/appointments/apt1/respond", headers=self.AUTH, json={"response": "accept", "status": "completed"}).status_code, 422)

    def wa_body(self, **extra):
        return {"userId": "sme1", "phone": SME_PHONE, "appointmentId": "apt1", **extra}

    def test_whatsapp_flow(self):
        ctx = self.c.post("/api/whatsapp/appointments/context", headers=self.WA, json={k: v for k, v in self.wa_body().items() if k != "response"}).json()
        self.assertEqual([o["code"] for o in ctx["declineOptions"]][-1], "no_longer_needed")
        r = self.c.post("/api/whatsapp/appointments/respond", headers=self.WA,
                        json=self.wa_body(response="decline", reasonCode="other_engagement", proposedText="Wednesday 3pm"))
        self.assertEqual(r.status_code, 200)
        apt = self.db.data["appointments"]["apt1"]
        self.assertEqual((apt["declinedVia"], apt["confirmationPhone"], apt["rescheduleRequest"]["requestedVia"]), ("whatsapp", SME_PHONE, "whatsapp"))

    def test_whatsapp_auth(self):
        body = self.wa_body(response="accept")
        self.assertEqual(self.c.post("/api/whatsapp/appointments/respond", json=body).status_code, 401)
        self.assertEqual(self.c.post("/api/whatsapp/appointments/respond", headers={"X-WhatsApp-Router-Secret": "bad"}, json=body).status_code, 401)
        wrong_phone = self.c.post("/api/whatsapp/appointments/respond", headers=self.WA, json={**body, "phone": "27830000001"})
        self.assertEqual(wrong_phone.status_code, 403)
        self.assertEqual(self.db.data["appointments"]["apt1"]["status"], "pending")

    def test_whatsapp_staff_cannot_rsvp(self):
        self.db.data["users"]["ops1"]["whatsappPhoneNumbers"] = ["27821234567"]
        r = self.c.post("/api/whatsapp/appointments/respond", headers=self.WA,
                        json={"userId": "ops1", "phone": "27821234567", "appointmentId": "apt1", "response": "accept"})
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (403, "NOT_AN_SME"))

    def test_whatsapp_rejection_carries_user_safe_reply(self):
        r = self.c.post("/api/whatsapp/appointments/respond", headers=self.WA, json=self.wa_body(response="decline", reasonCode="other"))
        self.assertEqual((r.status_code, r.json()["error"]["code"]), (409, "ACTION_REJECTED"))
        self.assertIn("briefly", r.json()["reply"])

    def test_rsvp_is_independent_of_agent_actions_flag(self):
        with mock.patch.dict(os.environ, {"AGENT_ACTIONS_ENABLED": "false"}):
            r = self.c.post("/api/whatsapp/appointments/respond", headers=self.WA, json=self.wa_body(response="accept"))
        self.assertEqual(r.status_code, 200)


if __name__ == "__main__":
    unittest.main()
