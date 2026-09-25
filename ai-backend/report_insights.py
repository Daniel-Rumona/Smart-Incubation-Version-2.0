"""AI-written narrative for the report exports.

Every reports page (operations, project admin, director, consultant) sends the figures it is already
showing, plus who is asking. This turns them into an executive summary, highlights, risks, a short
action plan and a note per data section, framed for that role. When no model is configured, or the
model fails, the same shape is built from the figures with plain rules so an export never fails.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger("report_insights")

MAX_KPIS = 16
MAX_SECTIONS = 12
MAX_ROWS_PER_SECTION = 25
MAX_CELL_CHARS = 120

ROLE_FOCUS: dict[str, tuple[str, str]] = {
    "operations": (
        "operations leads and project managers",
        "delivery throughput, overdue and held-up interventions, appointment attendance capture, "
        "compliance follow-up and team capacity",
    ),
    "projectmanager": (
        "operations leads and project managers",
        "delivery throughput, overdue and held-up interventions, appointment attendance capture, "
        "compliance follow-up and team capacity",
    ),
    "projectadmin": (
        "programme administrators",
        "programme intake and acceptance, intervention delivery and completion, compliance alerts "
        "and SME revenue and employment performance",
    ),
    "director": (
        "executives and directors",
        "portfolio health, growth and revenue trends, risk exposure, delivery reliability and the "
        "decisions leadership needs to take",
    ),
    "consultant": (
        "consultants",
        "their own assignment workload, completion and overdue work, client feedback ratings and "
        "the follow-ups that need their attention",
    ),
}
DEFAULT_FOCUS = (
    "programme stakeholders",
    "delivery progress, risks and the actions that would most improve results",
)


class ReportKpi(BaseModel):
    label: str = Field(default="", max_length=120)
    value: str | int | float | None = None
    note: str | None = Field(default=None, max_length=200)
    tone: str | None = Field(default=None, max_length=20)  # good | watch | risk


class ReportSection(BaseModel):
    key: str = Field(default="", max_length=80)
    title: str = Field(default="", max_length=160)
    rows: list[dict[str, Any]] = Field(default_factory=list)


class ReportInsightRequest(BaseModel):
    reportTitle: str = Field(default="Report", max_length=160)
    periodLabel: str = Field(default="", max_length=160)
    companyName: str | None = Field(default=None, max_length=160)
    role: str = Field(default="", max_length=40)
    audience: str = Field(default="", max_length=120)
    template: str = Field(default="executive", max_length=20)  # executive | detailed
    kpis: list[ReportKpi] = Field(default_factory=list)
    sections: list[ReportSection] = Field(default_factory=list)


def _focus(role: str) -> tuple[str, str]:
    return ROLE_FOCUS.get((role or "").strip().lower(), DEFAULT_FOCUS)


def _trim_cell(value: Any) -> Any:
    if isinstance(value, str) and len(value) > MAX_CELL_CHARS:
        return value[: MAX_CELL_CHARS - 1] + "…"
    return value


def build_model_payload(payload: ReportInsightRequest) -> dict[str, Any]:
    """The figures the model may use, capped so a large report cannot blow the prompt up."""
    return {
        "reportTitle": payload.reportTitle,
        "period": payload.periodLabel,
        "organisation": payload.companyName,
        "kpis": [kpi.model_dump() for kpi in payload.kpis[:MAX_KPIS]],
        "sections": [
            {
                "key": section.key,
                "title": section.title,
                "totalRows": len(section.rows),
                "rows": [
                    {key: _trim_cell(value) for key, value in row.items()}
                    for row in section.rows[:MAX_ROWS_PER_SECTION]
                ],
            }
            for section in payload.sections[:MAX_SECTIONS]
        ],
    }


def build_system_prompt(payload: ReportInsightRequest) -> str:
    reader, focus = _focus(payload.role)
    detailed = payload.template == "detailed"
    sizes = (
        "executiveSummary up to 200 words; up to 6 highlights; up to 6 risks; up to 6 actions; "
        "a sectionNotes entry of up to 50 words for every section key supplied"
        if detailed
        else "executiveSummary up to 120 words; 3 to 5 highlights; 3 to 5 risks; up to 4 actions; "
        "sectionNotes may be an empty object"
    )
    return (
        f"You write the narrative for an incubation programme report. The reader is one of {reader}. "
        f"Frame everything around what matters to them: {focus}. "
        "Use ONLY the figures supplied. Never invent numbers, names or dates; if something is not in "
        "the data, say it was not captured. Be specific: cite the figures, compare where the data "
        "allows, and name the biggest gap. Plain professional British English, no Markdown, no emojis. "
        "Write as an impartial third-person report of what was done and what the figures show. Never "
        "address the reader or the author: do not use 'you', 'your', 'we', 'our', 'I' or 'my'; refer to "
        "'the consultant', 'the team', 'the programme' or the organisation instead. "
        "Return valid JSON only with exactly these keys: executiveSummary (string), highlights "
        "(array of strings), risks (array of strings), outlook (string, one or two sentences on what "
        "to watch next period), actionPlan (array of objects with action, owner, priority "
        "(High/Medium/Low), due, successMeasure), sectionNotes (object mapping each section key to a "
        f"string). Size limits: {sizes}."
    )


def _text(value: Any, limit: int = 1200) -> str:
    return str(value or "").strip()[:limit]


def _text_list(value: Any, limit: int = 8) -> list[str]:
    if not isinstance(value, list):
        return []
    return [_text(item, 400) for item in value if _text(item, 400)][:limit]


def normalise_insights(result: dict[str, Any], payload: ReportInsightRequest) -> dict[str, Any]:
    """Coerces whatever the model returned into the exact shape the exports render."""
    action_plan: list[dict[str, str]] = []
    for item in (result.get("actionPlan") or [])[:8] if isinstance(result.get("actionPlan"), list) else []:
        if not isinstance(item, dict) or not _text(item.get("action")):
            continue
        priority = _text(item.get("priority"), 12).capitalize()
        action_plan.append({
            "action": _text(item.get("action"), 300),
            "owner": _text(item.get("owner"), 80) or "Programme team",
            "priority": priority if priority in {"High", "Medium", "Low"} else "Medium",
            "due": _text(item.get("due"), 80) or "Next reporting cycle",
            "successMeasure": _text(item.get("successMeasure"), 300),
        })

    section_keys = {section.key for section in payload.sections}
    raw_notes = result.get("sectionNotes") if isinstance(result.get("sectionNotes"), dict) else {}
    section_notes = {
        key: _text(note, 600) for key, note in raw_notes.items() if key in section_keys and _text(note, 600)
    }

    return {
        "executiveSummary": _text(result.get("executiveSummary"), 2000),
        "highlights": _text_list(result.get("highlights") or result.get("operationalHighlights")),
        "risks": _text_list(result.get("risks")),
        "outlook": _text(result.get("outlook"), 600),
        "actionPlan": action_plan,
        "sectionNotes": section_notes,
    }


def _kpi_line(kpi: ReportKpi) -> str:
    return f"{kpi.label}: {kpi.value}" + (f" ({kpi.note})" if kpi.note else "")


def fallback_insights(payload: ReportInsightRequest) -> dict[str, Any]:
    """Rule-based narrative from the figures, used when the model is unavailable."""
    reader, focus = _focus(payload.role)
    period = payload.periodLabel or "the selected period"
    kpis = [kpi for kpi in payload.kpis[:MAX_KPIS] if kpi.label]
    risky = [kpi for kpi in kpis if (kpi.tone or "").lower() == "risk"]
    watch = [kpi for kpi in kpis if (kpi.tone or "").lower() == "watch"]
    good = [kpi for kpi in kpis if (kpi.tone or "").lower() == "good"]

    lead = "; ".join(_kpi_line(kpi) for kpi in kpis[:5])
    summary = (
        f"This {payload.reportTitle.lower()} covers {period} and is written for {reader}, "
        f"with a focus on {focus}."
    )
    if lead:
        summary += f" Headline figures: {lead}."
    if risky:
        summary += f" Attention is needed on {', '.join(kpi.label.lower() for kpi in risky[:3])}."
    elif not kpis:
        summary += " No headline figures were captured for this period."

    highlights = [_kpi_line(kpi) for kpi in (good or kpis)[:5]]
    risks = [f"{_kpi_line(kpi)} needs follow-up." for kpi in (risky + watch)[:5]]
    if not risks:
        risks = ["No figure was flagged as at risk in this period."]

    action_plan = [
        {
            "action": f"Review and address {kpi.label.lower()}",
            "owner": "Programme team",
            "priority": "High" if (kpi.tone or "").lower() == "risk" else "Medium",
            "due": "Next reporting cycle",
            "successMeasure": f"{kpi.label} improves against this report",
        }
        for kpi in (risky + watch)[:4]
    ] or [{
        "action": "Keep monitoring the headline figures each cycle",
        "owner": "Programme team",
        "priority": "Low",
        "due": "Next reporting cycle",
        "successMeasure": "Figures hold or improve",
    }]

    return {
        "executiveSummary": summary,
        "highlights": highlights,
        "risks": risks,
        "outlook": "Track the flagged figures again next period to confirm they are moving the right way.",
        "actionPlan": action_plan,
        "sectionNotes": {
            section.key: f"{len(section.rows)} record{'s' if len(section.rows) != 1 else ''} in this section."
            for section in payload.sections[:MAX_SECTIONS]
            if section.key
        },
    }


def create_report_insights_router(
    require_auth: Callable[[str | None], Any],
    call_gemini: Callable[..., str],
    extract_json: Callable[[str], dict[str, Any] | None],
    model_name: str,
) -> APIRouter:
    router = APIRouter()

    @router.post("/api/reports/insights")
    async def report_insights(
        payload: ReportInsightRequest,
        authorization: str | None = Header(default=None),
    ) -> dict[str, Any]:
        require_auth(authorization)

        try:
            text = call_gemini(
                build_system_prompt(payload),
                build_model_payload(payload),
                max_output_tokens=2600 if payload.template == "detailed" else 1600,
                response_mime_type="application/json",
            )
            insights = normalise_insights(extract_json(text) or {}, payload)
            if insights["executiveSummary"]:
                return {"insights": insights, "model": model_name}
            logger.warning("Report insights: the model reply had no executive summary (reply starts: %r); using the rule-based fallback.", (text or "")[:300])
        except HTTPException as error:
            logger.warning("Report insights: model call failed (%s); using the rule-based fallback.", error.detail)
        except Exception:  # noqa: BLE001 - an export must never fail because the model misbehaved
            logger.exception("Report insights: unexpected error; using the rule-based fallback.")

        return {"insights": fallback_insights(payload), "model": "fallback"}

    return router
