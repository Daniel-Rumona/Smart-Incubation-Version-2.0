import unittest
from types import SimpleNamespace

from agent_scope import scoped_documents, scoped_snapshot
from test_agent_actions import FakeDB, Query


class LimitQuery(Query):
    """The test FakeDB plus Firestore's limit()."""

    def __init__(self, db, name, filters=(), cap=None):
        super().__init__(db, name, filters)
        self.cap = cap

    def where(self, field, op, value):
        return LimitQuery(self.db, self.name, self.filters + ((field, op, value),), self.cap)

    def limit(self, count):
        return LimitQuery(self.db, self.name, self.filters, count)

    def stream(self):
        rows = list(super().stream())
        return rows[: self.cap] if self.cap is not None else rows


class LimitColl(LimitQuery):
    def document(self, id):
        rows = self.db.data.setdefault(self.name, {})
        return SimpleNamespace(get=lambda: SimpleNamespace(id=id, exists=id in rows, to_dict=lambda: dict(rows.get(id) or {})))


class DB(FakeDB):
    def collection(self, name):
        return LimitColl(self, name)


def make_db():
    return DB({
        "programs": {
            "p1": {"companyCode": "ACME", "name": "Acme Growth"},
            "p2": {"companyCode": "OTHER", "name": "Other Private"},
            "p3": {"companyCode": "OTHER", "name": "Other Open", "openToExternalSmes": True},
        },
        "participants": {
            "sme1": {"companyCode": "ACME", "email": "Sme@Acme.co", "businessName": "My Biz"},
            "pX": {"companyCode": "ACME", "email": "someone@else.co", "businessName": "Neighbour Biz"},
            "pY": {"companyCode": "OTHER", "uid": "zz", "businessName": "Other Co SME"},
        },
        "applications": {
            "a1": {"companyCode": "ACME", "participantId": "sme1", "programName": "Acme Growth"},
            "a2": {"companyCode": "ACME", "participantId": "pX"},
            "a3": {"companyCode": "OTHER", "participantId": "pY"},
        },
        "smeIntakeSubmissions": {
            "i1": {"companyCode": "ACME", "contactEmail": "sme@acme.co"},
            "i2": {"companyCode": "ACME", "contactEmail": "x@y.co"},
            "i3": {"companyCode": "OTHER", "contactEmail": "q@r.co"},
        },
        "users": {"sme1": {"companyCode": "ACME", "role": "incubatee"}, "ops1": {"companyCode": "ACME", "role": "operations"}, "o2": {"companyCode": "OTHER"}},
    })


def who(role, uid="sme1", company="ACME", email="Sme@Acme.co", service=False):
    return SimpleNamespace(uid=uid, role=role, company_code=company, email=email, is_service=service)


def ids(db, identity, collection, limit=20):
    return sorted(snap.id for snap in scoped_documents(db, identity, collection, limit))


class ScopeTests(unittest.TestCase):
    def setUp(self):
        self.db = make_db()

    def test_sme_sees_only_their_own_records(self):
        sme = who("incubatee")
        self.assertEqual(ids(self.db, sme, "participants"), ["sme1"])
        self.assertEqual(ids(self.db, sme, "applications"), ["a1"])
        self.assertEqual(ids(self.db, sme, "smeIntakeSubmissions"), ["i1"])  # stored lower case, signed in mixed case
        self.assertEqual(ids(self.db, sme, "users"), ["sme1"])

    def test_sme_programmes_are_their_company_and_open_ones(self):
        self.assertEqual(ids(self.db, who("incubatee"), "programs"), ["p1", "p3"])
        self.assertEqual(ids(self.db, who("applicant", uid="new", company="", email="new@x.co"), "programs"), ["p3"])

    def test_staff_see_their_own_company_only(self):
        ops = who("operations", uid="ops1", email="ops@acme.co")
        self.assertEqual(ids(self.db, ops, "programs"), ["p1"])
        self.assertEqual(ids(self.db, ops, "participants"), ["pX", "sme1"])
        self.assertEqual(ids(self.db, ops, "applications"), ["a1", "a2"])
        self.assertEqual(ids(self.db, ops, "users"), ["ops1", "sme1"])
        self.assertEqual(ids(self.db, who("consultant", uid="c1"), "smeIntakeSubmissions"), [])

    def test_staff_without_a_company_and_the_service_secret_see_nothing(self):
        self.assertEqual(ids(self.db, who("operations", company=""), "participants"), [])
        self.assertEqual(ids(self.db, who("operations", service=True), "programs"), [])
        self.assertEqual(ids(self.db, None, "programs"), [])

    def test_platform_admin_and_limit(self):
        self.assertEqual(len(ids(self.db, who("systemadmin"), "participants")), 3)
        self.assertEqual(len(ids(self.db, who("systemadmin"), "participants", limit=2)), 2)
        self.assertEqual(len(ids(self.db, who("incubatee"), "programs", limit=1)), 1)

    def test_snapshot_hides_error_text(self):
        class Broken(DB):
            def collection(self, name):
                raise RuntimeError("index projects/secret-project needed")

        out = scoped_snapshot(Broken(), who("operations"), ["programs"], 5, lambda snap: snap.to_dict())
        self.assertEqual(out, {"programs": {"error": "unavailable"}})
        good = scoped_snapshot(self.db, who("incubatee"), ["applications"], 5, lambda snap: {"id": snap.id})
        self.assertEqual(good, {"applications": [{"id": "a1"}]})


if __name__ == "__main__":
    unittest.main()
