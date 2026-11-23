import json
import unittest
from datetime import datetime, timedelta
from types import SimpleNamespace

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import agent_actions as aa
import training_agent as ta
from agent_actions import ActionError, build_actor, confirm_proposal, run_agent_turn, tools_for
from test_agent_actions import Batch, Coll, Doc, FakeDB, MemStore

ta.register(aa.register_tools, aa.register_permission_source)

CO = "TNS"


class DottedDoc(Doc):
    """Firestore's update() reads 'a.b' as a nested field."""

    def update(self, data):
        row = self.db.data[self.name][self.id]
        for key, value in data.items():
            target = row
            *parents, last = key.split(".")
            for part in parents:
                target = target.setdefault(part, {})
            target[last] = value


class DottedColl(Coll):
    def document(self, id=None):
        self.db.n += 1
        return DottedDoc(self.db, self.name, id or f"auto{self.db.n}")


class DB(FakeDB):
    def collection(self, name):
        return DottedColl(self, name)

    def batch(self):
        return Batch()


def day(offset):
    return (datetime.now(aa._timezone()).date() + timedelta(days=offset)).isoformat()


def mark(present):
    return {"present": present, "recordedAt": "2026-11-01T08:00:00Z", "recordedBy": "learner"}


def make_db():
    return DB({
        "companies": {CO: {"companyName": "Tau Namagadi", "awarenessTrainingEnabled": True}, "INC": {"companyName": "Incubator"}},
        "trainingAssessments": {"a1": {"companyCode": CO, "title": "ESG basics test"}},
        "trainingClasses": {
            # Started two days ago, three days long: running today, day 3 is today.
            "c1": {"companyCode": CO, "courseTitle": "ESG Awareness", "startDate": day(-2), "dayCount": 3, "deliveryMode": "in_person", "venue": "Sandton",
                   "assessmentId": "a1", "passMarkPct": 60, "reassessmentsAllowed": 1, "groupAssignmentRequired": True, "testsOpen": {"pre": True, "post": False}},
            "c2": {"companyCode": CO, "courseTitle": "Climate Basics", "startDate": day(10), "dayCount": 1, "deliveryMode": "hybrid", "passMarkPct": 70,
                   "reassessmentsAllowed": 0, "groupAssignmentRequired": False, "testsOpen": {}},
            "other": {"companyCode": "DEMO", "courseTitle": "Someone else's", "startDate": day(-1), "dayCount": 1, "testsOpen": {}},
        },
        "trainingLearners": {
            "l1": {"companyCode": CO, "classId": "c1", "name": "Ann Dube", "email": "ann@x.co", "idNumber": "8001015009087", "organisation": "Eskom",
                   "attendance": {"1": mark(True), "2": mark(True)}, "idDocument": {"status": "pending", "uploadedAt": "2026-11-17T09:00:00Z"}, "certificateId": "cert1", "uid": "u1"},
            "l2": {"companyCode": CO, "classId": "c1", "name": "Ben Mokoena", "email": "ben@x.co", "idNumber": "9001015009087", "organisation": "Eskom",
                   "attendance": {"1": mark(True), "2": mark(False)}},
            "l3": {"companyCode": CO, "classId": "c1", "name": "Cara Naidoo", "organisation": "Sasol", "attendance": {"1": mark(True)},
                   "idDocument": {"status": "queried", "note": "Blurry", "uploadedAt": "2026-11-16T09:00:00Z"}},
            "x1": {"companyCode": "DEMO", "classId": "other", "name": "Not ours", "organisation": "Elsewhere", "attendance": {}},
        },
        "trainingSubmissions": {
            "s1": {"companyCode": CO, "classId": "c1", "learnerId": "l1", "kind": "pre", "attempt": 1, "status": "marked", "scorePct": 40},
            "s2": {"companyCode": CO, "classId": "c1", "learnerId": "l1", "kind": "post", "attempt": 1, "status": "marked", "scorePct": 80},
            "s3": {"companyCode": CO, "classId": "c1", "learnerId": "l2", "kind": "pre", "attempt": 1, "status": "marked", "scorePct": 60},
            "s4": {"companyCode": CO, "classId": "c1", "learnerId": "l2", "kind": "post", "attempt": 1, "status": "marked", "scorePct": 50},
            "s5": {"companyCode": CO, "classId": "c1", "learnerId": "l3", "kind": "post", "attempt": 1, "status": "submitted", "submittedAt": "2026-11-18T10:00:00Z"},
            "sx": {"companyCode": "DEMO", "classId": "other", "learnerId": "x1", "kind": "post", "attempt": 1, "status": "submitted"},
        },
        "trainingGroups": {"g1": {"companyCode": CO, "classId": "c1", "learnerIds": ["l1", "l2"], "absentLearnerIds": [], "markedAt": "2026-11-18T12:00:00Z"}},
        "trainingSurveys": {"sv1": {"companyCode": CO, "title": "Class feedback", "audience": "learners", "status": "open", "questions": [
            {"id": "q1", "type": "rating", "text": "How useful was the class?"},
            {"id": "q2", "type": "yesno", "text": "Would you recommend it?"},
            {"id": "q3", "type": "text", "text": "Any comments?"},
        ]}},
        "trainingSurveyResponses": {
            "r1": {"companyCode": CO, "surveyId": "sv1", "name": "Ann Dube", "answers": {"q1": 5, "q2": "yes", "q3": "Great facilitator"}},
            "r2": {"companyCode": CO, "surveyId": "sv1", "name": "Ben Mokoena", "answers": {"q1": 4, "q2": "no"}},
        },
    })


