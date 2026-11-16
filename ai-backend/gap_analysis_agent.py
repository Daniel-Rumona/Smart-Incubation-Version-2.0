"""Reads an SME's gap analysis answers and proposes interventions for its diagnostic plan.

Operations sets up a gap analysis as a survey (sections of questions, usually with a
1-5 rating per section), the SME answers it, and this turns the answers into what a
facilitator would write up after a diagnostic consultation: a score per business
area, the gaps found with their priority, and which interventions from the company's
own catalogue would close them. Nothing is written here; operations reviews the
suggestions and chooses what goes onto the diagnostic plan.
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

MAX_SECTIONS = 40
MAX_QUESTIONS_PER_SECTION = 60
MAX_CATALOGUE = 250
MAX_GAPS = 12
MAX_INTERVENTIONS_PER_GAP = 3
PRIORITIES = ("High", "Medium", "Low")

SYSTEM_PROMPT = """You are a business development facilitator at an SME incubator. You have the SME's
answers to a gap analysis (a business diagnostic) and the incubator's catalogue of support interventions.

Produce the diagnostic write-up:
- summary: 2-3 sentences on where the business stands and what matters most.
- scorecard: one entry per section of the questionnaire that is a business area (skip purely administrative
  sections such as contact details or signatures). score is 1 (critical) to 5 (strong). Where the SME gave a
  rating for that section, use it unless the answers clearly contradict it. finding is one sentence.
- strengths: up to 4 short phrases.
- gaps: the problems holding the business back, most important first, at most 12. For each:
  area (the scorecard area it belongs to), finding (the problem, specific to this business), rootCause,
  impact (on the business), priority High|Medium|Low, and interventionIds: up to 3 ids from the catalogue
  that would close the gap, best first, with reason (one sentence on why those interventions fit).
  Use an empty list when nothing in the catalogue fits; never invent an id.

Return JSON only:
{"summary": "", "scorecard": [{"area": "", "score": 3, "finding": ""}], "strengths": [""],
 "gaps": [{"area": "", "finding": "", "rootCause": "", "impact": "", "priority": "High",
           "interventionIds": [""], "reason": ""}]}

