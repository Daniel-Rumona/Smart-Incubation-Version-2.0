import unittest
from types import SimpleNamespace

from client_modules import is_training_page, persona_for

DEFAULT = "DEFAULT PERSONA"


class Snap:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class FakeDb:
    """`companies/{code}` from `companies`."""

    def __init__(self, companies):
        self.companies = companies

    def collection(self, name):
        assert name == "companies"
        return self

    def document(self, code):
        self.code = code
        return self

    def get(self):
        return Snap(self.companies.get(self.code))


DB = FakeDb({
    "TNS": {"name": "Tau Namagadi Sustainable Solutions", "awarenessTrainingEnabled": True, "clientHomeModule": "awarenessTraining"},
    "MIXED": {"name": "Incubator With Training", "awarenessTrainingEnabled": True},
    "QTX": {"name": "Quantilytix"},
    "OFF": {"name": "Switched Off", "awarenessTrainingEnabled": False, "clientHomeModule": "awarenessTraining"},
})


def who(role, company):
    return SimpleNamespace(role=role, company_code=company)


class PersonaTests(unittest.TestCase):
    def test_training_company_staff_get_the_training_assistant_everywhere(self):
        persona, client = persona_for(DB, who("projectadmin", "TNS"), "workspace", DEFAULT)
        self.assertTrue(client)
        self.assertIn("Tau Namagadi Sustainable Solutions", persona)
        self.assertIn("the company's staff", persona)

    def test_learners_get_the_learner_framing_and_the_answer_rule(self):
        persona, client = persona_for(DB, who("learner", "TNS"), "learner-test", DEFAULT)
        self.assertTrue(client)
        self.assertIn("talking to a learner", persona)
        self.assertIn("Never give, hint at or check answers", persona)

    def test_other_companies_keep_the_standard_assistant(self):
        self.assertEqual(persona_for(DB, who("projectadmin", "QTX"), "training-class", DEFAULT), (DEFAULT, False))
        self.assertEqual(persona_for(DB, who("operations", None), "workspace", DEFAULT), (DEFAULT, False))

    def test_a_switched_off_module_has_no_effect(self):
        self.assertEqual(persona_for(DB, who("projectadmin", "OFF"), "training-class", DEFAULT), (DEFAULT, False))

    def test_a_company_with_training_as_a_side_module_keeps_the_standard_assistant_outside_training(self):
        self.assertEqual(persona_for(DB, who("operations", "MIXED"), "operations-dashboard", DEFAULT), (DEFAULT, False))
        persona, client = persona_for(DB, who("operations", "MIXED"), "training-classes", DEFAULT)
        self.assertTrue(client)
        self.assertIn("Incubator With Training", persona)

    def test_training_pages_are_recognised(self):
        self.assertTrue(is_training_page("training-class"))
        self.assertTrue(is_training_page("learner-agentic-home"))
        self.assertFalse(is_training_page("agentic-home"))
        self.assertFalse(is_training_page(None))


if __name__ == "__main__":
    unittest.main()
