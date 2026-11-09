import json
import unittest
from types import SimpleNamespace

from fastapi import FastAPI
from fastapi.testclient import TestClient

import esg_report_agent as esg
from client_modules import persona_for


class Snap:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class FakeDb:
    def __init__(self, collections):
        self.collections = collections

    def collection(self, name):
        rows = self.collections.get(name, {})
        return SimpleNamespace(document=lambda key: SimpleNamespace(get=lambda: Snap(rows.get(key))))


def _extract_json_object(text):
    """As app._extract_json_object for these replies (importing app would start Firebase)."""
    try:
        return json.loads(text)
    except ValueError:
        return None


REPORT = {
    "companyCode": "TNS",
    "clientName": "Kgalagadi Mining (Pty) Ltd",
    "sector": "mining",
    "country": "ZA",
    "periodStart": "2025-03-01",
    "periodEnd": "2026-02-28",
    "publicationDate": "2026-06-30",
    "claim": "with_reference",
    "indicators": [
        {"pillar": "E", "indicator": "Electricity consumption", "unit": "kWh", "baseline": "1 250 000", "current": "1 100 000", "target": "1 000 000", "disclosure": "302-1"},
        {"pillar": "S", "indicator": "Safety training completion", "unit": "%", "baseline": "62", "current": "88", "target": "100", "disclosure": "403-5"},
    ],
    "risks": [{"pillar": "E", "risk": "Unplanned energy interruption", "likelihood": 4, "impact": 4, "mitigation": "Backup and efficiency plan"}],
    "stakeholders": [{"stakeholder": "Employees", "concern": "Safety and fair treatment", "influence": 4, "impact": 5}],
    "actions": [{"pillar": "E", "action": "Collect monthly utility data", "budget": "15 000"}],
}


def make_client(reply, role="projectadmin", company_code="TNS", esg_on=True, report=REPORT):
    calls = []

    def call_gemini(system_prompt, payload, **kwargs):
        calls.append(payload)
        return reply

    db = FakeDb({
        "companies": {"TNS": {"companyName": "Tau Namagadi Sustainable Solutions", "esgReportingEnabled": esg_on}, "DEMO": {"esgReportingEnabled": False}},
        "esgReports": {"r1": report},
    })
    identity = SimpleNamespace(uid="u1", role=role, company_code=company_code)
    app = FastAPI()
    app.include_router(esg.create_esg_report_router(db, call_gemini, lambda _authorization: identity, _extract_json_object))
    return TestClient(app), calls


class FigureCheckTests(unittest.TestCase):
    def test_years_disclosures_standard_names_and_small_counts_are_not_figures(self):
        text = "In 2025 the company reported under GRI 14 and disclosure 302-1 for Scope 3, with 4 sites."
        self.assertEqual(esg.figures_in(text), [])

    def test_days_in_dates_are_not_figures(self):
        text = "The period ran from 1 March 2025 to 28 February 2026; the forum met on March 15."
        self.assertEqual(esg.figures_in(text), [])

    def test_grouped_and_decimal_figures_are_read(self):
        values = [value for _, value in esg.figures_in("Use fell to 1 100 000 kWh (12.5%) from 1,250,000 kWh.")]
        self.assertEqual(values, [1100000.0, 12.5, 1250000.0])

    def test_data_figures_include_the_change_from_baseline(self):
        allowed = esg.data_figures(REPORT)
        self.assertIn(1100000.0, allowed)
        self.assertIn(12.0, allowed)  # electricity down 12% on the baseline
        self.assertIn(42.0, allowed)  # safety training up 42%
        self.assertIn(16.0, allowed)  # risk score 4 x 4

    def test_invented_figures_are_flagged(self):
        allowed = esg.data_figures(REPORT)
        text = "Electricity fell 12% to 1 100 000 kWh; the company plans 45 000 trees and spent R 250 000 on solar."
        self.assertEqual(esg.unmatched_figures(text, allowed), ["45 000", "250 000"])


FOOTPRINT_REPORT = {
    **REPORT,
    "footprint": {
        "carbonTaxPayer": "no",
        "allowancePct": 60,
        "sources": [
            {"scope": 1, "label": "Company vehicles: diesel", "unit": "litres", "factor": 2.66155, "factorSource": "DESNZ 2025", "monthly": [1000] * 12},
            {"scope": 2, "label": "Electricity from the grid", "unit": "kWh", "factor": 0.96, "factorSource": "DFFE 2024", "monthly": [10000] * 6 + [None] * 6},
            {"scope": 3, "label": "Packaging", "unit": "kg", "factor": None, "factorSource": "", "monthly": [50] * 12},
        ],
    },
}


