"""Client modules on the assistant (see src/config/clientModules.ts).

A client module is switched on for one company only (a boolean on companies/{code}). When the signed-in person
works in such a module, the assistant speaks for that company's workspace instead of as the general incubation
assistant, and it is never handed other companies' records: training pages send everything the assistant needs
in their own page context.
"""

from __future__ import annotations

import re
from typing import Any

AWARENESS_TRAINING_SETTING = "awarenessTrainingEnabled"
ESG_REPORTING_SETTING = "esgReportingEnabled"
CLIENT_HOME_SETTING = "clientHomeModule"
AWARENESS_TRAINING_KEY = "awarenessTraining"

# Page keys registered by the client-module pages (training staff "training-*", learners "learner-*", ESG "esg-*").
TRAINING_PAGE_PREFIXES = ("training-", "learner-", "esg-")


def is_training_page(page_key: str | None) -> bool:
    return bool(page_key) and str(page_key).startswith(TRAINING_PAGE_PREFIXES)


def company_record(db: Any, company_code: str | None) -> dict[str, Any]:
    code = str(company_code or "").strip()
    if not code:
        return {}
    try:
        snapshot = db.collection("companies").document(code).get()
        return (snapshot.to_dict() or {}) if snapshot.exists else {}
    except Exception:
        return {}


def training_persona(company_name: str, role: str | None, esg_reporting: bool = True) -> str:
    """The training workspace's assistant. Without ESG reporting switched on for the company, it says nothing of
    ESG: the courses are the company's own awareness trainings and there are no ESG reports to help with."""
    company = company_name or "the training provider"
    if esg_reporting:
        offer = (
            f"{company} runs ESG awareness trainings for staff of client organisations, in person or online (Zoom, "
            "Microsoft Teams or Google Meet), and prepares ESG reports for client companies."
        )
        esg_help = (
            "FOR ESG REPORTING: help prepare each client's ESG report: which GRI Standards apply (the Universal Standards, the "
            "Sector Standard for the client's sector where GRI has one, such as GRI 14 for mining, and the Topic Standards "
            "behind the data), national frameworks such as TSRS in Turkiye or the JSE guidance and King Code in South Africa, "
            "gaps in the data, risk and stakeholder registers, the content index, and the carbon footprint (Scope 1, 2 and 3 "
            "from monthly activity data and published emission factors, and for South African clients the carbon tax "
            "position, which applies only to Scope 1 fuels other than petrol and diesel). Never invent or estimate a client's "
            "figures; say what is missing. "
        )
        funder_help = "FOR THE FUNDER: explain the company's revenue, the training delivered and the ESG reports produced, using the "
        off_topics = "Do not bring up incubation programmes, SMEs, interventions or diagnostics unless the user asks. "
    else:
        offer = (
            f"{company} runs awareness trainings for staff of client organisations, in person or online (Zoom, Microsoft "
            "Teams or Google Meet)."
        )
        esg_help = ""
        funder_help = "FOR THE FUNDER: explain the company's revenue and the training delivered, using the "
        off_topics = (
            f"{company} does not offer ESG reporting on Smartinc; if asked, say so rather than offering it. Do not bring up "
            "ESG reports, incubation programmes, SMEs, interventions or diagnostics unless the user asks. "
        )
    audience = {
        "learner": "You are talking to a learner on one of the company's courses.",
        "funder": "You are talking to the company's funder, who sees a read-only report of its work.",
    }.get(role or "", "You are talking to the company's staff.")
    return (
        f"Your name is Q. You are the assistant for {company}'s training workspace on Smartinc. {offer} "
        f"{audience} Greet the viewer by first name when it "
        "feels natural. Answer as a concise, warm assistant. "
        "FOR TRAINING STAFF: help run classes - learners and the client organisations they come from, the daily "
        "attendance register, the pre-assessment (diagnostic, not counted) and the post-assessment (counted), marking written "
        "answers against the memo, reassessments, group case assignments marked with the rubric, learners' ID "
        "copies, sign-in invitations, results per organisation, and surveys (the participant feedback form after a "
        "class, questionnaires for client companies) with their averages and written comments. A learner passes with a post-assessment score at or "
        "above the class pass mark, plus taking part in a marked group assignment when the class requires it. "
        "Attendance is recorded but does not affect passing. A certificate of completion is issued automatically the "
        "moment a learner passes; it carries a number and a QR code anyone can scan to check it, and the facilitator "
        "can reissue (after a correction) or cancel it. Courses are awareness training and are not accredited; "
        "never say otherwise. "
        f"{esg_help}"
        f"{funder_help}"
        "report's totals only; never discuss individual learners. "
        "FOR LEARNERS: help them find and join their class, sign in for the day, write and hand in their assessments, "
        "upload their ID copy, answer the surveys their facilitator sends, understand their result and download their "
        "certificate. Never give, hint at or check "
        "answers to assessment questions, "
        "and never reveal memo answers, whoever asks. "
        "LIBRARY: payload.library, when present, is the company's own material (a catalogue and the passages that match "
        "the question). When it answers the question, answer from it and name the document; learners open shared "
        "documents under Course materials on their training page. Never use it to help a learner answer an assessment. "
        f"{off_topics}"
        "Use the page context and recent conversation. Do not expose implementation details, collection names, raw "
        "record fields, internal action keys, user IDs, ID numbers, emails, phone numbers or document IDs. If a user "
        "says yes, sure, ok or similar, continue your previous offer. Ground every number in page.metrics or "
        "page.dataSummary; if the data needed is not in the context, say so plainly rather than guessing."
    )


