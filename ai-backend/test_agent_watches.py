import unittest
from datetime import datetime, timedelta

import agent_actions as aa
import agent_watches as aw
from agent_actions import ActionError, confirm_proposal, register_tools, tools_for
from test_agent_actions import CO, FakeDB, MemStore, actor

register_tools(aw.WATCH_TOOLS, aw.PROMPT_RULES)


def day(offset: int) -> str:
    return (datetime.now(aa._timezone()) + timedelta(days=offset)).strftime("%Y-%m-%d")


def seed():
    return FakeDB({
        "users": {
            "ops1": {"companyCode": CO, "role": "operations", "displayName": "Olivia Ops"},
            "lead1": {"companyCode": CO, "role": "projectadmin", "displayName": "Lee Lead"},
            "lead2": {"companyCode": CO, "role": "projectmanager", "displayName": "Max Manager"},
            "cons1": {"companyCode": CO, "role": "consultant"},
            "outsider": {"companyCode": "CO2", "role": "projectadmin"},
        },
        "interventions": {
            "cfp": {"companyCode": CO, "interventionTitle": "Cash Flow Planning"},
            "cfa": {"companyCode": CO, "interventionTitle": "Cash Flow Analysis"},
            "mkt": {"companyCode": CO, "interventionTitle": "Marketing Sprint"},
        },
        "assignedInterventions": {
            "a1": {"companyCode": CO, "interventionTitle": "Cash Flow Planning", "businessName": "Acme", "assigneeId": "cons1",
                   "assigneeName": "Carl", "assigneeStatus": "pending", "participantStatus": "pending"},
            "a2": {"companyCode": CO, "interventionTitle": "Marketing Sprint", "businessName": "Beta", "assigneeId": "cons2",
                   "assigneeStatus": "accepted", "participantStatus": "pending"},
            "a3": {"companyCode": CO, "interventionTitle": "Bookkeeping", "businessName": "Gamma", "assigneeId": "cons1",
                   "assigneeStatus": "accepted", "participantStatus": "accepted"},
            "a4": {"companyCode": CO, "interventionTitle": "Legal", "businessName": "Delta", "status": "cancelled"},
            "x1": {"companyCode": "CO2", "interventionTitle": "Other", "assigneeStatus": "pending"},
        },
        "agentWatches": {},
    })


class Base(unittest.TestCase):
    def setUp(self):
        self.db = seed()
        self.store = MemStore(self.db)
        self.ops = actor()

    def propose(self, tool, args, who=None):
        who = who or self.ops
        prepared = aa.TOOLS[tool].prepare(self.db, who, args)
        return self.store.create(who, aa.TOOLS[tool], prepared)

    def watches(self):
        return self.db.data.get("agentWatches", {})


class ToolVisibilityTests(unittest.TestCase):
    def test_staff_get_watch_tools_and_smes_do_not(self):
        names = {t.name for t in tools_for(actor())}
        self.assertTrue({"create_watch", "create_chaser", "list_watches", "stop_watch", "list_open_assignments"} <= names)
        self.assertEqual({t.name for t in tools_for(actor(role="incubatee"))}, set())

    def test_prompt_mentions_watches(self):
        self.assertIn("create_watch", aa._system_prompt("P", tools_for(actor()), actor()))
        self.assertIn("Watches and chasers", aa._system_prompt("P", tools_for(actor()), actor()))


class OpenAssignmentTests(Base):
    def test_lists_waiting_items_in_company_only(self):
        result = aw.tool_list_open_assignments(self.db, self.ops, {})
        ids = {r["assignmentId"] for r in result["assignments"]}
        self.assertEqual(ids, {"a1", "a2"})  # a3 fully accepted, a4 cancelled, x1 other company
        waiting = {r["assignmentId"]: r["waitingOn"] for r in result["assignments"]}
        self.assertIn("the facilitator and the SME", waiting["a1"])
        self.assertIn("the SME", waiting["a2"])

    def test_consultant_sees_only_own(self):
        result = aw.tool_list_open_assignments(self.db, actor(uid="cons1", role="consultant"), {})
        self.assertEqual({r["assignmentId"] for r in result["assignments"]}, {"a1"})


