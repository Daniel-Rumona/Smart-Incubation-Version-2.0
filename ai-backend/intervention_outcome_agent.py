"""Drafts the outcome check-back for interventions that were set up without one.

Interventions created before outcome tracking existed have no intended outcome,
named deliverable or follow-up window, so nothing prompts a facilitator to check
the change stuck. This reads each intervention's catalogue entry and proposes
those fields in the shape InterventionOutcomeDefinition stores them. Nothing is
written here: operations reviews the drafts on the setup page and saves them.
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

MAX_INTERVENTIONS = 15
MIN_FOLLOW_UP_DAYS = 14
MAX_FOLLOW_UP_DAYS = 365
DEFAULT_FOLLOW_UP_DAYS = 60

# Kept in step with OUTCOME_TYPE_OPTIONS in src/services/interventionOutcomeConfig.ts.
OUTCOME_TYPES = {
    "capability_established",
    "process_implemented",
    "behaviour_adopted",
    "compliance_achieved",
    "risk_reduced",
    "performance_improved",
    "access_achieved",
    "issue_resolved",
}

SYSTEM_PROMPT = """You help an SME incubator define how each support intervention is checked after delivery.

For every intervention in the input, return the outcome check-back:
- deliverableName: the tangible output the facilitator uploads as proof of evidence,
  as a short noun phrase (e.g. "Cash Flow Forecast", "POPIA Policy", "Signed Shareholder Agreement").
- deliverableDescription: one sentence on what that output must contain.
- deliverableRequired: true when the intervention clearly produces a document or artefact
  that should exist before completion; false for advisory sessions, coaching or check-ins.
- outcomeType: the kind of change the intervention is meant to produce, one of
  capability_established, process_implemented, behaviour_adopted, compliance_achieved,
  risk_reduced, performance_improved, access_achieved, issue_resolved.
  The deliverable is not the outcome: a business plan is a deliverable, using it to guide decisions is the outcome.
- intendedOutcome: one sentence, starting "The SME", describing what is observably different
  for the business once the change has stuck.
- followUpDays: whole days after completion before the facilitator checks the change has stuck.
  Use 30-60 for quick operational fixes, 60-90 for processes and habits, 90-180 for compliance,
  funding or performance results.
- rationale: one short sentence explaining the choice, for the reviewer.

Return JSON only:
{"suggestions": [{"id": "the input id", "deliverableName": "", "deliverableDescription": "",
"deliverableRequired": true, "outcomeType": "", "intendedOutcome": "", "followUpDays": 60, "rationale": ""}]}

Rules:
- One suggestion per input id, using the id exactly as given.
- Base each suggestion on that intervention's title, support area, steps and delivery details. Do not invent
  services the intervention does not describe.
