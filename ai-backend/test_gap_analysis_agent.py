import json
import unittest

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import gap_analysis_agent as gaa


def make_client(model_reply, authorised=True):
    calls = []

    def require_auth(_authorization):
        if not authorised:
            raise HTTPException(status_code=401, detail="Sign in required")
        return {"uid": "ops-1"}

    def call_model(system_prompt, payload, **kwargs):
        calls.append(payload)
        return model_reply if isinstance(model_reply, str) else json.dumps(model_reply)

    app = FastAPI()
    app.include_router(gaa.create_gap_analysis_router(call_model, require_auth))
    return TestClient(app), calls


REQUEST = {
    "title": "Business diagnostic",
    "sections": [
        {"title": "Sales & marketing", "questions": [
            {"question": "Current sales channels", "type": "text", "answer": "WhatsApp only"},
            {"question": "Diagnostic rating", "type": "rating", "answer": 2},
        ]},
        {"title": "Compliance", "questions": [
            {"question": "Business registration", "type": "radio", "answer": "No"},
        ]},
    ],
    "catalogue": [
        {"id": "mkt", "title": "Social media marketing", "areaOfSupport": "Marketing"},
        {"id": "cipc", "title": "Company registration", "areaOfSupport": "Compliance"},
        {"id": "books", "title": "Bookkeeping setup", "areaOfSupport": "Finance"},
    ],
    "alreadyPlanned": ["books"],
}


class GapAnalysisTests(unittest.TestCase):
    def test_normalises_scores_gaps_and_catalogue_ids(self):
        client, calls = make_client({
            "summary": "Early-stage caterer.",
            "scorecard": [
                {"area": "Sales & marketing", "score": 7, "finding": "One channel."},
                {"area": "Sales & marketing", "score": 2, "finding": "Duplicate."},
                {"area": "Compliance", "score": "2", "finding": "Not registered."},
            ],
            "strengths": ["Skilled cook", ""],
            "gaps": [
                {"area": "Sales", "finding": "No marketing", "priority": "medium", "interventionIds": ["mkt", "made-up", "books"]},
                {"area": "Compliance", "finding": "Not registered", "priority": "HIGH", "interventionIds": ["Company registration"]},
                {"area": "x", "finding": ""},
            ],
        })
        response = client.post("/api/gap-analysis/analyse", json=REQUEST)
        self.assertEqual(response.status_code, 200)
        body = response.json()

        self.assertEqual([entry["score"] for entry in body["scorecard"]], [5, 2])
        self.assertEqual(body["strengths"], ["Skilled cook"])
        # High priority first; title-matched id resolved; unknown and already-planned ids dropped.
        self.assertEqual(body["gaps"][0]["finding"], "Not registered")
        self.assertEqual(body["gaps"][0]["interventions"][0]["interventionId"], "cipc")
        self.assertEqual([item["interventionId"] for item in body["gaps"][1]["interventions"]], ["mkt"])
        self.assertTrue(any("not in the catalogue" in warning for warning in body["warnings"]))
        self.assertEqual(calls[0]["alreadyPlanned"], ["books"])

    def test_rejects_response_without_answers(self):
        client, _ = make_client({})
        payload = {"sections": [{"title": "A", "questions": [{"question": "Q", "answer": ""}]}]}
        self.assertEqual(client.post("/api/gap-analysis/analyse", json=payload).status_code, 422)

    def test_requires_auth(self):
        client, _ = make_client({}, authorised=False)
        self.assertEqual(client.post("/api/gap-analysis/analyse", json=REQUEST).status_code, 401)

    def test_unreadable_model_reply(self):
        client, _ = make_client("not json at all")
        self.assertEqual(client.post("/api/gap-analysis/analyse", json=REQUEST).status_code, 502)


if __name__ == "__main__":
    unittest.main()
