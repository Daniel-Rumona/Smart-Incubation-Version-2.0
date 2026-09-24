import json
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import agent_actions as aa
from agent_actions import ActionError, ProposalStore, build_actor, confirm_proposal, run_agent_turn, tools_for


# ---- minimal in-memory Firestore -------------------------------------------------------------

class Snap:
    def __init__(self, id, data):
        self.id, self._data = id, data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class Doc:
    def __init__(self, db, name, id):
        self.db, self.name, self.id = db, name, id

    def get(self, transaction=None):
        return Snap(self.id, self.db.data.setdefault(self.name, {}).get(self.id))

    def set(self, data):
        self.db.data.setdefault(self.name, {})[self.id] = dict(data)

    def update(self, data):
        self.db.data[self.name][self.id].update(data)


OPS = {
    "==": lambda a, b: a == b,
    ">=": lambda a, b: a is not None and a >= b,
    "<": lambda a, b: a is not None and a < b,
}


class Query:
    def __init__(self, db, name, filters=()):
        self.db, self.name, self.filters = db, name, tuple(filters)

    def where(self, field, op, value):
        return Query(self.db, self.name, self.filters + ((field, op, value),))

    def stream(self):
        for id, data in list(self.db.data.get(self.name, {}).items()):
            if all(OPS[op](data.get(f), v) for f, op, v in self.filters):
                yield Snap(id, data)


class Coll(Query):
    def document(self, id=None):
        self.db.n += 1
        return Doc(self.db, self.name, id or f"auto{self.db.n}")


class Batch:
    def __init__(self):
        self.ops = []

    def set(self, ref, data):
        self.ops.append((ref.set, data))

    def update(self, ref, data):
        self.ops.append((ref.update, data))

    def commit(self):
        for fn, data in self.ops:
            fn(data)


class FakeDB:
    def __init__(self, data=None):
        self.data, self.n = data or {}, 0

    def collection(self, name):
        return Coll(self, name)

    def batch(self):
        return Batch()


class MemStore(ProposalStore):
    """Same claim rules (check_claimable) without a live Firestore transaction."""

    def claim(self, proposal_id, actor, new_status):
        ref = self.db.collection(self.collection).document(proposal_id)
        data = aa.check_claimable(ref.get().to_dict(), actor)
        ref.update({"status": new_status})
        return data


# ---- fixtures --------------------------------------------------------------------------------

CO = "CO1"


def actor(uid="ops1", role="operations", company=CO):
    identity = SimpleNamespace(uid=uid, role=role, company_code=company, email=f"{uid}@x.co", is_service=False)
    return build_actor(FakeDB(), identity)


def future(days=2, hour=10, minutes=0):
    d = (datetime.now(aa._timezone()) + timedelta(days=days)).replace(hour=hour, minute=minutes, second=0, microsecond=0)
    return d.strftime("%Y-%m-%dT%H:%M")


def seed():
    return FakeDB({
        "users": {
            "ops1": {"companyCode": CO, "role": "operations", "displayName": "Olivia Ops"},
            "cons1": {"companyCode": CO, "role": "consultant", "displayName": "Carl Consultant", "email": "carl@x.co"},
            "cons2": {"companyCode": CO, "role": "consultant", "displayName": "Cora Consultant"},
            "other": {"companyCode": "CO2", "role": "consultant", "displayName": "Outsider"},
        },
        "participants": {"p1": {"email": "sme@x.co"}},
        "applications": {"app1": {
            "companyCode": CO, "participantId": "p1", "applicationStatus": "accepted", "beneficiaryName": "Acme Bakery",
            "programName": "Prog A", "programId": "prog1",
            "interventions": {
                "required": [{"id": "iv1", "title": "Financial Compliance"}, {"id": "iv2", "title": "Marketing Sprint"}],
                "confirmedBy": {"operations": True},
            },
        }},
        "interventions": {
            "iv1": {"companyCode": CO, "interventionTitle": "Financial Compliance", "areaOfSupport": "Finance"},
            "iv2": {"companyCode": CO, "interventionTitle": "Marketing Sprint", "executionMode": "multi_step",
                    "steps": [{"id": "s1", "title": "Audit"}, {"id": "s2", "title": "Campaign"}]},
        },
        "assignedInterventions": {
            "as1": {
                "companyCode": CO, "participantId": "p1", "interventionId": "iv1", "interventionTitle": "Financial Compliance",
                "businessName": "Acme Bakery", "assigneeId": "cons1", "assigneeEmail": "carl@x.co", "status": "assigned",
                "programId": "prog1", "programName": "Prog A", "deliveryActorType": "human",
            },
            "as_other": {"companyCode": "CO2", "participantId": "px", "interventionId": "iv9", "assigneeId": "other", "status": "assigned"},
        },
        "appointments": {},
    })