def identity(role="operations", company=CO, uid="staff1", service=False):
    return SimpleNamespace(uid=uid, role=role, company_code=company, email=f"{uid}@x.co", is_service=service)


def staff(db, **kwargs):
    return build_actor(db, identity(**kwargs))


TRAINING_TOOL_NAMES = {tool.name for tool in ta.TRAINING_TOOLS}


class PermissionTests(unittest.TestCase):
    def test_training_staff_get_the_training_tools_only_in_the_training_scope(self):
        db = make_db()
        actor = staff(db)
        self.assertTrue(actor.can(ta.TRAINING_PERMISSION))
        self.assertEqual({t.name for t in tools_for(actor, ta.TRAINING_SCOPE)}, TRAINING_TOOL_NAMES)
        self.assertFalse(TRAINING_TOOL_NAMES & {t.name for t in tools_for(actor)})

    def test_others_get_none(self):
        db = make_db()
        for who in (identity(role="learner"), identity(role="funder"), identity(role="clientorg"), identity(company="INC"), identity(service=True)):
            self.assertEqual(tools_for(build_actor(db, who), ta.TRAINING_SCOPE), [], who)

    def test_confirm_rechecks_the_permission(self):
        db = make_db()
        store = MemStore(db)
        tool = aa.TOOLS["set_assessment_open"]
        proposal = store.create(staff(db), tool, ta.prepare_set_assessment_open(db, staff(db), {"classId": "c1", "test": "post", "open": True}))
        db.data["companies"][CO]["awarenessTrainingEnabled"] = False  # switched off since it was proposed
        with self.assertRaises(ActionError):
            confirm_proposal(db, store, staff(db), proposal["id"])
        self.assertFalse(db.data["trainingClasses"]["c1"]["testsOpen"]["post"])


