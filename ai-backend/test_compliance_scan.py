import unittest
from types import SimpleNamespace
from unittest.mock import Mock
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient
from compliance_scan import create_compliance_scan_router

class ScanTests(unittest.TestCase):
    def client(self, role="operations", assigned=None, authenticated=True):
        db = Mock()
        db.collection.return_value.document.return_value.get.return_value = SimpleNamespace(exists=True, to_dict=lambda: {"assignedProgramIds": assigned or []})
        def auth(_):
            if not authenticated:
                raise HTTPException(401, "Sign in")
            return SimpleNamespace(uid="u", role=role, company_code="A", is_service=False)
        participants = lambda *_: [
            {"id": "ok", "companyCode": "A", "programId": "p"},
            {"id": "empty", "companyCode": "A", "programId": "p"},
            {"id": "other", "companyCode": "B", "programId": "p"},
            {"id": "unassigned", "companyCode": "A", "programId": "q"},
        ]
        documents = lambda pid, _: [] if pid == "empty" else [{"url": "https://example.com/doc"}]
        scan = lambda p: {"participantId": p["id"], "documents": [{}], "summary": {"totalMissing": 0, "totalPending": 1, "totalProblem": 0, "score": 0}}
        persist = Mock()
        app = FastAPI()
        app.include_router(create_compliance_scan_router(db, auth, participants, documents, scan, persist))
        return TestClient(app), persist

    def test_scope_and_missing_files(self):
        client, persist = self.client(assigned=["p"])
        response = client.post("/api/compliance/scan", json={})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["totals"]["participants"], 1)
        self.assertEqual(response.json()["results"][0]["participantId"], "ok")
        self.assertEqual(persist.call_args.args[0]["participantId"], "ok")

    def test_preview_does_not_write(self):
        client, persist = self.client()
        self.assertEqual(client.post("/api/compliance/scan", json={"updateDatabase": False}).status_code, 200)
        persist.assert_not_called()

    def test_permission(self):
        client, persist = self.client(role="incubatee")
        self.assertEqual(client.post("/api/compliance/scan", json={}).status_code, 403)
        persist.assert_not_called()

    def test_authentication(self):
        client, persist = self.client(authenticated=False)
        self.assertEqual(client.post("/api/compliance/scan", json={}).status_code, 401)
        persist.assert_not_called()

if __name__ == "__main__":
    unittest.main()
