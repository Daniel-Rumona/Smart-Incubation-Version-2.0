import unittest
from types import SimpleNamespace

from client_modules import library_context


class Snap:
    def __init__(self, doc_id, data):
        self.id = doc_id
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class Query:
    def __init__(self, rows):
        self.rows = rows

    def where(self, field, op, value):
        assert op == "=="
        return Query([(doc_id, data) for doc_id, data in self.rows if data.get(field) == value])

    def stream(self):
        return [Snap(doc_id, data) for doc_id, data in self.rows]


class Collection(Query):
    def document(self, doc_id):
        rows = dict(self.rows)
        return SimpleNamespace(get=lambda: Snap(doc_id, rows.get(doc_id)))


class FakeDb:
    def __init__(self, collections):
        self.collections = collections

    def collection(self, name):
        return Collection(list(self.collections.get(name, {}).items()))


DB = FakeDb({
    "trainingLibrary": {
        "slides": {"companyCode": "TNS", "title": "ESG Awareness slides", "courseTitle": "ESG Awareness Training", "audience": "shared", "category": "course_material", "textChars": 120},
        "memo": {"companyCode": "TNS", "title": "Assessment memo", "audience": "staff", "category": "reference", "textChars": 80},
        "other": {"companyCode": "DEMO", "title": "Another company's notes", "audience": "shared", "textChars": 50},
    },
    "trainingLibraryTexts": {
        "slides": {"companyCode": "TNS", "text": "Scope 1 emissions are direct emissions from sources a company owns.\n\nScope 2 covers purchased electricity."},
        "memo": {"companyCode": "TNS", "text": "Question 3 answer: scope 1 emissions are direct emissions."},
        "other": {"companyCode": "DEMO", "text": "Scope 1 emissions secret notes."},
    },
})


def who(role, company="TNS"):
    return SimpleNamespace(role=role, company_code=company)


class LibraryContextTests(unittest.TestCase):
    def test_staff_see_the_whole_library_with_matching_passages(self):
        library = library_context(DB, who("projectadmin"), "What are scope 1 emissions?")
        titles = {item["title"] for item in library["items"]}
        self.assertEqual(titles, {"ESG Awareness slides", "Assessment memo"})
        self.assertTrue(any("direct emissions" in excerpt["text"] for excerpt in library["excerpts"]))

    def test_learners_only_get_shared_items_never_the_staff_memo(self):
        library = library_context(DB, who("learner"), "What are scope 1 emissions?")
        self.assertEqual([item["title"] for item in library["items"]], ["ESG Awareness slides"])
        self.assertTrue(all(excerpt["document"] == "ESG Awareness slides" for excerpt in library["excerpts"]))
        self.assertNotIn("Question 3", " ".join(excerpt["text"] for excerpt in library["excerpts"]))

    def test_client_companies_only_get_shared_items(self):
        library = library_context(DB, who("clientorg"), "scope 2 electricity")
        self.assertEqual([item["title"] for item in library["items"]], ["ESG Awareness slides"])

    def test_another_companys_library_never_reaches_the_answer(self):
        library = library_context(DB, who("projectadmin"), "scope 1 emissions secret")
        self.assertNotIn("Another company's notes", [item["title"] for item in library["items"]])
        self.assertNotIn("secret", " ".join(excerpt["text"] for excerpt in library["excerpts"]))

    def test_funders_and_other_roles_get_nothing(self):
        self.assertIsNone(library_context(DB, who("funder"), "scope 1"))
        self.assertIsNone(library_context(DB, who("director"), "scope 1"))
        self.assertIsNone(library_context(DB, who("learner", ""), "scope 1"))

    def test_a_question_without_matching_words_gets_the_catalogue_only(self):
        library = library_context(DB, who("learner"), "hello")
        self.assertEqual(library["excerpts"], [])
        self.assertEqual(len(library["items"]), 1)


if __name__ == "__main__":
    unittest.main()
