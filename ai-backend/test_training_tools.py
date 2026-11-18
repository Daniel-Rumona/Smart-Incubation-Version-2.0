import json
import unittest
from datetime import date, datetime, timedelta
from types import SimpleNamespace

import training_tools as tt
from agent_actions import Actor, ActionError, run_agent_turn


class Snap:
    def __init__(self, id, data):
        self.id, self._data = id, data

    def to_dict(self):
        return dict(self._data)


class Query:
    def __init__(self, rows, filters=()):
        self.rows, self.filters = rows, filters

    def where(self, field, op, value):
        assert op == "=="
        return Query(self.rows, self.filters + ((field, value),))

    def limit(self, _count):
        return self

    def stream(self):
        for id, data in self.rows.items():
            if all(data.get(field) == value for field, value in self.filters):
                yield Snap(id, data)


class FakeDB:
    def __init__(self, data):
        self.data = data
        self.read = []

    def collection(self, name):
        self.read.append(name)
        return Query(self.data.get(name, {}))


TODAY = date.today()
day = lambda offset: (TODAY + timedelta(days=offset)).isoformat()


def workspace():
    """Two companies: TNS (the viewer's) and OTHER, whose records must never come back."""
    done = {"companyCode": "TNS", "courseTitle": "ESG Awareness", "startDate": day(-30), "dayCount": 3, "passMarkPct": 70,
            "reassessmentsAllowed": 1, "groupAssignmentRequired": True, "deliveryMode": "in_person", "venue": "Room 1", "funderId": "f1"}
    return {
        "trainingClasses": {
            "c-done": done,
            "c-next": {**done, "startDate": day(14), "deliveryMode": "online", "venue": "", "funderId": None},
            "x-class": {**done, "companyCode": "OTHER", "courseTitle": "Secret course"},
        },
        "trainingLearners": {
            "pule": {"companyCode": "TNS", "classId": "c-done", "name": "Pule M", "organisation": "Kgalagadi", "email": "pule@x.test", "idNumber": "8001015009087",
                     "uid": "u-pule", "certificateId": "cert1", "attendance": {"1": {"present": True}, "2": {"present": True}, "3": {"present": True}}},
            "zanele": {"companyCode": "TNS", "classId": "c-done", "name": "Zanele D", "organisation": "Marula", "email": "z@x.test", "idNumber": "9001015009087",
                       "attendance": {"1": {"present": True}}, "idDocument": {"status": "pending"}},
            "emre": {"companyCode": "TNS", "classId": "c-done", "name": "Emre K", "organisation": "Anatolia", "attendance": {}},
            "kabelo": {"companyCode": "TNS", "classId": "c-next", "name": "Kabelo N", "organisation": "Kgalagadi", "email": "k@x.test", "attendance": {}},
            "x-person": {"companyCode": "OTHER", "classId": "x-class", "name": "Other Person", "organisation": "Elsewhere", "attendance": {}},
        },
        "trainingSubmissions": {
            "s1": {"companyCode": "TNS", "classId": "c-done", "learnerId": "pule", "kind": "post", "attempt": 1, "status": "marked", "scorePct": 85, "answers": {"q1": "secret answer"}},
            "s2": {"companyCode": "TNS", "classId": "c-done", "learnerId": "zanele", "kind": "post", "attempt": 1, "status": "marked", "scorePct": 50},
            "s3": {"companyCode": "TNS", "classId": "c-done", "learnerId": "zanele", "kind": "post", "attempt": 2, "status": "marked", "scorePct": 60},
            "s4": {"companyCode": "TNS", "classId": "c-done", "learnerId": "emre", "kind": "post", "attempt": 1, "status": "marked", "scorePct": 65},
            "s5": {"companyCode": "TNS", "classId": "c-done", "learnerId": "emre", "kind": "pre", "attempt": 1, "status": "submitted"},
        },
        "trainingGroups": {
            "g1": {"companyCode": "TNS", "classId": "c-done", "name": "Group A", "learnerIds": ["pule", "zanele", "emre"], "absentLearnerIds": [], "markedAt": day(-28)},
        },
        "trainingCertificates": {
            "cert1": {"companyCode": "TNS", "certificateNumber": "TNS-2026-0001", "learnerName": "Pule M", "organisation": "Kgalagadi", "courseTitle": "ESG Awareness", "issuedOn": day(-28), "status": "valid"},
            "x-cert": {"companyCode": "OTHER", "certificateNumber": "OTH-1", "learnerName": "Other Person", "issuedOn": day(-1), "status": "valid"},
        },
        "trainingFunders": {"f1": {"companyCode": "TNS", "name": "Green Fund", "contactEmail": "funder@x.test"}},
        "clientRevenue": {
            "r1": {"companyCode": "TNS", "date": day(-29), "organisation": "Kgalagadi", "service": "training", "classId": "c-done", "amount": 4500, "status": "paid"},
            "r2": {"companyCode": "TNS", "date": day(-1), "organisation": "Marula", "service": "esg_reporting", "amount": 60000, "status": "invoiced"},
            "x-r": {"companyCode": "OTHER", "date": day(-1), "organisation": "Elsewhere", "amount": 999999, "status": "paid"},
        },
        "trainingSurveys": {"sv1": {"companyCode": "TNS", "title": "Feedback", "audience": "learners", "status": "closed", "hideNames": True, "classIds": ["c-done"],
                                    "questions": [{"id": "q1", "type": "rating", "text": "Clear?"}, {"id": "q2", "type": "text", "text": "Most useful"}]}},
        "trainingSurveyResponses": {
            "a": {"companyCode": "TNS", "surveyId": "sv1", "name": "Pule M", "answers": {"q1": 5, "q2": "The case study"}},
            "b": {"companyCode": "TNS", "surveyId": "sv1", "name": "Zanele D", "answers": {"q1": 4}},
        },
        "esgReports": {"e1": {"companyCode": "TNS", "clientName": "Kgalagadi", "status": "in_review", "frameworks": ["jse"], "funderId": "f1",
                              "indicators": [{"indicator": "Water", "current": "79 500"}, {"indicator": "Scope 3", "current": ""}], "risks": [{"risk": "Water", "status": "Open"}]}},
    }


