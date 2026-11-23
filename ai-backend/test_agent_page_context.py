"""The page assistant only ever sees the signed-in person's own company (never another company's people)."""
import sys
import unittest
from types import SimpleNamespace
from unittest import mock


class Doc:
    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data

    def to_dict(self):
        return dict(self._data)


class Query:
    def __init__(self, rows):
        self.rows = rows

    def where(self, field, op, value):
        assert op == "=="
        return Query([row for row in self.rows if row[1].get(field) == value])

    def limit(self, count):
        return Query(self.rows[:count])

    def stream(self):
        return [Doc(doc_id, data) for doc_id, data in self.rows]


class FakeDb:
    def __init__(self, data):
        self.data = data

    def collection(self, name):
        return Query(list(self.data.get(name, {}).items()))


def load_app():
    """app.py starts Firebase on import; stub it so the module loads without credentials."""
    sys.modules.pop("app", None)
    with mock.patch.dict("os.environ", {"FIREBASE_SERVICE_ACCOUNT_JSON": '{"project_id": "test"}'}), \
            mock.patch("firebase_admin._apps", {}), mock.patch("firebase_admin.initialize_app"), \
            mock.patch("firebase_admin.firestore.client", return_value=FakeDb({})), \
            mock.patch("firebase_admin.credentials.Certificate"):
        import app
    return app


class PageContextScope(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.app = load_app()

    def setUp(self):
        self.db = FakeDb({
            "participants": {
                "q1": {"companyCode": "QTX", "beneficiaryName": "Kabelo Ndlovu"},
                "t1": {"companyCode": "TNS", "beneficiaryName": "Own Learner"},
            },
            "programs": {"qp": {"companyCode": "QTX", "name": "Test Engagement"}},
        })
        patcher = mock.patch.object(self.app, "db", self.db)
        patcher.start()
        self.addCleanup(patcher.stop)

    def page(self, key):
        return SimpleNamespace(pageKey=key)

    def test_only_the_viewers_company(self):
        context = self.app._firestore_context_for_page(self.page("dashboard"), "TNS")
        text = repr(context)
        self.assertIn("Own Learner", text)
        self.assertNotIn("Kabelo", text)
        self.assertNotIn("Test Engagement", text)

    def test_no_company_sees_no_records(self):
        self.assertEqual(self.app._firestore_context_for_page(self.page("dashboard"), None), {})

    def test_training_pages_add_nothing(self):
        self.assertEqual(self.app._firestore_context_for_page(self.page("training-agentic-home"), "TNS"), {})


if __name__ == "__main__":
    unittest.main()
