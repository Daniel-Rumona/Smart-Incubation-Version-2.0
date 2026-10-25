import json
import unittest

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import intervention_outcome_agent as ioa


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
    app.include_router(ioa.create_intervention_outcome_router(call_model, require_auth))
    return TestClient(app), calls


INTERVENTIONS = [
    {"id": "cash", "title": "Cash flow coaching", "areaOfSupport": "Finance"},
    {"id": "bot", "title": "Marketing plan", "areaOfSupport": "Marketing", "deliveryStrategy": "agent_only"},
]


class OutcomeMigrationTests(unittest.TestCase):
    def test_normalises_and_orders_suggestions(self):
        client, calls = make_client({"suggestions": [
            {"id": "bot", "deliverableName": "Marketing Plan", "intendedOutcome": "The SME runs campaigns.", "outcomeType": "process_implemented", "deliverableRequired": True, "followUpDays": 5},
            {"id": "cash", "deliverableName": "Cash Flow Forecast", "intendedOutcome": "The SME keeps a forecast.", "outcomeType": "made_up", "deliverableRequired": True, "followUpDays": "75"},
            {"id": "unknown", "deliverableName": "Nope", "intendedOutcome": "Ignored."},
        ]})
        response = client.post("/api/interventions/outcome-migration", json={"interventions": INTERVENTIONS})
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertEqual([item["id"] for item in body["suggestions"]], ["cash", "bot"])
        cash, bot = body["suggestions"]
        self.assertIsNone(cash["outcomeType"])
        self.assertEqual(cash["followUpDays"], 75)
        self.assertTrue(cash["deliverableRequired"])
        # Agent delivery has no upload step, and follow-ups are clamped to the minimum window.
        self.assertFalse(bot["deliverableRequired"])
        self.assertEqual(bot["followUpDays"], ioa.MIN_FOLLOW_UP_DAYS)
        self.assertEqual(len(calls[0]["interventions"]), 2)

    def test_warns_about_missing_suggestions(self):
        client, _ = make_client({"suggestions": [{"id": "cash", "deliverableName": "Forecast", "intendedOutcome": "x"}]})
        body = client.post("/api/interventions/outcome-migration", json={"interventions": INTERVENTIONS}).json()
        self.assertEqual(len(body["suggestions"]), 1)
        self.assertIn("Marketing plan", body["warnings"][0])

    def test_rejects_large_batches_and_unauthorised(self):
        client, _ = make_client({"suggestions": []})
        many = [{"id": f"i{index}", "title": "x"} for index in range(ioa.MAX_INTERVENTIONS + 1)]
        self.assertEqual(client.post("/api/interventions/outcome-migration", json={"interventions": many}).status_code, 400)
        locked, _ = make_client({"suggestions": []}, authorised=False)
        self.assertEqual(locked.post("/api/interventions/outcome-migration", json={"interventions": INTERVENTIONS}).status_code, 401)

    def test_empty_reply_is_an_error(self):
        client, _ = make_client("not json at all")
        self.assertEqual(client.post("/api/interventions/outcome-migration", json={"interventions": INTERVENTIONS}).status_code, 502)


if __name__ == "__main__":
    unittest.main()