def actor(role="projectadmin", uid="u-keletso", company="TNS"):
    return Actor(uid=uid, role=role, company_code=company, name="Keletso", email=None, permissions=frozenset())


def dumped(result):
    return json.dumps(result, default=str)


class ScopeAndPrivacy(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB(workspace())

    def test_every_staff_tool_sees_only_the_viewers_company_and_no_private_fields(self):
        args = {"find_learners": {"query": "e"}, "survey_results": {"surveyId": "sv1"}}
        for tool in tt.STAFF_TOOLS:
            text = dumped(tool.run(self.db, actor(), args.get(tool.name, {})))
            for leaked in ("Secret course", "Other Person", "OTH-1", "999999", "Elsewhere"):
                self.assertNotIn(leaked, text, f"{tool.name} returned {leaked}")
            for private in ("@x.test", "8001015009087", "9001015009087", "u-pule", "secret answer"):
                self.assertNotIn(private, text, f"{tool.name} returned {private}")

    def test_without_a_company_nothing_is_read(self):
        with self.assertRaises(ActionError):
            tt.tool_training_classes(self.db, actor(company=None), {})
        self.assertEqual(self.db.read, [])

    def test_tools_by_role(self):
        who = lambda role, **kw: SimpleNamespace(role=role, company_code="TNS", is_service=False, **kw)
        self.assertEqual({t.name for t in tt.training_tools_for(who("projectadmin"))}, {t.name for t in tt.STAFF_TOOLS})
        self.assertEqual([t.name for t in tt.training_tools_for(who("learner"))], ["my_training"])
        self.assertEqual(tt.training_tools_for(who("funder")), [])
        self.assertEqual(tt.training_tools_for(who("clientorg")), [])
        self.assertEqual(tt.training_tools_for(SimpleNamespace(role="projectadmin", company_code=None, is_service=False)), [])
        self.assertEqual(tt.training_tools_for(SimpleNamespace(role="projectadmin", company_code="TNS", is_service=True)), [])

    def test_a_learner_sees_only_their_own_training(self):
        result = tt.tool_my_training(self.db, actor(role="learner", uid="u-pule"), {})
        self.assertEqual(len(result["enrolments"]), 1)
        self.assertEqual(result["enrolments"][0]["result"], "passed")
        self.assertEqual(result["enrolments"][0]["certificate"]["number"], "TNS-2026-0001")
        self.assertNotIn("Zanele", dumped(result))
        self.assertEqual(tt.tool_my_training(self.db, actor(role="learner", uid="nobody"), {}), {"enrolments": []})


class Results(unittest.TestCase):
    def setUp(self):
        self.db = FakeDB(workspace())

    def test_class_detail_applies_the_pass_rule(self):
        result = tt.tool_training_class_detail(self.db, actor(), {"classId": "c-done"})
        by_name = {row["name"]: row for row in result["learners"]}
        self.assertEqual(result["class"]["phase"], "finished")
        self.assertEqual(result["class"]["funder"], "Green Fund")
        self.assertEqual(by_name["Pule M"]["status"], "passed")
        self.assertEqual(by_name["Pule M"]["daysPresent"], "3 of 3")
        self.assertEqual(by_name["Zanele D"]["status"], "not passed")
        self.assertEqual(by_name["Zanele D"]["postScorePct"], 60)
        self.assertEqual(by_name["Zanele D"]["idCopy"], "uploaded, to check")
        self.assertEqual(by_name["Emre K"]["status"], "reassessment available")

    def test_class_detail_without_an_id_takes_the_latest_started_class(self):
        self.assertEqual(tt.tool_training_class_detail(self.db, actor(), {})["class"]["classId"], "c-done")

    def test_an_unknown_class_is_an_error_the_model_can_explain(self):
        with self.assertRaises(ActionError):
            tt.tool_training_class_detail(self.db, actor(), {"classId": "x-class"})

    def test_group_required_but_not_marked(self):
        data = workspace()
        data["trainingGroups"]["g1"]["markedAt"] = None
        result = tt.tool_training_class_detail(FakeDB(data), actor(), {"classId": "c-done"})
        self.assertEqual({r["name"]: r["status"] for r in result["learners"]}["Pule M"], "awaiting the group assignment mark")

    def test_to_do(self):
        result = tt.tool_training_to_do(self.db, actor(), {})
        self.assertEqual(result["totals"]["testsToMark"], 1)
        self.assertEqual(result["testsToMark"][0]["learner"], "Emre K")
        self.assertEqual([r["learner"] for r in result["idCopiesToCheck"]], ["Zanele D"])
        self.assertEqual([r["learner"] for r in result["learnersNotYetInvited"]], ["Kabelo N"])

    def test_results_by_organisation(self):
        rows = {r["organisation"]: r for r in tt.tool_results_by_organisation(self.db, actor(), {"classId": "c-done"})["organisations"]}
        self.assertEqual(rows["Kgalagadi"], {"organisation": "Kgalagadi", "learners": 1, "passed": 1, "certificates": 1, "averagePostScorePct": 85, "attendancePct": 100})
        self.assertEqual(rows["Marula"]["attendancePct"], 33)

    def test_income(self):
        result = tt.tool_training_income(self.db, actor(), {})
        self.assertEqual(result["total"], 64500)
        self.assertEqual(result["byStatus"], {"paid": 4500, "invoiced": 60000})
        self.assertEqual(tt.tool_training_income(self.db, actor(), {"from": day(-7)})["total"], 60000)

    def test_surveys_hide_names_when_the_survey_does(self):
        result = tt.tool_survey_results(self.db, actor(), {"surveyId": "sv1"})
        self.assertEqual(result["questions"][0]["average"], 4.5)
        self.assertEqual(result["questions"][1]["comments"], [{"text": "The case study"}])
        listing = tt.tool_survey_results(self.db, actor(), {})
        self.assertEqual(listing["surveys"][0]["responses"], 2)

    def test_esg_reports_and_funders(self):
        report = tt.tool_esg_reports(self.db, actor(), {})["reports"][0]
        self.assertEqual(report["indicatorsWithoutCurrentValue"], ["Scope 3"])
        self.assertEqual(report["openRisks"], 1)
        funder = tt.tool_training_funders(self.db, actor(), {})["funders"][0]
        self.assertEqual((funder["learners"], funder["income"], funder["esgReports"]), (3, 4500, ["Kgalagadi"]))


class ThroughTheAgentTurn(unittest.TestCase):
    def test_the_model_calls_a_training_tool_and_answers_from_it(self):
        db = FakeDB(workspace())
        seen = []
        replies = [
            json.dumps({"reply": "", "toolCall": {"name": "training_to_do", "arguments": {}}}),
            json.dumps({"reply": "One assessment to mark: Emre's.", "toolCall": None}),
        ]

        def model(system, payload, *_):
            seen.append((system, json.loads(json.dumps(payload, default=str))))
            return replies.pop(0)

        turn = run_agent_turn(db, actor(), persona="You are Q.", base_payload={"userMessage": "what needs marking?"},
                              call_model=model, extract_json=json.loads, tools=tt.STAFF_TOOLS,
                              intro=tt.TRAINING_TOOLS_INTRO, fallback_reply=tt.TRAINING_FALLBACK, store=object())
        self.assertEqual(turn, {"reply": "One assessment to mark: Emre's.", "proposal": None})
        self.assertIn("read-only tools", seen[0][0])
        self.assertNotIn("appointments and interventions", seen[0][0])
        self.assertNotIn("assign_intervention", seen[0][0])
        self.assertEqual(seen[1][1]["toolResults"][0]["result"]["totals"]["testsToMark"], 1)

    def test_an_incubation_tool_is_not_available_to_the_training_assistant(self):
        replies = [json.dumps({"reply": "", "toolCall": {"name": "find_participants", "arguments": {}}}), json.dumps({"reply": "done", "toolCall": None})]
        seen = []

        def model(system, payload, *_):
            seen.append(payload)
            return replies.pop(0)

        run_agent_turn(FakeDB(workspace()), actor(), persona="Q", base_payload={}, call_model=model, extract_json=json.loads,
                       tools=tt.STAFF_TOOLS, store=object())
        self.assertEqual(seen[1]["toolResults"][0]["result"], {"ok": False, "error": "That tool isn't available."})


if __name__ == "__main__":
    unittest.main()