def slot(**extra):
    return {"start": future(), "end": future(hour=11), "meetingType": "online", "meetingLink": "https://meet.example/abc", **extra}


class Base(unittest.TestCase):
    def setUp(self):
        self.db = seed()
        self.store = MemStore(self.db)
        self.ops = actor()

    def propose(self, tool, args, who=None):
        who = who or self.ops
        prepared = aa.TOOLS[tool].prepare(self.db, who, args)
        return self.store.create(who, aa.TOOLS[tool], prepared)


# ---- tests -----------------------------------------------------------------------------------

class TimeAndPermissionTests(unittest.TestCase):
    def test_naive_time_read_in_workspace_timezone(self):
        self.assertEqual(aa.parse_when("2030-06-01T10:00").hour, 8)  # SAST is UTC+2

    def test_bad_slots_rejected(self):
        with self.assertRaises(ActionError):
            aa._validate_slot(aa.parse_when(future(-1)), aa.parse_when(future(-1, 11)))
        with self.assertRaises(ActionError):
            aa._validate_slot(aa.parse_when(future()), aa.parse_when(future()))
        with self.assertRaises(ActionError):
            aa._validate_slot(aa.parse_when(future(hour=8)), aa.parse_when(future(days=3, hour=8)))
        with self.assertRaises(ActionError):
            aa.parse_when("next tuesday")

    def test_tool_visibility_by_role(self):
        def names(a):
            return {t.name for t in tools_for(a)}

        self.assertIn("assign_intervention", names(actor()))
        self.assertNotIn("assign_intervention", names(actor(role="consultant")))
        self.assertIn("schedule_appointment", names(actor(role="consultant")))
        self.assertEqual(names(actor(role="incubatee")), set())
        self.assertEqual(names(actor(role="director")), set())

    def test_service_secret_never_gets_tools(self):
        identity = SimpleNamespace(uid="agent-service", role="systemadmin", company_code=None, email=None, is_service=True)
        self.assertEqual(tools_for(build_actor(FakeDB(), identity)), [])

    def test_user_level_grant_adds_permission(self):
        db = FakeDB({"users": {"c": {"role": "consultant", "permissions": ["assign_interventions"]}}})
        identity = SimpleNamespace(uid="c", role="consultant", company_code=CO, email=None, is_service=False)
        self.assertTrue(build_actor(db, identity).can("assign_interventions"))