class FootprintTests(unittest.TestCase):
    def test_totals_by_scope_and_source_match_the_page(self):
        summary = esg.footprint_summary(FOOTPRINT_REPORT)
        # 12 000 litres x 2.66155 kg = 31.94 t; 60 000 kWh x 0.96 kg = 57.6 t; packaging has no factor.
        self.assertEqual(summary["tCO2e"], {"total": 89.54, "scope1": 31.94, "scope2": 57.6, "scope3": 0.0})
        self.assertIsNone(summary["sources"][2]["tCO2e"])
        self.assertIn("does not pay carbon tax directly", summary["carbonTaxPosition"])

    def test_no_footprint_is_none(self):
        self.assertIsNone(esg.footprint_summary(REPORT))

    def test_footprint_figures_may_be_quoted_but_tax_amounts_are_not_given(self):
        allowed = esg.data_figures(FOOTPRINT_REPORT)
        text = "Emissions were 89.54 tCO2e: Scope 1 31.94 t (36%) and Scope 2 57.6 t (64%), from 60 000 kWh and 12 000 litres."
        self.assertEqual(esg.unmatched_figures(text, allowed), [])
        self.assertEqual(esg.unmatched_figures("The carbon tax would be R 9 800.", allowed), ["9 800"])

    def test_the_draft_is_given_the_footprint_and_the_new_sections(self):
        client, calls = make_client(json.dumps({"sections": {"climate": "Emissions were 89.54 tCO2e.", "leadership": "We measured our footprint."}}), report=FOOTPRINT_REPORT)
        response = client.post("/api/esg/draft", json={"reportId": "r1", "sections": ["climate", "leadership"]})
        self.assertEqual(response.status_code, 200)
        self.assertEqual([section["key"] for section in response.json()["sections"]], ["climate", "leadership"])
        self.assertEqual(response.json()["sections"][0]["unmatchedFigures"], [])
        self.assertEqual(calls[0]["carbonFootprint"]["tCO2e"], {"total": "89.54", "scope1": "31.94", "scope2": "57.6", "scope3": "0"})
        self.assertEqual(calls[0]["carbonFootprint"]["sources"][1]["usage"], "60 000")
        self.assertEqual(calls[0]["carbonFootprint"]["sources"][2]["tCO2e"], "no factor entered")


class DraftEndpointTests(unittest.TestCase):
    def test_drafts_requested_sections_and_flags_unmatched_figures(self):
        reply = json.dumps({"sections": {
            "environment": "Electricity consumption fell by 12% to 1 100 000 kWh (GRI 302-1), against a target of 1 000 000 kWh.",
            "social": "Safety training completion rose to 88% (GRI 403-5); 350 employees were trained.",
        }})
        client, calls = make_client(reply)
        response = client.post("/api/esg/draft", json={"reportId": "r1", "sections": ["environment", "social"], "standards": ["GRI 14: Mining Sector 2024"]})
        self.assertEqual(response.status_code, 200)
        sections = {item["key"]: item for item in response.json()["sections"]}
        self.assertEqual(sections["environment"]["unmatchedFigures"], [])
        self.assertEqual(sections["social"]["unmatchedFigures"], ["350"])
        self.assertEqual(sections["environment"]["title"], "Environmental performance")
        sent = calls[0]
        self.assertEqual([item["key"] for item in sent["sectionsToWrite"]], ["environment", "social"])
        self.assertEqual(sent["preparedBy"], "Tau Namagadi Sustainable Solutions")
        self.assertEqual(sent["standards"], ["GRI 14: Mining Sector 2024"])
        self.assertEqual(sent["statementOfUse"], "with reference to the GRI Standards")

    def test_unknown_sections_fall_back_to_all(self):
        client, calls = make_client(json.dumps({"sections": {"about": "About."}}))
        client.post("/api/esg/draft", json={"reportId": "r1", "sections": ["nonsense"]})
        self.assertEqual(len(calls[0]["sectionsToWrite"]), len(esg.SECTIONS))

    def test_learners_and_funders_cannot_draft(self):
        for role in ("learner", "funder", "incubatee"):
            client, calls = make_client("{}", role=role)
            self.assertEqual(client.post("/api/esg/draft", json={"reportId": "r1"}).status_code, 403)
            self.assertEqual(calls, [])

    def test_another_company_cannot_draft_the_report(self):
        db_report = dict(REPORT, companyCode="TNS")
        client, calls = make_client("{}", company_code="DEMO", report=db_report)
        self.assertEqual(client.post("/api/esg/draft", json={"reportId": "r1"}).status_code, 403)  # module off for DEMO
        self.assertEqual(calls, [])

    def test_module_off_is_refused(self):
        client, calls = make_client("{}", esg_on=False)
        self.assertEqual(client.post("/api/esg/draft", json={"reportId": "r1"}).status_code, 403)
        self.assertEqual(calls, [])

    def test_report_of_another_company_is_not_found(self):
        client, calls = make_client("{}", report=dict(REPORT, companyCode="UGH"))
        self.assertEqual(client.post("/api/esg/draft", json={"reportId": "r1"}).status_code, 404)
        self.assertEqual(calls, [])

    def test_empty_reply_is_an_error(self):
        client, _ = make_client(json.dumps({"sections": {}}))
        self.assertEqual(client.post("/api/esg/draft", json={"reportId": "r1", "sections": ["about"]}).status_code, 502)


class PersonaTests(unittest.TestCase):
    def test_funder_of_a_training_company_gets_the_client_persona(self):
        db = FakeDb({"companies": {"TNS": {"companyName": "Tau Namagadi", "awarenessTrainingEnabled": True}}})
        persona, client_persona = persona_for(db, SimpleNamespace(role="funder", company_code="TNS"), "training-funder", "DEFAULT")
        self.assertTrue(client_persona)
        self.assertIn("company's funder", persona)

    def test_esg_page_of_an_esg_only_company_gets_the_client_persona(self):
        db = FakeDb({"companies": {"ESG1": {"companyName": "Green Advisory", "esgReportingEnabled": True}}})
        persona, client_persona = persona_for(db, SimpleNamespace(role="projectadmin", company_code="ESG1"), "esg-report", "DEFAULT")
        self.assertTrue(client_persona)
        self.assertIn("GRI 14", persona)

    def test_ordinary_company_keeps_the_default_persona(self):
        db = FakeDb({"companies": {"DEMO": {"companyName": "Demo Incubator"}}})
        persona, client_persona = persona_for(db, SimpleNamespace(role="funder", company_code="DEMO"), "funder-dashboard", "DEFAULT")
        self.assertEqual((persona, client_persona), ("DEFAULT", False))


if __name__ == "__main__":
    unittest.main()