class WatchTests(Base):
    def test_sme_watch_proposal_then_confirm_stores_condition(self):
        proposal = self.propose("create_watch", {
            "subject": "sme", "request": "Tell me if any Rustenburg SME goes High risk and has no session booked in the next two weeks",
            "title": "Rustenburg high risk", "filters": {"city": "Rustenburg"},
            "conditions": [{"type": "risk", "level": "High"}, {"type": "no_session_within_days", "days": 14}],
        })
        self.assertEqual(self.watches(), {})  # nothing stored until confirmed
        confirm_proposal(self.db, self.store, self.ops, proposal["id"])
        (watch,) = self.watches().values()
        self.assertEqual(watch["kind"], "watch")
        self.assertEqual(watch["status"], "active")
        self.assertEqual(watch["filters"], {"city": "Rustenburg"})
        self.assertEqual(watch["conditions"], [{"type": "risk", "level": "high"}, {"type": "no_session_within_days", "days": 14}])
        self.assertGreater(watch["endsAt"], aa._now() + timedelta(days=80))

    def test_unsupported_condition_rejected(self):
        with self.assertRaises(ActionError):
            self.propose("create_watch", {"subject": "sme", "conditions": [{"type": "revenue_drop"}]})
        with self.assertRaises(ActionError):
            self.propose("create_watch", {"subject": "sme", "conditions": []})

    def test_reportable_watch_resolves_intervention_by_name(self):
        proposal = self.propose("create_watch", {"subject": "intervention_reportable", "intervention": "Cash Flow Planning",
                                                 "request": "Let me know when Cash Flow Planning becomes reportable"})
        confirm_proposal(self.db, self.store, self.ops, proposal["id"])
        (watch,) = self.watches().values()
        self.assertEqual((watch["interventionId"], watch["interventionTitle"]), ("cfp", "Cash Flow Planning"))

    def test_ambiguous_intervention_asks(self):
        with self.assertRaises(ActionError) as caught:
            self.propose("create_watch", {"subject": "intervention_reportable", "intervention": "Cash Flow"})
        self.assertIn("More than one", str(caught.exception))

    def test_consultant_watch_is_limited_to_their_smes(self):
        cons = actor(uid="cons1", role="consultant")
        proposal = self.propose("create_watch", {"subject": "sme", "conditions": [{"type": "overdue_interventions"}]}, who=cons)
        confirm_proposal(self.db, self.store, cons, proposal["id"])
        (watch,) = self.watches().values()
        self.assertEqual(watch["assigneeId"], "cons1")


class ChaserTests(Base):
    def chaser(self, **extra):
        proposal = self.propose("create_chaser", {"assignmentIds": ["a1", "a2"], "goal": "accepted", "dueDate": day(4),
                                                  "request": "Get these approved by Friday", **extra})
        confirm_proposal(self.db, self.store, self.ops, proposal["id"])
        (watch_id, watch), = self.watches().items()
        return watch_id, watch

    def test_chaser_stores_items_and_allowance(self):
        _, watch = self.chaser()
        self.assertEqual(watch["kind"], "chaser")
        self.assertEqual(watch["nudgesEach"], 2)
        self.assertEqual([i["assignmentId"] for i in watch["items"]], ["a1", "a2"])
        self.assertTrue(all(not i["done"] for i in watch["items"]))
        self.assertEqual(watch["escalation"], {"status": "none"})

    def test_rejects_past_deadline_other_company_cancelled_and_all_done(self):
        with self.assertRaises(ActionError):
            self.propose("create_chaser", {"assignmentIds": ["a1"], "dueDate": day(-1)})
        with self.assertRaises(ActionError):
            self.propose("create_chaser", {"assignmentIds": ["x1"], "dueDate": day(3)})
        with self.assertRaises(ActionError):
            self.propose("create_chaser", {"assignmentIds": ["a4"], "dueDate": day(3)})
        with self.assertRaises(ActionError):
            self.propose("create_chaser", {"assignmentIds": ["a3"], "dueDate": day(3)})
        with self.assertRaises(ActionError):
            self.propose("create_chaser", {"assignmentIds": ["a1"], "dueDate": day(3), "nudgesEach": 9})

    def test_escalation_only_after_asked_then_notifies_leads_once(self):
        watch_id, _ = self.chaser()
        with self.assertRaises(ActionError):
            aw.answer_escalation(self.db, self.ops, watch_id, "escalate")
        self.db.data["agentWatches"][watch_id]["escalation"] = {"status": "asked", "messageId": "m1"}
        self.db.data["agentChatMessages"] = {"m1": {"uid": "ops1", "card": {"type": "chaser_escalation"}}}
        result = aw.answer_escalation(self.db, self.ops, watch_id, "escalate")
        self.assertEqual((result["status"], result["leads"]), ("escalated", 2))
        sent = [n for n in self.db.data["staffNotifications"].values() if n["type"] == "agent_chaser_escalation"]
        self.assertEqual({n["recipientUid"] for n in sent}, {"lead1", "lead2"})
        self.assertEqual(self.db.data["agentChatMessages"]["m1"]["card.response"], "escalated")
        # The fake store keeps dotted keys literally; apply them as Firestore would before asking again.
        self.db.data["agentWatches"][watch_id]["escalation"] = {"status": "escalated"}
        with self.assertRaises(ActionError):
            aw.answer_escalation(self.db, self.ops, watch_id, "escalate")

    def test_only_owner_can_answer_or_stop(self):
        watch_id, _ = self.chaser()
        other = actor(uid="lead1", role="projectadmin")
        with self.assertRaises(ActionError):
            aw.stop_watch(self.db, other, watch_id)
        aw.stop_watch(self.db, self.ops, watch_id)
        self.assertEqual(self.db.data["agentWatches"][watch_id]["status"], "stopped")

    def test_blocking_parties_for_completion(self):
        self.assertEqual(aw.blocking_parties({"assigneeCompletionStatus": "pending"}, "completed"), ["facilitator"])
        self.assertEqual(aw.blocking_parties({"assigneeCompletionStatus": "done"}, "completed"), ["sme"])
        self.assertEqual(aw.blocking_parties({"assigneeCompletionStatus": "done", "participantCompletionStatus": "confirmed"}, "completed"), [])


if __name__ == "__main__":
    unittest.main()