class ScheduleTests(Base):
    def test_proposal_writes_nothing_until_confirmed(self):
        proposal = self.propose("schedule_appointment", {"assignmentId": "as1", **slot()})
        self.assertTrue(proposal["requiresConfirmation"])
        self.assertEqual(self.db.data["appointments"], {})
        self.assertEqual(self.db.data.get("notifications", {}), {})

        outcome = confirm_proposal(self.db, self.store, self.ops, proposal["id"])
        appt = self.db.data["appointments"][outcome["result"]["appointmentId"]]
        self.assertEqual(appt["companyCode"], CO)
        self.assertEqual(appt["status"], "pending")
        self.assertTrue(appt["requiresSmeAcceptance"])
        self.assertEqual(appt["participantEmail"], "sme@x.co")
        self.assertEqual(appt["assigneeId"], "cons1")
        self.assertEqual(appt["createdByUid"], "ops1")
        self.assertEqual(len(self.db.data["notifications"]), 1)
        self.assertEqual(self.db.data["agentActionProposals"][proposal["id"]]["status"], "executed")

    def test_cannot_confirm_twice(self):
        proposal = self.propose("schedule_appointment", {"assignmentId": "as1", **slot()})
        confirm_proposal(self.db, self.store, self.ops, proposal["id"])
        with self.assertRaises(ActionError):
            confirm_proposal(self.db, self.store, self.ops, proposal["id"])
        self.assertEqual(len(self.db.data["appointments"]), 1)

    def test_other_user_cannot_confirm(self):
        proposal = self.propose("schedule_appointment", {"assignmentId": "as1", **slot()})
        with self.assertRaises(ActionError):
            confirm_proposal(self.db, self.store, actor("ops2"), proposal["id"])
        self.assertEqual(self.db.data["appointments"], {})

    def test_expired_proposal_rejected(self):
        proposal = self.propose("schedule_appointment", {"assignmentId": "as1", **slot()})
        self.db.data["agentActionProposals"][proposal["id"]]["expiresAt"] = datetime.now(timezone.utc) - timedelta(minutes=1)
        with self.assertRaises(ActionError):
            confirm_proposal(self.db, self.store, self.ops, proposal["id"])

    def test_permission_revoked_before_confirm(self):
        proposal = self.propose("schedule_appointment", {"assignmentId": "as1", **slot()})
        with self.assertRaises(ActionError):
            confirm_proposal(self.db, self.store, actor(role="incubatee"), proposal["id"])
        self.assertEqual(self.db.data["appointments"], {})

    def test_cross_tenant_assignment_hidden(self):
        for target in ("as_other", "nope"):
            with self.assertRaisesRegex(ActionError, "couldn't find"):
                aa.prepare_schedule_appointment(self.db, self.ops, {"assignmentId": target, **slot()})

    def test_consultant_limited_to_own_assignments(self):
        args = {"assignmentId": "as1", **slot()}
        aa.prepare_schedule_appointment(self.db, actor("cons1", "consultant"), args)
        with self.assertRaisesRegex(ActionError, "assigned to you"):
            aa.prepare_schedule_appointment(self.db, actor("cons2", "consultant"), args)

    def test_conflict_detected_and_adjacent_allowed(self):
        confirm_proposal(self.db, self.store, self.ops, self.propose("schedule_appointment", {"assignmentId": "as1", **slot()})["id"])
        overlapping = {"assignmentId": "as1", "start": future(hour=10, minutes=30), "end": future(hour=11, minutes=30), "meetingType": "online"}
        with self.assertRaisesRegex(ActionError, "clashes"):
            aa.prepare_schedule_appointment(self.db, self.ops, overlapping)
        adjacent = {"assignmentId": "as1", "start": future(hour=11), "end": future(hour=12), "meetingType": "online"}
        aa.prepare_schedule_appointment(self.db, self.ops, adjacent)

    def test_conflict_rechecked_at_confirm_time(self):
        first = self.propose("schedule_appointment", {"assignmentId": "as1", **slot()})
        second = self.propose("schedule_appointment", {"assignmentId": "as1", **slot()})  # same slot, both valid so far
        confirm_proposal(self.db, self.store, self.ops, first["id"])
        with self.assertRaisesRegex(ActionError, "clashes"):
            confirm_proposal(self.db, self.store, self.ops, second["id"])
        self.assertEqual(len(self.db.data["appointments"]), 1)
        self.assertEqual(self.db.data["agentActionProposals"][second["id"]]["status"], "failed")

    def test_meeting_field_validation(self):
        with self.assertRaises(ActionError):
            aa.prepare_schedule_appointment(self.db, self.ops, {"assignmentId": "as1", **slot(meetingType="carrier pigeon")})
        with self.assertRaisesRegex(ActionError, "Where"):
            aa.prepare_schedule_appointment(self.db, self.ops, {"assignmentId": "as1", **slot(meetingType="in_person", meetingLink=None)})
        with self.assertRaisesRegex(ActionError, "http"):
            aa.prepare_schedule_appointment(self.db, self.ops, {"assignmentId": "as1", **slot(meetingLink="javascript:alert(1)")})

    def test_agent_delivered_assignment_has_no_appointments(self):
        self.db.data["assignedInterventions"]["as1"]["deliveryActorType"] = "agent"
        with self.assertRaisesRegex(ActionError, "agent"):
            aa.prepare_schedule_appointment(self.db, self.ops, {"assignmentId": "as1", **slot()})


class RescheduleCancelTests(Base):
    def make_appt(self):
        proposal = self.propose("schedule_appointment", {"assignmentId": "as1", **slot()})
        return confirm_proposal(self.db, self.store, self.ops, proposal["id"])["result"]["appointmentId"]

    def test_reschedule_resets_acceptance(self):
        appt_id = self.make_appt()
        self.db.data["appointments"][appt_id]["status"] = "accepted"
        new = {"appointmentId": appt_id, "start": future(3, 14), "end": future(3, 15)}
        confirm_proposal(self.db, self.store, self.ops, self.propose("reschedule_appointment", new)["id"])
        appt = self.db.data["appointments"][appt_id]
        self.assertEqual(appt["status"], "pending")
        self.assertEqual(aa._as_utc(appt["startTime"]), aa.parse_when(future(3, 14)))

    def test_cancel_needs_reason_and_is_final(self):
        appt_id = self.make_appt()
        with self.assertRaisesRegex(ActionError, "reason"):
            aa.prepare_cancel_appointment(self.db, self.ops, {"appointmentId": appt_id})
        cancel = self.propose("cancel_appointment", {"appointmentId": appt_id, "reason": "SME travelling"})
        confirm_proposal(self.db, self.store, self.ops, cancel["id"])
        self.assertEqual(self.db.data["appointments"][appt_id]["status"], "cancelled")
        with self.assertRaisesRegex(ActionError, "already cancelled"):
            aa.prepare_reschedule_appointment(self.db, self.ops, {"appointmentId": appt_id, "start": future(4), "end": future(4, 11)})

    def test_cross_tenant_appointment_hidden(self):
        self.db.data["appointments"]["foreign"] = {"companyCode": "CO2", "status": "pending"}
        with self.assertRaisesRegex(ActionError, "couldn't find"):
            aa.prepare_cancel_appointment(self.db, self.ops, {"appointmentId": "foreign", "reason": "x"})