class ResultTests(unittest.TestCase):
    def test_class_phase(self):
        db = make_db()
        self.assertEqual(ta.class_phase(db.data["trainingClasses"]["c1"]), "running")
        self.assertEqual(ta.class_phase(db.data["trainingClasses"]["c2"]), "upcoming")
        self.assertEqual(ta.class_phase({"startDate": day(-5), "dayCount": 2}), "finished")
        finished_today = {"startDate": day(0), "dayCount": 1, "hours": {"start": "00:00", "end": "00:00"}}
        self.assertEqual(ta.class_phase(finished_today), "finished")
        self.assertEqual(ta.class_phase({"startDate": "", "dayCount": 1}), "unknown")

    def test_learner_result_follows_the_pass_rule(self):
        cls = {"passMarkPct": 60, "reassessmentsAllowed": 1, "groupAssignmentRequired": True}
        subs = [{"learnerId": "a", "kind": "post", "status": "marked", "scorePct": 70}, {"learnerId": "b", "kind": "post", "status": "marked", "scorePct": 40}]
        marked_group = [{"learnerIds": ["a", "b"], "absentLearnerIds": [], "markedAt": "x"}]
        self.assertEqual(ta.learner_result(cls, {"id": "a"}, subs, marked_group)["status"], "passed")
        self.assertEqual(ta.learner_result(cls, {"id": "a"}, subs, [])["status"], "awaiting_group")
        self.assertEqual(ta.learner_result(cls, {"id": "a"}, subs, [{**marked_group[0], "absentLearnerIds": ["a"]}])["status"], "not_passed")
        self.assertEqual(ta.learner_result(cls, {"id": "b"}, subs, marked_group)["status"], "reassessment_available")
        self.assertEqual(ta.learner_result(cls, {"id": "c"}, subs, marked_group)["status"], "not_started")


class ReadToolTests(unittest.TestCase):
    def setUp(self):
        self.db = make_db()
        self.actor = staff(self.db)

    def test_list_classes_is_company_scoped(self):
        result = ta.tool_list_training_classes(self.db, self.actor, {})
        self.assertEqual([c["classId"] for c in result["classes"]], ["c2", "c1"])
        c1 = next(c for c in result["classes"] if c["classId"] == "c1")
        self.assertEqual((c1["learners"], c1["phase"], c1["postAssessment"], c1["preOpen"]), (3, "running", "ESG basics test", True))
        self.assertEqual([c["classId"] for c in ta.tool_list_training_classes(self.db, self.actor, {"phase": "upcoming"})["classes"]], ["c2"])

    def test_class_results(self):
        result = ta.tool_get_class_results(self.db, self.actor, {"classId": "c1"})
        self.assertEqual(result["totals"]["byStatus"], {"passed": 1, "reassessment_available": 1, "awaiting_marking": 1})
        self.assertEqual(result["totals"]["averagePostPct"], 65.0)
        self.assertEqual(result["byOrganisation"], [{"organisation": "Eskom", "learners": 2, "passed": 1}, {"organisation": "Sasol", "learners": 1, "passed": 0}])
        self.assertEqual(result["attendanceByDay"][1], {"day": 2, "present": 1, "absent": 1, "notMarked": 1})
        ann = next(r for r in result["learners"] if r["learnerId"] == "l1")
        self.assertEqual((ann["daysPresent"], ann["idCopy"], ann["certified"]), (2, "pending", True))
        text = json.dumps(result)
        self.assertNotIn("ann@x.co", text)
        self.assertNotIn("8001015009087", text)

    def test_other_companies_records_are_out_of_reach(self):
        with self.assertRaises(ActionError):
            ta.tool_get_class_results(self.db, self.actor, {"classId": "other"})

    def test_marking_backlog(self):
        result = ta.tool_list_marking_backlog(self.db, self.actor, {})
        self.assertEqual(result["total"], 1)
        self.assertEqual(result["submissions"][0]["learner"], "Cara Naidoo")
        self.assertEqual(result["submissions"][0]["test"], "post-assessment")

    def test_id_copies(self):
        self.assertEqual([l["name"] for l in ta.tool_list_id_copies(self.db, self.actor, {})["learners"]], ["Ann Dube"])
        queried = ta.tool_list_id_copies(self.db, self.actor, {"status": "queried"})["learners"]
        self.assertEqual(queried[0]["note"], "Blurry")
        self.assertEqual([l["name"] for l in ta.tool_list_id_copies(self.db, self.actor, {"status": "missing"})["learners"]], ["Ben Mokoena"])

    def test_missing_id_copies_cover_all_classes_including_finished_ones(self):
        self.db.data["trainingClasses"]["old"] = {"companyCode": CO, "courseTitle": "Old class", "startDate": day(-30), "dayCount": 1, "testsOpen": {}}
        self.db.data["trainingLearners"]["l9"] = {"companyCode": CO, "classId": "old", "name": "Ayanda Zulu", "organisation": "Transnet", "attendance": {}}
        result = ta.tool_list_id_copies(self.db, self.actor, {"status": "missing"})
        self.assertEqual([(l["name"], l["classPhase"]) for l in result["learners"]], [("Ben Mokoena", "running"), ("Ayanda Zulu", "finished")])
        self.assertEqual((result["scope"], result["learnersChecked"], result["classesChecked"]), ("all classes", 4, 2))
        self.assertEqual(result["byClassPhase"], {"running": 1, "finished": 1})
        one = ta.tool_list_id_copies(self.db, self.actor, {"status": "missing", "classId": "old"})
        self.assertEqual((one["scope"], one["total"]), ("one class", 1))
        with self.assertRaises(ActionError):
            ta.tool_list_id_copies(self.db, self.actor, {"status": "missing", "classId": "other"})

    def test_tool_description_does_not_limit_the_scope(self):
        self.assertIn("ALL classes", aa.TOOLS["list_id_copies"].description)
        self.assertNotIn("not yet finished", aa.TOOLS["list_id_copies"].description)

    def test_organisations(self):
        rows = ta.tool_list_organisation_results(self.db, self.actor, {})["organisations"]
        self.assertEqual(rows[0], {"organisation": "Eskom", "learners": 2, "certified": 1, "classes": 1})

    def test_survey_results_without_names(self):
        listing = ta.tool_get_survey_results(self.db, self.actor, {})
        self.assertEqual(listing["surveys"][0]["responses"], 2)
        result = ta.tool_get_survey_results(self.db, self.actor, {"surveyId": "sv1"})
        self.assertEqual(result["questions"][0]["averageOutOf5"], 4.5)
        self.assertEqual(result["questions"][1]["counts"], {"yes": 1, "no": 1})
        self.assertEqual(result["questions"][2]["comments"], ["Great facilitator"])
        self.assertNotIn("Ann Dube", json.dumps(result))


