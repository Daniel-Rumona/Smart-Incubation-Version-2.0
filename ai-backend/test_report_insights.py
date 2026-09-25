import json
import unittest

from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

import report_insights as ri


def request(**overrides):
    base = {
        "reportTitle": "Operations Report",
        "periodLabel": "01 Jan 2026 to 31 Mar 2026",
        "role": "operations",
        "template": "executive",
        "kpis": [
            {"label": "Completed", "value": 40, "note": "62% completion", "tone": "good"},
            {"label": "Overdue", "value": 9, "tone": "risk"},
            {"label": "Compliance alerts", "value": 4, "tone": "watch"},
        ],
        "sections": [{"key": "demand", "title": "Demand", "rows": [{"intervention": "Bookkeeping", "gap": 3}]}],
    }
    base.update(overrides)
    return base


def make_client(gemini, authorised=True):
    def require_auth(_authorization):
        if not authorised:
            raise HTTPException(status_code=401, detail="Sign in required")

    app = FastAPI()
    app.include_router(ri.create_report_insights_router(
        require_auth, gemini, lambda text: json.loads(text), "test-model",
    ))
    return TestClient(app)


class PromptTests(unittest.TestCase):
    def test_prompt_is_framed_for_the_role(self):
        for role, expected in {
            "operations": "overdue and held-up",
            "projectadmin": "programme intake",
            "director": "portfolio health",
            "consultant": "assignment workload",
        }.items():
            prompt = ri.build_system_prompt(ri.ReportInsightRequest(**request(role=role)))
            self.assertIn(expected, prompt, role)

    def test_detailed_template_asks_for_section_notes(self):
        detailed = ri.build_system_prompt(ri.ReportInsightRequest(**request(template="detailed")))
        executive = ri.build_system_prompt(ri.ReportInsightRequest(**request(template="executive")))
        self.assertIn("sectionNotes entry of up to 50 words", detailed)
        self.assertIn("up to 120 words", executive)

    def test_model_payload_caps_rows_and_trims_cells(self):
        rows = [{"name": "x" * 500, "n": i} for i in range(80)]
        payload = ri.ReportInsightRequest(**request(sections=[{"key": "big", "title": "Big", "rows": rows}]))
        section = ri.build_model_payload(payload)["sections"][0]
        self.assertEqual(section["totalRows"], 80)
        self.assertEqual(len(section["rows"]), ri.MAX_ROWS_PER_SECTION)
        self.assertLessEqual(len(section["rows"][0]["name"]), ri.MAX_CELL_CHARS)


class NormaliseTests(unittest.TestCase):
    def test_coerces_and_filters_model_output(self):
        payload = ri.ReportInsightRequest(**request())
        result = ri.normalise_insights({
            "executiveSummary": "  Summary  ",
            "operationalHighlights": ["a", "", "b"],
            "risks": "not a list",
            "actionPlan": [{"action": "Fix", "priority": "urgent"}, {"owner": "no action"}, "junk"],
            "sectionNotes": {"demand": "Note", "unknown": "dropped"},
        }, payload)
        self.assertEqual(result["executiveSummary"], "Summary")
        self.assertEqual(result["highlights"], ["a", "b"])
        self.assertEqual(result["risks"], [])
        self.assertEqual(len(result["actionPlan"]), 1)
        self.assertEqual(result["actionPlan"][0]["priority"], "Medium")
        self.assertEqual(result["sectionNotes"], {"demand": "Note"})


class FallbackTests(unittest.TestCase):
    def test_built_from_the_figures(self):
        result = ri.fallback_insights(ri.ReportInsightRequest(**request()))
        self.assertIn("Overdue: 9", result["executiveSummary"])
        self.assertIn("operations leads", result["executiveSummary"])
        self.assertTrue(any("Overdue" in risk for risk in result["risks"]))
        self.assertEqual(result["actionPlan"][0]["priority"], "High")
        self.assertIn("demand", result["sectionNotes"])

    def test_handles_an_empty_report(self):
        result = ri.fallback_insights(ri.ReportInsightRequest(**request(kpis=[], sections=[])))
        self.assertIn("No headline figures", result["executiveSummary"])
        self.assertEqual(result["actionPlan"][0]["priority"], "Low")


class RouteTests(unittest.TestCase):
    def test_returns_the_model_narrative(self):
        calls = {}

        def gemini(system_prompt, payload, max_output_tokens, response_mime_type):
            calls.update(prompt=system_prompt, payload=payload, tokens=max_output_tokens)
            return json.dumps({"executiveSummary": "AI summary", "highlights": ["h"], "risks": ["r"], "actionPlan": []})

        response = make_client(gemini).post("/api/reports/insights", json=request(template="detailed"))
        body = response.json()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(body["model"], "test-model")
        self.assertEqual(body["insights"]["executiveSummary"], "AI summary")
        self.assertGreater(calls["tokens"], 1600)
        self.assertEqual(calls["payload"]["kpis"][0]["label"], "Completed")

    def test_falls_back_when_the_model_fails(self):
        def gemini(*_args, **_kwargs):
            raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not configured")

        body = make_client(gemini).post("/api/reports/insights", json=request()).json()
        self.assertEqual(body["model"], "fallback")
        self.assertTrue(body["insights"]["executiveSummary"])

    def test_falls_back_when_the_model_returns_no_summary(self):
        body = make_client(lambda *_a, **_k: "{}").post("/api/reports/insights", json=request()).json()
        self.assertEqual(body["model"], "fallback")

    def test_requires_sign_in(self):
        response = make_client(lambda *_a, **_k: "{}", authorised=False).post("/api/reports/insights", json=request())
        self.assertEqual(response.status_code, 401)


if __name__ == "__main__":
    unittest.main()