class AssignTests(Base):
    def test_assign_with_first_appointment(self):
        args = {"participantId": "p1", "interventionId": "iv2", "assigneeId": "cons1", "dueDate": future(20)[:10],
                "firstAppointment": slot()}
        proposal = self.propose("assign_intervention", args)
        self.assertEqual(len(self.db.data["assignedInterventions"]), 2)  # nothing new yet
        result = confirm_proposal(self.db, self.store, self.ops, proposal["id"])["result"]
        a = self.db.data["assignedInterventions"][result["assignmentId"]]
        self.assertEqual((a["companyCode"], a["assigneeId"], a["status"], a["assigneeStatus"]), (CO, "cons1", "assigned", "pending"))
        self.assertEqual(a["assignedStepId"], "s1")  # multi-step -> first step
        self.assertEqual(a["deliveryActorType"], "human")
        appt = self.db.data["appointments"][result["appointmentId"]]
        self.assertEqual(appt["assignedInterventionId"], result["assignmentId"])
        self.assertTrue(appt["firstAppointmentForAssignment"])

    def test_multi_step_blocks_until_step_complete(self):
        args = {"participantId": "p1", "interventionId": "iv2", "assigneeId": "cons1"}
        confirm_proposal(self.db, self.store, self.ops, self.propose("assign_intervention", args)["id"])
        with self.assertRaisesRegex(ActionError, "must be completed"):
            aa.prepare_assign_intervention(self.db, self.ops, args)

    def test_single_session_duplicate_blocked_but_cancelled_allowed(self):
        args = {"participantId": "p1", "interventionId": "iv1", "assigneeId": "cons1"}
        with self.assertRaisesRegex(ActionError, "already has"):
            aa.prepare_assign_intervention(self.db, self.ops, args)
        self.db.data["assignedInterventions"]["as1"]["status"] = "cancelled"
        aa.prepare_assign_intervention(self.db, self.ops, args)

    def test_rejects_unknown_targets(self):
        base = {"participantId": "p1", "interventionId": "iv2", "assigneeId": "cons1"}
        for bad in ({"participantId": "zzz"}, {"interventionId": "nope"}, {"assigneeId": "other"}, {"assigneeId": "ghost"}):
            with self.assertRaises(ActionError, msg=str(bad)):
                aa.prepare_assign_intervention(self.db, self.ops, {**base, **bad})

    def test_unconfirmed_plan_not_assignable(self):
        self.db.data["applications"]["app1"]["interventions"]["confirmedBy"] = {}
        with self.assertRaisesRegex(ActionError, "confirmed plan"):
            aa.prepare_assign_intervention(self.db, self.ops, {"participantId": "p1", "interventionId": "iv2", "assigneeId": "cons1"})

    def test_past_due_date_rejected(self):
        with self.assertRaisesRegex(ActionError, "past"):
            aa.prepare_assign_intervention(self.db, self.ops, {"participantId": "p1", "interventionId": "iv2", "assigneeId": "cons1", "dueDate": "2020-01-01"})