- Where an intervention already has some outcome fields filled in, keep them consistent with what is there.
- Plain, specific language. No commentary outside the JSON.
"""


class InterventionStep(BaseModel):
    title: str | None = None
    description: str | None = None


class InterventionInput(BaseModel):
    id: str = Field(min_length=1, max_length=200)
    title: str | None = Field(default=None, max_length=300)
    areaOfSupport: str | None = Field(default=None, max_length=200)
    description: str | None = Field(default=None, max_length=2000)
    executionMode: str | None = None
    durationTerm: str | None = None
    isRecurring: str | None = None
    deliveryStrategy: str | None = None
    steps: list[InterventionStep] = Field(default_factory=list)
    outcomeDefinition: dict[str, Any] | None = None


class OutcomeMigrationRequest(BaseModel):
    interventions: list[InterventionInput] = Field(min_length=1)


class OutcomeSuggestion(BaseModel):
    id: str
    intendedOutcome: str = ""
    outcomeType: str | None = None
    deliverableName: str = ""
    deliverableDescription: str = ""
    deliverableRequired: bool = False
    followUpDays: int = DEFAULT_FOLLOW_UP_DAYS
    rationale: str = ""


class OutcomeMigrationResponse(BaseModel):
    ok: bool = True
    suggestions: list[OutcomeSuggestion] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)


def _clean_text(value: Any, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


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


def _follow_up_days(value: Any) -> int:
    try:
        days = int(round(float(value)))
    except (TypeError, ValueError):
        return DEFAULT_FOLLOW_UP_DAYS
    return max(MIN_FOLLOW_UP_DAYS, min(MAX_FOLLOW_UP_DAYS, days))


def _normalise_suggestions(
    raw: Any,
    interventions: list[InterventionInput],
) -> tuple[list[OutcomeSuggestion], list[str]]:
    by_id = {item.id: item for item in interventions}
    warnings: list[str] = []
    suggestions: dict[str, OutcomeSuggestion] = {}

    for entry in raw if isinstance(raw, list) else []:
        if not isinstance(entry, dict):
            continue
        intervention_id = str(entry.get("id") or "").strip()
        source = by_id.get(intervention_id)
        if not source or intervention_id in suggestions:
            continue

        outcome_type = str(entry.get("outcomeType") or "").strip().lower()
        intended = _clean_text(entry.get("intendedOutcome"), 400)
        deliverable = _clean_text(entry.get("deliverableName"), 120)
        if not intended and not deliverable:
            continue

        suggestions[intervention_id] = OutcomeSuggestion(
            id=intervention_id,
            intendedOutcome=intended,
            outcomeType=outcome_type if outcome_type in OUTCOME_TYPES else None,
            deliverableName=deliverable,
            deliverableDescription=_clean_text(entry.get("deliverableDescription"), 400),
            # Agent-delivered work has no upload step, so a required deliverable would never be met.
            deliverableRequired=bool(entry.get("deliverableRequired")) and not str(source.deliveryStrategy or "").startswith("agent"),
            followUpDays=_follow_up_days(entry.get("followUpDays")),
            rationale=_clean_text(entry.get("rationale"), 300),
        )

    for item in interventions:
        if item.id not in suggestions:
            warnings.append(f'No suggestion was produced for "{item.title or item.id}"')

    ordered = [suggestions[item.id] for item in interventions if item.id in suggestions]
    return ordered, warnings


def create_intervention_outcome_router(
    call_model: Callable[..., str],
    require_auth: Callable[[str | None], Any],
) -> APIRouter:
    router = APIRouter(prefix="/api/interventions", tags=["interventions"])

    @router.post("/outcome-migration", response_model=OutcomeMigrationResponse)
    async def suggest_outcomes(
        payload: OutcomeMigrationRequest,
        authorization: str | None = Header(default=None),
    ) -> OutcomeMigrationResponse:
        require_auth(authorization)

        if len(payload.interventions) > MAX_INTERVENTIONS:
            raise HTTPException(status_code=400, detail=f"Send at most {MAX_INTERVENTIONS} interventions at a time")

        model_input = [
            {
                "id": item.id,
                "title": item.title or "",
                "areaOfSupport": item.areaOfSupport or "",
                "description": item.description or "",
                "executionMode": item.executionMode or "single_session",
                "durationTerm": item.durationTerm or "short_term",
                "recurring": item.isRecurring == "yes",
                "deliveryStrategy": item.deliveryStrategy or "human_only",
                "steps": [
                    {"title": step.title or "", "description": step.description or ""}
                    for step in item.steps[:12]
                ],
                "existingOutcome": item.outcomeDefinition or {},
            }
            for item in payload.interventions
        ]

        raw = call_model(
            SYSTEM_PROMPT,
            {"interventions": model_input},
            max_output_tokens=600 * len(model_input) + 400,
            response_mime_type="application/json",
        )

        parsed = _parse_model_json(raw)
        suggestions, warnings = _normalise_suggestions(parsed.get("suggestions"), payload.interventions)

        if not suggestions:
            raise HTTPException(status_code=502, detail="No outcome suggestions were produced. Try again.")

        return OutcomeMigrationResponse(suggestions=suggestions, warnings=warnings)

    return router