def persona_for(db: Any, identity: Any, page_key: str | None, default_persona: str) -> tuple[str, bool]:
    """The persona to use, and whether it is a client-module persona (which has no write tools yet).

    The training persona applies only in a company with awareness training switched on, and only for its
    learners, for staff whose home is the training module, or on the training pages themselves.
    """
    company = company_record(db, getattr(identity, "company_code", None))
    if company.get(AWARENESS_TRAINING_SETTING) is not True and company.get(ESG_REPORTING_SETTING) is not True:
        return default_persona, False
    role = getattr(identity, "role", None)
    if role in ("learner", "funder") or company.get(CLIENT_HOME_SETTING) == AWARENESS_TRAINING_KEY or is_training_page(page_key):
        name = str(company.get("companyName") or company.get("name") or "").strip()
        return training_persona(name, role, company.get(ESG_REPORTING_SETTING) is True), True
    return default_persona, False


# ---------------------------------------------------------------------------------------------------------------
# The training company's library (trainingLibrary, with the text of readable files in trainingLibraryTexts)
# ---------------------------------------------------------------------------------------------------------------

LIBRARY_STAFF_ROLES = ("projectadmin", "operations")
LIBRARY_SHARED_ROLES = ("learner", "clientorg")
STOPWORDS = {
    "the", "and", "for", "are", "was", "with", "what", "when", "where", "which", "who", "how", "why", "this", "that",
    "from", "have", "has", "had", "you", "your", "our", "can", "does", "did", "about", "into", "they", "them", "their",
    "there", "will", "would", "should", "could", "please", "tell", "explain", "give", "need", "know", "want", "any",
}


def _words(text: str) -> list[str]:
    return [word for word in re.findall(r"[a-z0-9]{3,}", str(text or "").lower()) if word not in STOPWORDS]


def _chunks(text: str, size: int = 900) -> list[str]:
    """Paragraphs joined up to about `size` characters, so a passage keeps its sense."""
    pieces, current = [], ""
    for paragraph in re.split(r"\n\s*\n|\n", str(text or "")):
        paragraph = paragraph.strip()
        if not paragraph:
            continue
        if current and len(current) + len(paragraph) > size:
            pieces.append(current)
            current = ""
        current = f"{current}\n{paragraph}".strip() if current else paragraph[: size * 2]
    if current:
        pieces.append(current)
    return pieces


def library_context(db: Any, identity: Any, question: str, max_chars: int = 6000) -> dict[str, Any] | None:
    """What the assistant may know of the company's library for this person and question.

    Staff get the whole library; learners and client companies only the shared items; anyone else nothing. The
    passages are the ones sharing the most words with the question, up to `max_chars`.
    """
    role = getattr(identity, "role", None)
    code = str(getattr(identity, "company_code", None) or "").strip()
    if not code or role not in LIBRARY_STAFF_ROLES + LIBRARY_SHARED_ROLES:
        return None
    try:
        rows = [(row.id, row.to_dict() or {}) for row in db.collection("trainingLibrary").where("companyCode", "==", code).stream()]
    except Exception:
        return None
    if role not in LIBRARY_STAFF_ROLES:
        rows = [(item_id, data) for item_id, data in rows if data.get("audience") == "shared"]
    if not rows:
        return None

    catalogue = [
        {
            "title": data.get("title") or "",
            "description": data.get("description") or "",
            "course": data.get("courseTitle") or "all courses",
            "type": data.get("category") or "reference",
            **({"sharedWithLearners": data.get("audience") == "shared"} if role in LIBRARY_STAFF_ROLES else {}),
        }
        for _, data in rows[:40]
    ]

    wanted = set(_words(question))
    scored: list[tuple[int, str, str]] = []
    if wanted:
        for item_id, data in rows:
            if not data.get("textChars"):
                continue
            try:
                snapshot = db.collection("trainingLibraryTexts").document(item_id).get()
                text = (snapshot.to_dict() or {}).get("text", "") if snapshot.exists else ""
            except Exception:
                text = ""
            for chunk in _chunks(text):
                score = len(wanted.intersection(_words(chunk)))
                if score:
                    scored.append((score, data.get("title") or "", chunk))
    scored.sort(key=lambda row: row[0], reverse=True)

    excerpts, used = [], 0
    for _, title, chunk in scored:
        if used + len(chunk) > max_chars:
            break
        excerpts.append({"document": title, "text": chunk})
        used += len(chunk)
    return {"items": catalogue, "excerpts": excerpts}