class OutcomeTests(Base):
    def setUp(self):
        super().setUp()
        start = datetime.now(timezone.utc) - timedelta(days=1)
        self.db.data["appointments"]["past1"] = {
            "companyCode": CO, "assignedInterventionId": "as1", "interventionTitle": "Financial Compliance",
            "participantId": "p1", "participantName": "Acme Bakery", "participantEmail": "sme@x.co",
            "assigneeId": "cons1", "status": "accepted", "startTime": start, "endTime": start + timedelta(hours=1),
            "attendance": {},
        }
        self.db.data["assignedInterventions"]["as1"].update({"targetType": "number", "targetValue": 10, "targetMetric": "Hours", "targetActual": 2, "progress": 20, "timeSpent": 1})

    def log(self, **extra):
        return {"appointmentId": "past1", "attendanceStatus": "present", "discussionSummary": "Reviewed VAT filings.", **extra}

    def test_numeric_target_drives_progress(self):
        proposal = self.propose("log_appointment_outcome", self.log(hoursAdded=3))
        self.assertEqual(self.db.data["appointments"]["past1"]["status"], "accepted")  # nothing written yet
        rows = {r["label"]: r["value"] for r in proposal["summary"]}
        self.assertEqual(rows["Progress"], "20% → 50%")

        result = confirm_proposal(self.db, self.store, self.ops, proposal["id"])["result"]
        self.assertEqual(result["progress"], 50)
        appt, a = self.db.data["appointments"]["past1"], self.db.data["assignedInterventions"]["as1"]
        self.assertEqual(appt["status"], "completed")
        self.assertEqual(appt["attendance"], {"sme@x.co": "present"})
        self.assertEqual((a["progress"], a["targetActual"], a["timeSpent"], a["status"]), (50, 5.0, 4.0, "in-progress"))
        self.assertEqual(a["assigneeCompletionStatus"], "pending")
        self.assertEqual(self.db.data["notifications"][next(iter(self.db.data["notifications"]))]["type"], "appointment_completed_progress_update")

    def test_reaching_100_awaits_confirmation(self):
        confirm_proposal(self.db, self.store, self.ops, self.propose("log_appointment_outcome", self.log(hoursAdded=8))["id"])
        a = self.db.data["assignedInterventions"]["as1"]
        self.assertEqual((a["progress"], a["status"], a["assigneeCompletionStatus"]), (100, "awaiting_confirmation", "done"))

    def test_explicit_progress_and_no_target(self):
        self.db.data["assignedInterventions"]["as1"].pop("targetType")
        confirm_proposal(self.db, self.store, self.ops, self.propose("log_appointment_outcome", self.log(progressAfter=65))["id"])
        self.assertEqual(self.db.data["assignedInterventions"]["as1"]["progress"], 65)

    def test_no_progress_input_keeps_progress(self):
        self.db.data["assignedInterventions"]["as1"].pop("targetType")
        confirm_proposal(self.db, self.store, self.ops, self.propose("log_appointment_outcome", self.log())["id"])
        self.assertEqual(self.db.data["assignedInterventions"]["as1"]["progress"], 20)

    def test_validation(self):
        for bad, pattern in (
            ({"appointmentId": "past1", "attendanceStatus": "maybe", "discussionSummary": "x"}, "present or absent"),
            (self.log(discussionSummary="  "), "note"),
            (self.log(attendanceStatus="absent", hoursAdded=2), "absent"),
            (self.log(hoursAdded="lots"), "number"),
            (self.log(hoursAdded=-1), "between"),
            (self.log(progressAfter=140), "between"),
            (self.log(hoursAdded=float("nan")), "between"),
            (self.log(hoursAdded=True), "number"),
        ):
            with self.assertRaisesRegex(ActionError, pattern, msg=str(bad)):
                aa.prepare_log_appointment_outcome(self.db, self.ops, bad)

    def test_absent_is_recorded_without_progress_change(self):
        confirm_proposal(self.db, self.store, self.ops, self.propose("log_appointment_outcome", self.log(attendanceStatus="absent", discussionSummary="Did not show"))["id"])
        self.assertEqual(self.db.data["appointments"]["past1"]["attendance"], {"sme@x.co": "absent"})
        self.assertEqual(self.db.data["assignedInterventions"]["as1"]["timeSpent"], 1.0)

    def test_future_appointment_rejected(self):
        future_start = datetime.now(timezone.utc) + timedelta(days=1)
        self.db.data["appointments"]["past1"].update(startTime=future_start, endTime=future_start + timedelta(hours=1))
        with self.assertRaisesRegex(ActionError, "hasn't happened"):
            aa.prepare_log_appointment_outcome(self.db, self.ops, self.log())

    def test_cannot_log_twice_or_on_cancelled(self):
        confirm_proposal(self.db, self.store, self.ops, self.propose("log_appointment_outcome", self.log(hoursAdded=1))["id"])
        with self.assertRaisesRegex(ActionError, "already completed"):
            aa.prepare_log_appointment_outcome(self.db, self.ops, self.log(hoursAdded=1))
        self.db.data["appointments"]["past1"]["status"] = "cancelled"
        with self.assertRaisesRegex(ActionError, "already cancelled"):
            aa.prepare_log_appointment_outcome(self.db, self.ops, self.log())

    def test_double_confirm_of_two_proposals_second_is_rejected(self):
        first = self.propose("log_appointment_outcome", self.log(hoursAdded=1))
        second = self.propose("log_appointment_outcome", self.log(hoursAdded=1))
        confirm_proposal(self.db, self.store, self.ops, first["id"])
        with self.assertRaisesRegex(ActionError, "already completed"):
            confirm_proposal(self.db, self.store, self.ops, second["id"])
        self.assertEqual(self.db.data["assignedInterventions"]["as1"]["timeSpent"], 2.0)  # counted once

    def test_closed_intervention_rejected(self):
        self.db.data["assignedInterventions"]["as1"]["status"] = "completed"
        with self.assertRaisesRegex(ActionError, "closed"):
            aa.prepare_log_appointment_outcome(self.db, self.ops, self.log())

    def test_consultant_only_own_and_tenant_isolation(self):
        aa.prepare_log_appointment_outcome(self.db, actor("cons1", "consultant"), self.log())
        with self.assertRaisesRegex(ActionError, "assigned to you"):
            aa.prepare_log_appointment_outcome(self.db, actor("cons2", "consultant"), self.log())
        self.db.data["appointments"]["past1"]["companyCode"] = "CO2"
        with self.assertRaisesRegex(ActionError, "couldn't find"):
            aa.prepare_log_appointment_outcome(self.db, self.ops, self.log())

    def test_needs_outcome_listing(self):
        rows = aa.tool_list_appointments(self.db, self.ops, {"needsOutcome": True})["appointments"]
        self.assertEqual([r["appointmentId"] for r in rows], ["past1"])
        self.db.data["appointments"]["past1"]["status"] = "completed"
        self.assertEqual(aa.tool_list_appointments(self.db, self.ops, {"needsOutcome": True})["appointments"], [])