Rules:
- Base everything on the answers given. Unanswered questions are not evidence of a gap on their own.
- Interventions the SME already has on its plan are listed in alreadyPlanned; do not suggest them again.
- Plain, specific language a facilitator could share with the SME. No commentary outside the JSON.
"""


class GapQuestion(BaseModel):
    question: str = Field(max_length=500)
    type: str | None = None
    answer: Any = None


class GapSection(BaseModel):
    title: str = Field(default="General", max_length=200)
    questions: list[GapQuestion] = Field(default_factory=list)


class CatalogueIntervention(BaseModel):
    id: str = Field(min_length=1, max_length=200)
    title: str = Field(max_length=300)
    areaOfSupport: str | None = Field(default=None, max_length=200)


class GapAnalysisRequest(BaseModel):
    title: str | None = Field(default=None, max_length=300)
    business: dict[str, Any] = Field(default_factory=dict)
    sections: list[GapSection] = Field(min_length=1)
    catalogue: list[CatalogueIntervention] = Field(default_factory=list)
    alreadyPlanned: list[str] = Field(default_factory=list)


class ScorecardEntry(BaseModel):
    area: str
    score: int
    finding: str = ""


class SuggestedIntervention(BaseModel):
    interventionId: str
    title: str
    areaOfSupport: str | None = None


class Gap(BaseModel):
    area: str = ""
    finding: str
    rootCause: str = ""
    impact: str = ""
    priority: str = "Medium"
    reason: str = ""
    interventions: list[SuggestedIntervention] = Field(default_factory=list)


class GapAnalysisResponse(BaseModel):
    ok: bool = True
    summary: str = ""
    scorecard: list[ScorecardEntry] = Field(default_factory=list)
    strengths: list[str] = Field(default_factory=list)
    gaps: list[Gap] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


def _clean_text(value: Any, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def _normalise_key(value: Any) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip().lower()


def _parse_model_json(text: str) -> dict[str, Any]:
    candidate = text.strip()

    if candidate.startswith("```"):
        candidate = re.sub(r"^```[a-zA-Z]*\s*|\s*```$", "", candidate).strip()

    try:
        parsed = json.loads(candidate)
    except json.JSONDecodeError:
        match = re.search(r"\{.*\}", candidate, re.DOTALL)
        if not match:
            raise HTTPException(status_code=502, detail="The AI response could not be read")
        try:
            parsed = json.loads(match.group(0))
        except json.JSONDecodeError as error:
            raise HTTPException(status_code=502, detail="The AI response could not be read") from error

    if not isinstance(parsed, dict):
        raise HTTPException(status_code=502, detail="The AI response could not be read")

    return parsed


def _score(value: Any) -> int | None:
    try:
        score = int(round(float(value)))
    except (TypeError, ValueError):
        return None
    return max(1, min(5, score))


def _priority(value: Any) -> str:
    text = _normalise_key(value)
    for priority in PRIORITIES:
        if text.startswith(priority.lower()):
            return priority
    return "Medium"


def _answer_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, list):
        return ", ".join(_clean_text(item, 200) for item in value if _clean_text(item, 200))
    if isinstance(value, dict):
        return _clean_text(json.dumps(value), 1000)
    return _clean_text(value, 2000)


def _normalise(
    parsed: dict[str, Any],
    catalogue: list[CatalogueIntervention],
    already_planned: set[str],
) -> GapAnalysisResponse:
    by_id = {item.id: item for item in catalogue}
    # Models sometimes return the title instead of the id; accept that when it is unambiguous.
    by_title = {_normalise_key(item.title): item for item in catalogue}
    warnings: list[str] = []

    scorecard: list[ScorecardEntry] = []
    seen_areas: set[str] = set()
    for entry in parsed.get("scorecard") if isinstance(parsed.get("scorecard"), list) else []:
        if not isinstance(entry, dict):
            continue
        area = _clean_text(entry.get("area"), 120)
        score = _score(entry.get("score"))
        if not area or score is None or _normalise_key(area) in seen_areas:
            continue
        seen_areas.add(_normalise_key(area))
        scorecard.append(ScorecardEntry(area=area, score=score, finding=_clean_text(entry.get("finding"), 400)))

    strengths = [
        _clean_text(item, 200)
        for item in (parsed.get("strengths") if isinstance(parsed.get("strengths"), list) else [])
        if _clean_text(item, 200)
    ][:6]

    gaps: list[Gap] = []
    dropped_ids = 0
    for entry in parsed.get("gaps") if isinstance(parsed.get("gaps"), list) else []:
        if not isinstance(entry, dict):
            continue
        finding = _clean_text(entry.get("finding"), 400)
        if not finding:
            continue

        interventions: list[SuggestedIntervention] = []
        raw_ids = entry.get("interventionIds") if isinstance(entry.get("interventionIds"), list) else []
        for raw_id in raw_ids:
            match = by_id.get(str(raw_id or "").strip()) or by_title.get(_normalise_key(raw_id))
            if not match:
                dropped_ids += 1
                continue
            if match.id in already_planned or any(item.interventionId == match.id for item in interventions):
                continue
            interventions.append(SuggestedIntervention(interventionId=match.id, title=match.title, areaOfSupport=match.areaOfSupport))
            if len(interventions) >= MAX_INTERVENTIONS_PER_GAP:
                break

        gaps.append(Gap(
            area=_clean_text(entry.get("area"), 120),
            finding=finding,
            rootCause=_clean_text(entry.get("rootCause"), 400),
            impact=_clean_text(entry.get("impact"), 400),
            priority=_priority(entry.get("priority")),
            reason=_clean_text(entry.get("reason"), 400),
            interventions=interventions,
        ))
        if len(gaps) >= MAX_GAPS:
            break

    if dropped_ids:
        warnings.append(f"{dropped_ids} suggested intervention{'s' if dropped_ids != 1 else ''} were not in the catalogue and were left out")
    if not catalogue:
        warnings.append("The intervention catalogue is empty, so no interventions could be suggested")

    order = {priority: index for index, priority in enumerate(PRIORITIES)}
    gaps.sort(key=lambda gap: order.get(gap.priority, 1))

    return GapAnalysisResponse(
        summary=_clean_text(parsed.get("summary"), 1200),
        scorecard=scorecard,
        strengths=strengths,
        gaps=gaps,
        warnings=warnings,
    )


def create_gap_analysis_router(
    call_model: Callable[..., str],
    require_auth: Callable[[str | None], Any],
) -> APIRouter:
    router = APIRouter(prefix="/api/gap-analysis", tags=["gap-analysis"])

    @router.post("/analyse", response_model=GapAnalysisResponse)
    async def analyse(
        payload: GapAnalysisRequest,
        authorization: str | None = Header(default=None),
    ) -> GapAnalysisResponse:
        require_auth(authorization)

        if len(payload.sections) > MAX_SECTIONS:
            raise HTTPException(status_code=400, detail=f"Send at most {MAX_SECTIONS} sections")

        sections = []
        for section in payload.sections:
            answered = [
                {"question": _clean_text(question.question, 500), "type": question.type or "text", "answer": _answer_text(question.answer)}
                for question in section.questions[:MAX_QUESTIONS_PER_SECTION]
            ]
            if answered:
                sections.append({"title": _clean_text(section.title, 200) or "General", "questions": answered})

        if not any(question["answer"] for section in sections for question in section["questions"]):
            raise HTTPException(status_code=422, detail="This response has no answers to analyse")

        catalogue = payload.catalogue[:MAX_CATALOGUE]
        already_planned = {str(item).strip() for item in payload.alreadyPlanned if str(item).strip()}

        raw = call_model(
            SYSTEM_PROMPT,
            {
                "questionnaire": payload.title or "Gap analysis",
                "business": payload.business,
                "sections": sections,
                "catalogue": [item.model_dump() for item in catalogue],
                "alreadyPlanned": sorted(already_planned),
            },
            max_output_tokens=4000,
            response_mime_type="application/json",
        )

        return _normalise(_parse_model_json(raw), catalogue, already_planned)

    return router