class WriteToolTests(unittest.TestCase):
    def setUp(self):
        self.db = make_db()
        self.actor = staff(self.db)
        self.store = MemStore(self.db)

    def propose_and_confirm(self, name, args):
        tool = aa.TOOLS[name]
        proposal = self.store.create(self.actor, tool, tool.prepare(self.db, self.actor, args))
        return proposal, confirm_proposal(self.db, self.store, self.actor, proposal["id"])

    def test_open_post_assessment(self):
        proposal, outcome = self.propose_and_confirm("set_assessment_open", {"classId": "c1", "test": "post-assessment", "open": "true"})
        self.assertEqual(proposal["title"], "Open the post-assessment")
        self.assertTrue(self.db.data["trainingClasses"]["c1"]["testsOpen"]["post"])
        self.assertEqual(self.db.data["trainingClasses"]["c1"]["updatedBy"], "staff1")
        with self.assertRaisesRegex(ActionError, "already open"):
            ta.prepare_set_assessment_open(self.db, self.actor, {"classId": "c1", "test": "post", "open": True})

    def test_cannot_open_a_test_the_class_has_not_chosen(self):
        with self.assertRaisesRegex(ActionError, "no post-assessment"):
            ta.prepare_set_assessment_open(self.db, self.actor, {"classId": "c2", "test": "post", "open": True})

    def test_record_attendance_marks_everyone_else_present_and_keeps_existing_marks(self):
        prepared = ta.prepare_record_attendance(self.db, self.actor, {"classId": "c1", "day": 2, "absentLearnerIds": ["l3"]})
        # l1 and l2 already have a day-2 mark (one recorded by the learner), so only l3 is marked.
        self.assertEqual((prepared.payload["presentLearnerIds"], prepared.payload["absentLearnerIds"]), ([], ["l3"]))
        self.assertIn("2 learner(s) already marked", prepared.warnings[0])
        self.propose_and_confirm("record_attendance", {"classId": "c1", "day": 3, "absentLearnerIds": ["l2"]})
        learners = self.db.data["trainingLearners"]
        self.assertTrue(learners["l1"]["attendance"]["3"]["present"])
        self.assertFalse(learners["l2"]["attendance"]["3"]["present"])
        self.assertEqual(learners["l3"]["attendance"]["3"]["recordedBy"], "facilitator")
        self.assertTrue(learners["l1"]["attendance"]["1"]["present"])  # other days untouched

    def test_record_attendance_overwrite(self):
        prepared = ta.prepare_record_attendance(self.db, self.actor, {"classId": "c1", "day": 2, "everyonePresent": True, "overwrite": True})
        self.assertEqual(prepared.payload["presentLearnerIds"], ["l1", "l2", "l3"])
        self.assertIn("replaces", prepared.warnings[0])

    def test_record_attendance_validation(self):
        with self.assertRaisesRegex(ActionError, "hasn't happened"):
            ta.prepare_record_attendance(self.db, self.actor, {"classId": "c2", "day": 1, "everyonePresent": True})
        with self.assertRaisesRegex(ActionError, "not in this class"):
            ta.prepare_record_attendance(self.db, self.actor, {"classId": "c1", "day": 3, "absentLearnerIds": ["x1"]})
        with self.assertRaisesRegex(ActionError, "Who was absent"):
            ta.prepare_record_attendance(self.db, self.actor, {"classId": "c1", "day": 3})
        with self.assertRaisesRegex(ActionError, "3 training day"):
            ta.prepare_record_attendance(self.db, self.actor, {"classId": "c1", "day": 4, "everyonePresent": True})

    def test_review_id_copy(self):
        with self.assertRaisesRegex(ActionError, "note"):
            ta.prepare_review_id_copy(self.db, self.actor, {"learnerId": "l1", "status": "queried"})
        with self.assertRaisesRegex(ActionError, "hasn't uploaded"):
            ta.prepare_review_id_copy(self.db, self.actor, {"learnerId": "l2", "status": "verified"})
        proposal, _ = self.propose_and_confirm("review_id_copy", {"learnerId": "l1", "status": "verified"})
        self.assertIn("can't see ID documents", proposal["warnings"][0])
        document = self.db.data["trainingLearners"]["l1"]["idDocument"]
        self.assertEqual((document["status"], document["reviewedBy"]), ("verified", "staff1"))