class SmeResponseTests(Base):
    """SME RSVPs arrive (via WhatsApp) as appointment.status plus declineReason / rescheduleRequest."""

    def setUp(self):
        super().setUp()
        start = aa.parse_when(future(3, 10))
        self.db.data["appointments"]["apt1"] = {
            "companyCode": CO, "assignedInterventionId": "as1", "interventionTitle": "Financial Compliance",
            "participantId": "p1", "participantName": "Acme Bakery", "participantEmail": "sme@x.co",
            "assigneeId": "cons1", "status": "declined", "declineReason": "Out of town",
            "beneficiaryConfirmation": "declined", "userConfirmation": "declined",
            "startTime": start, "endTime": start + timedelta(hours=1), "attendance": {},
        }

    def test_declined_appointment_frees_its_slot(self):
        args = {"assignmentId": "as1", "start": future(3, 10), "end": future(3, 11), "meetingType": "online"}
        aa.prepare_schedule_appointment(self.db, self.ops, args)  # would raise "clashes" if declined still blocked
        self.db.data["appointments"]["apt1"]["status"] = "accepted"
        with self.assertRaisesRegex(ActionError, "clashes"):
            aa.prepare_schedule_appointment(self.db, self.ops, args)

    def test_declined_can_be_rescheduled_and_resets_sme_answer(self):
        new = {"appointmentId": "apt1", "start": future(5, 14), "end": future(5, 15)}
        proposal = self.propose("reschedule_appointment", new)
        rows = {r["label"]: r["value"] for r in proposal["summary"]}
        self.assertEqual(rows["SME response"], "Declined: Out of town")
        confirm_proposal(self.db, self.store, self.ops, proposal["id"])
        appt = self.db.data["appointments"]["apt1"]
        self.assertEqual(appt["status"], "pending")
        self.assertIsNone(appt["beneficiaryConfirmation"])
        self.assertIsNone(appt["userConfirmation"])

    def test_reschedule_request_is_resolved_when_ops_reschedules(self):
        self.db.data["appointments"]["apt1"].update(status="accepted", rescheduleRequest={
            "status": "requested", "requestedDateText": "Thursday", "requestedTimeText": "2pm", "reasonText": "clash", "requestedVia": "whatsapp"})
        new = {"appointmentId": "apt1", "start": future(5, 14), "end": future(5, 15)}
        proposal = self.propose("reschedule_appointment", new)
        self.assertEqual({r["label"]: r["value"] for r in proposal["summary"]}["SME request"], "wants Thursday 2pm; reason: clash")
        confirm_proposal(self.db, self.store, self.ops, proposal["id"])
        request = self.db.data["appointments"]["apt1"]["rescheduleRequest"]
        self.assertEqual((request["status"], request["resolvedByUid"], request["requestedDateText"]), ("resolved", "ops1", "Thursday"))
        self.assertIsNone(aa._sme_request_text(self.db.data["appointments"]["apt1"]))

    def test_declined_can_be_cancelled_but_not_outcome_logged(self):
        aa.prepare_cancel_appointment(self.db, self.ops, {"appointmentId": "apt1", "reason": "SME unavailable"})
        past = datetime.now(timezone.utc) - timedelta(days=1)
        self.db.data["appointments"]["apt1"].update(startTime=past, endTime=past + timedelta(hours=1))
        with self.assertRaisesRegex(ActionError, "already declined"):
            aa.prepare_log_appointment_outcome(self.db, self.ops, {"appointmentId": "apt1", "attendanceStatus": "present", "discussionSummary": "x"})

    def test_listing_exposes_sme_response(self):
        self.db.data["appointments"]["apt2"] = {**self.db.data["appointments"]["apt1"], "status": "pending", "rescheduleRequest": {
            "status": "requested", "requestedDateText": "Friday", "reasonText": "funeral"}}
        rows = {r["appointmentId"]: r for r in aa.tool_list_appointments(self.db, self.ops, {"from": future(1), "to": future(6)})["appointments"]}
        self.assertEqual(rows["apt1"]["smeDeclineReason"], "Out of town")
        self.assertEqual(rows["apt2"]["smeRescheduleRequest"], "wants Friday; reason: funeral")
        self.assertNotIn("smeRescheduleRequest", rows["apt1"])


