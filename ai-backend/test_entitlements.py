import unittest
from types import SimpleNamespace

import entitlements
from entitlements import company_has_feature, identity_has_feature, normalize_tier_features, resolve_features


class Snap:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class FakeDb:
    """`companies/{code}` from `companies`; `systemSettings/plans` from `plans` (None = never saved)."""

    def __init__(self, companies, plans=None):
        self.companies = companies
        self.plans = plans

    def collection(self, name):
        assert name in ("companies", "systemSettings")
        self.name = name
        return self

    def document(self, code):
        self.code = code
        return self

    def get(self):
        if self.name == "systemSettings":
            return Snap(self.plans if self.code == "plans" else None)
        return Snap(self.companies.get(self.code))


class ExplodingDb:
    def collection(self, name):
        raise RuntimeError("firestore down")


class EntitlementTests(unittest.TestCase):
    def setUp(self):
        # Each test brings its own plan contents.
        entitlements._tier_cache.clear()
    def test_no_subscription_keeps_everything(self):
        self.assertEqual(resolve_features(None), {"whatsappComms": True, "agenticSupport": True})
        self.assertEqual(resolve_features({}), {"whatsappComms": True, "agenticSupport": True})
        self.assertEqual(resolve_features({"tier": "nonsense"}), {"whatsappComms": True, "agenticSupport": True})

    def test_tiers(self):
        self.assertEqual(resolve_features({"tier": "basic"}), {"whatsappComms": False, "agenticSupport": False})
        self.assertEqual(resolve_features({"tier": "standard"}), {"whatsappComms": True, "agenticSupport": False})
        self.assertEqual(resolve_features({"tier": "premium"}), {"whatsappComms": True, "agenticSupport": True})

    def test_add_ons_extend_a_tier_and_ignore_unknown_keys(self):
        self.assertEqual(
            resolve_features({"tier": "basic", "addOns": ["agenticSupport", "bogus"]}),
            {"whatsappComms": False, "agenticSupport": True},
        )

    def test_company_lookup(self):
        db = FakeDb({"BASIC1": {"subscription": {"tier": "basic"}}, "OLD1": {"name": "Legacy"}})
        self.assertFalse(company_has_feature(db, "BASIC1", "agenticSupport"))
        self.assertTrue(company_has_feature(db, "OLD1", "agenticSupport"))
        self.assertTrue(company_has_feature(db, "MISSING", "agenticSupport"))
        self.assertTrue(company_has_feature(db, "", "agenticSupport"))
        self.assertTrue(company_has_feature(db, None, "agenticSupport"))

    def test_read_failure_fails_open(self):
        self.assertTrue(company_has_feature(ExplodingDb(), "ANY", "agenticSupport"))

    def test_service_identity_is_never_restricted(self):
        db = FakeDb({"BASIC1": {"subscription": {"tier": "basic"}}})
        service = SimpleNamespace(is_service=True, company_code="BASIC1")
        person = SimpleNamespace(is_service=False, company_code="BASIC1")
        self.assertTrue(identity_has_feature(db, service, "agenticSupport"))
        self.assertFalse(identity_has_feature(db, person, "agenticSupport"))


    def test_edited_plan_contents_apply(self):
        plans = {"tiers": {"basic": {"features": ["whatsappComms"]}, "premium": {"features": ["agenticSupport", "bogus"]}}}
        db = FakeDb({"B": {"subscription": {"tier": "basic"}}, "S": {"subscription": {"tier": "standard"}}, "P": {"subscription": {"tier": "premium"}}}, plans)
        self.assertTrue(company_has_feature(db, "B", "whatsappComms"))
        # A tier the document doesn't list keeps its default.
        self.assertTrue(company_has_feature(db, "S", "whatsappComms"))
        self.assertFalse(company_has_feature(db, "P", "whatsappComms"))
        self.assertEqual(normalize_tier_features(plans)["premium"], {"agenticSupport"})
        self.assertEqual(normalize_tier_features(None)["standard"], {"whatsappComms"})


if __name__ == "__main__":
    unittest.main()