class TurnTests(unittest.TestCase):
    def test_training_turn_reads_then_proposes(self):
        db = make_db()
        actor = staff(db)
        prompts, replies = [], iter([
            json.dumps({"reply": "", "toolCall": {"name": "list_training_classes", "arguments": {"phase": "running"}}}),
            json.dumps({"reply": "Ready to open it.", "toolCall": {"name": "set_assessment_open", "arguments": {"classId": "c1", "test": "post", "open": True}}}),
        ])

        def call_model(system, payload, *args):
            prompts.append((system, payload))
            return next(replies)

        turn = run_agent_turn(db, actor, persona="You are Q for Tau Namagadi.", base_payload={"userMessage": "open the post test"},
                              call_model=call_model, extract_json=json.loads, store=MemStore(db),
                              scope=ta.TRAINING_SCOPE, intro=ta.TRAINING_INTRO, fallback=ta.TRAINING_FALLBACK, rules=ta.TRAINING_RULES)
        self.assertEqual(turn["proposal"]["title"], "Open the post-assessment")
        system = prompts[0][0]
        self.assertIn("training workspace's records", system)
        # The training rules come after the general "ask when a detail is missing" rule, so they take precedence.
        self.assertGreater(system.index("Never ask the same question twice"), system.index("ask ONE concise question"))
        self.assertIn("cover ALL classes", system)
        self.assertNotIn("Watches and chasers", system)
        self.assertNotIn("assign_intervention", system)
        self.assertEqual(prompts[1][1]["toolResults"][0]["result"]["classes"][0]["classId"], "c1")