class DeclinedInterventionTests(Base):
    def tag(self, key="iv2", title="Marketing Sprint"):
        self.db.data.setdefault("diagnosticPlans", {})["app1"] = {
            "companyCode": CO, "declinedInterventions": {key: {"title": title, "declinedAt": "2026-09-30"}}}

    def test_declined_intervention_cannot_be_assigned(self):
        args = {"participantId": "p1", "interventionId": "iv2", "assigneeId": "cons1"}
        aa.prepare_assign_intervention(self.db, self.ops, args)  # fine before the tag
        self.tag()
        with self.assertRaisesRegex(ActionError, "declined Marketing Sprint"):
            aa.prepare_assign_intervention(self.db, self.ops, args)
        # matched by title too, in case ids differ between plan and catalogue
        self.db.data["diagnosticPlans"]["app1"]["declinedInterventions"] = {"other-key": {"title": "marketing sprint"}}
        with self.assertRaisesRegex(ActionError, "declined"):
            aa.prepare_assign_intervention(self.db, self.ops, args)

    def test_tag_only_blocks_that_intervention(self):
        self.tag()
        self.db.data["assignedInterventions"]["as1"]["status"] = "cancelled"
        aa.prepare_assign_intervention(self.db, self.ops, {"participantId": "p1", "interventionId": "iv1", "assigneeId": "cons1"})

    def test_find_participants_marks_declined(self):
        self.tag()
        rows = aa.tool_find_participants(self.db, self.ops, {})["participants"][0]["requiredInterventions"]
        flags = {r["interventionId"]: r.get("assignable", True) for r in rows}
        self.assertEqual(flags, {"iv1": True, "iv2": False})

    def test_declined_key_matches_web_rule(self):
        self.assertEqual(aa.declined_key(" a.b/c "), "a_b_c")

    def test_reschedule_dismisses_pending_drop_request(self):
        start = aa.parse_when(future(3, 10))
        self.db.data["appointments"]["apt1"] = {
            "companyCode": CO, "assignedInterventionId": "as1", "interventionTitle": "Financial Compliance",
            "participantId": "p1", "participantName": "Acme Bakery", "assigneeId": "cons1", "status": "declined",
            "declineNeedsReview": True, "startTime": start, "endTime": start + timedelta(hours=1)}
        self.db.data["assignedInterventions"]["as1"]["declineRequest"] = {"status": "requested", "reasonCode": "no_longer_needed"}
        new = {"appointmentId": "apt1", "start": future(6, 10), "end": future(6, 11)}
        confirm_proposal(self.db, self.store, self.ops, self.propose("reschedule_appointment", new)["id"])
        self.assertEqual(self.db.data["assignedInterventions"]["as1"]["declineRequest"]["status"], "dismissed")
        self.assertFalse(self.db.data["appointments"]["apt1"]["declineNeedsReview"])
        self.assertEqual(self.db.data["appointments"]["apt1"]["status"], "pending")