class DraftAndSummaryTests(unittest.TestCase):
    def test_clean_questions(self):
        raw = [
            {"type": "choice", "text": "What is Scope 1?", "marks": 1, "options": ["Direct", "Purchased power", "Supply chain"], "answer": "direct"},
            {"type": "choice", "text": "Answer missing from options", "options": ["A", "B", "C"], "answer": "D"},
            {"type": "written", "text": "Explain Scope 2.", "marks": 3, "answer": "Emissions from purchased electricity."},
            {"type": "written", "text": "No answer"},
        ]
        mixed = ta.clean_questions(raw, "mixed", 10)
        self.assertEqual([q["text"] for q in mixed], ["What is Scope 1?", "Explain Scope 2."])
        self.assertEqual(mixed[0]["memo"], "Direct")
        self.assertEqual([q["type"] for q in ta.clean_questions(raw, "written", 10)], ["written"])
        self.assertEqual(len(ta.clean_questions(raw, "mixed", 1)), 1)

    def test_summary_flags_figures_not_in_the_report(self):
        summary = {"training": {"learners": 40, "learnersCertified": 30, "people": {"female": 25, "male": 15, "youth": 12}}, "revenue": {"last12Months": 125000}}
        allowed = ta.summary_figures(summary)
        self.assertEqual(ta.unmatched_figures("40 learners, 30 certified (75%), women 63%, R 125 000 earned, 999 jobs.", allowed), ["999"])

    def test_public_summary_leaves_out_esg_unless_shown(self):
        summary = {"companyName": "TN", "organisations": [{"name": "Eskom", "learners": 2, "esgReports": 1, "secret": "x"}], "esg": {"reports": 1}}
        hidden = ta._public_summary(summary, False)
        self.assertNotIn("esg", hidden)
        self.assertEqual(hidden["organisations"], [{"name": "Eskom", "learners": 2}])
        self.assertIn("esg", ta._public_summary(summary, True))


class RouterTests(unittest.TestCase):
    def setUp(self):
        self.db = make_db()
        self.db.data["trainingLibrary"] = {
            "slides": {"companyCode": CO, "title": "ESG slides"},
            "theirs": {"companyCode": "DEMO", "title": "Not ours"},
            "empty": {"companyCode": CO, "title": "Scanned PDF"},
        }
        self.db.data["trainingLibraryTexts"] = {"slides": {"text": "Scope 1 emissions are direct."}, "theirs": {"text": "secret"}}
        self.calls = []
        self.reply = json.dumps({"questions": [{"type": "choice", "text": "What is Scope 1?", "marks": 1, "options": ["Direct", "Indirect", "Neither"], "answer": "Direct"}]})
        self.who = identity()

        def call_model(system, payload, *args, **kwargs):
            self.calls.append(payload)
            return self.reply

        def require_auth(authorization):
            if not authorization:
                raise HTTPException(status_code=401, detail="no")
            return self.who

        app = FastAPI()
        app.include_router(ta.create_training_router(self.db, call_model, require_auth, json.loads))
        self.client = TestClient(app)

    def post(self, path, body):
        return self.client.post(path, json=body, headers={"Authorization": "Bearer t"})

    def test_draft_assessment(self):
        response = self.post("/api/training/draft-assessment", {"libraryItemIds": ["slides"], "count": 5})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["questions"][0]["memo"], "Direct")
        self.assertEqual(self.calls[0]["material"][0]["text"], "Scope 1 emissions are direct.")

    def test_draft_refuses_other_companies_items_unreadable_files_and_learners(self):
        self.assertEqual(self.post("/api/training/draft-assessment", {"libraryItemIds": ["theirs"]}).status_code, 404)
        self.assertEqual(self.post("/api/training/draft-assessment", {"libraryItemIds": ["empty"]}).json()["detail"], "no_readable_text")
        self.who = identity(role="learner")
        self.assertEqual(self.post("/api/training/draft-assessment", {"libraryItemIds": ["slides"]}).status_code, 403)
        self.assertEqual(self.calls, [])

    def test_funder_summary(self):
        self.reply = "Tau Namagadi trained 40 learners and 77 others."
        self.who = identity(role="funder")
        response = self.post("/api/training/funder-summary", {"summary": {"training": {"learners": 40}}, "showEsg": False})
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()["unmatchedFigures"], ["77"])
        self.who = identity(role="incubatee")
        self.assertEqual(self.post("/api/training/funder-summary", {"summary": {}}).status_code, 403)


if __name__ == "__main__":
    unittest.main()