class ReadToolTests(Base):
    def test_find_participants_scoped_to_company(self):
        rival = {**self.db.data["applications"]["app1"], "companyCode": "CO2", "participantId": "pX", "beneficiaryName": "Acme Rival"}
        self.db.data["applications"]["appX"] = rival
        names = [p["name"] for p in aa.tool_find_participants(self.db, self.ops, {"query": "acme"})["participants"]]
        self.assertEqual(names, ["Acme Bakery"])

    def test_no_company_no_data(self):
        with self.assertRaises(ActionError):
            aa.tool_find_participants(self.db, actor(company=None), {})

    def test_list_appointments_consultant_sees_only_own(self):
        confirm_proposal(self.db, self.store, self.ops, self.propose("schedule_appointment", {"assignmentId": "as1", **slot()})["id"])
        window = {"from": future(1), "to": future(5)}
        self.assertEqual(len(aa.tool_list_appointments(self.db, actor("cons1", "consultant"), window)["appointments"]), 1)
        self.assertEqual(len(aa.tool_list_appointments(self.db, actor("cons2", "consultant"), window)["appointments"]), 0)


class PlannerTests(Base):
    def run_turn(self, replies, who=None):
        seen = []
        queue = list(replies)

        def model(system, payload, max_tokens, mime):
            seen.append(json.loads(json.dumps(payload, default=str)))
            return queue.pop(0)

        def extract(text):
            try:
                return json.loads(text)
            except ValueError:
                return None

        turn = run_agent_turn(self.db, who or self.ops, persona="You are Q.", base_payload={"userMessage": "hi"},
                              call_model=model, extract_json=extract, store=self.store)
        return turn, seen

    @staticmethod
    def call(name, args, reply=""):
        return json.dumps({"reply": reply, "toolCall": {"name": name, "arguments": args}})

    def test_read_then_propose_flow(self):
        turn, seen = self.run_turn([
            self.call("find_participants", {"query": "acme"}),
            self.call("schedule_appointment", {"assignmentId": "as1", **slot()}, "Ready when you are."),
        ])
        self.assertEqual(turn["reply"], "Ready when you are.")
        self.assertEqual(turn["proposal"]["tool"], "schedule_appointment")
        self.assertEqual(seen[1]["toolResults"][0]["result"]["participants"][0]["name"], "Acme Bakery")
        self.assertEqual(self.db.data["appointments"], {})

    def test_plain_answer_has_no_proposal(self):
        turn, _ = self.run_turn([json.dumps({"reply": "Which SME?", "toolCall": None})])
        self.assertEqual(turn, {"reply": "Which SME?", "proposal": None})

    def test_non_json_reply_falls_back_to_text(self):
        turn, _ = self.run_turn(["Just some prose."])
        self.assertEqual(turn["reply"], "Just some prose.")

    def test_validation_error_fed_back_to_model(self):
        turn, seen = self.run_turn([
            self.call("schedule_appointment", {"assignmentId": "as1", **slot(meetingType="in_person", meetingLink=None)}),
            json.dumps({"reply": "Where should we meet?", "toolCall": None}),
        ])
        self.assertIsNone(turn["proposal"])
        self.assertFalse(seen[1]["toolResults"][0]["result"]["ok"])
        self.assertIn("Where", seen[1]["toolResults"][0]["result"]["error"])

    def test_unpermitted_and_unknown_tools_refused(self):
        consultant = actor("cons1", "consultant")
        turn, seen = self.run_turn([
            self.call("assign_intervention", {"participantId": "p1", "interventionId": "iv2", "assigneeId": "cons1"}),
            self.call("drop_database", {}),
            json.dumps({"reply": "I can't do that.", "toolCall": None}),
        ], who=consultant)
        self.assertIsNone(turn["proposal"])
        self.assertEqual(len(self.db.data["assignedInterventions"]), 2)
        self.assertFalse(seen[1]["toolResults"][0]["result"]["ok"])
        self.assertFalse(seen[2]["toolResults"][1]["result"]["ok"])

    def test_round_limit(self):
        turn, _ = self.run_turn([self.call("find_participants", {})] * aa.MAX_TOOL_ROUNDS)
        self.assertIsNone(turn["proposal"])
        self.assertIn("couldn't complete", turn["reply"])

    def test_system_prompt_lists_only_permitted_tools(self):
        consultant = actor("cons1", "consultant")
        prompt = aa._system_prompt("Q", tools_for(consultant), consultant)
        self.assertIn("schedule_appointment", prompt)
        self.assertNotIn("assign_intervention", prompt)


if __name__ == "__main__":
    unittest.main()
