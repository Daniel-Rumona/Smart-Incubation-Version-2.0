"""Drafts the written sections of an ESG report from the report's own data (src/pages/esg/EsgReportPage.tsx).

The facilitator's registers (data, risks, stakeholders, actions) are read from Firestore here, only for a report of
the signed-in staff member's own company and only while the company has ESG reporting switched on
(companies/{code}.esgReportingEnabled). The model is told to use nothing else. Every figure in a draft is then compared
with the figures in the data; those that are not there are returned as `unmatchedFigures` so the page asks for them to
be checked. Nothing is written here: the page saves the drafts.

Section keys and titles are kept in step with ESG_SECTIONS in src/utils/esgReportChecks.ts.
"""

from __future__ import annotations

import re
from typing import Any, Callable

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

ESG_STAFF_ROLES = {"projectadmin", "operations"}

SECTIONS: dict[str, tuple[str, str]] = {
    "about": (
        "About this report",
        "Introduce the report: the client organisation, the reporting period, the statement of use (with reference to, "
        "or in accordance with, the GRI Standards), the GRI Sector Standard and the other frameworks applied, and that the "
        "figures come from the organisation's own records (name the evidence sources given).",
    ),
    "leadership": (
        "Message from leadership",
        "A short message from the organisation's leadership introducing the report: the year's main ESG results and "
        "priorities, using only the data given. Write it in the first person plural (\"we\"). Do not invent quotes, names "
        "or titles; the leader approves and signs it.",
    ),
    "strategy": (
        "Organisation and strategy",
        "The organisation's activities and its approach to sustainability, drawn only from the data, risks and actions "
        "given. If nothing is given about strategy or policies, say the organisation is developing them.",
    ),
    "materiality": (
        "Material topics",
        "The material topics: the highest-scoring risks (likelihood times impact) and the stakeholders' main concerns, and "
        "how they were identified (the ESG risk register and stakeholder map), with reference to GRI 3.",
    ),
    "environment": (
        "Environmental performance",
        "Each environmental (E) indicator: its current value against the baseline and target, with its unit and GRI "
        "disclosure. Say where a value or target is missing.",
    ),
    "climate": (
        "Climate change and energy",
        "The carbon footprint: total emissions and Scope 1, 2 and 3 in tonnes CO2e, the largest sources, energy use "
        "(electricity and fuel indicators) and the emissions targets and actions, with GRI 305-1, 305-2 and 305-3. State "
        "the carbon tax position as given (pays carbon tax directly, or not); do not state any carbon tax amount. If no "
        "footprint is given, say it has not been measured yet.",
    ),
    "social": (
        "Social performance",
        "Each social (S) indicator: its current value against the baseline and target, with its unit and GRI disclosure. "
        "Say where a value or target is missing.",
    ),
    "governance": (
        "Governance",
        "Each governance (G) indicator and the governance risks and their controls, with the GRI disclosures.",
    ),
    "stakeholders": (
        "Stakeholder engagement",
        "Who the stakeholders are, their concerns and how the organisation engages them, with reference to GRI 2-29.",
    ),
    "actions": (
        "Targets and next steps",
        "The action plan: each action with its owner, due date, KPI and target, and how it addresses the material topics "
        "(GRI 3-3 management of material topics).",
    ),
}

SYSTEM_PROMPT = """You write sections of an ESG (sustainability) report for a client organisation, prepared by an ESG
consultant. The input gives the report's setup, the standards it is aligned to, the organisation's registers:
indicators (data), risks, stakeholders and actions, and its carbon footprint (tonnes CO2e by scope and by source) when
one was measured.

Rules:
- Use only the facts and figures in the input. Never invent figures, targets, policies, certifications, events,
  people or quotes. Do not estimate or extrapolate.
- You may state the change from a baseline to a current value as a percentage rounded to a whole number.
- Where information is missing, say so plainly (for example "a target has not been set yet").
- Quote figures exactly as given, with their units, and cite the GRI disclosure number given for an indicator
  (for example "(GRI 302-1)"). Refer to standards only as listed in the input.
- Write in clear, formal British English, in the third person about the organisation. Plain paragraphs only:
  no headings, no bullet points, no markdown. About 120 to 250 words per section.
- Write only the sections asked for, following each one's brief.

Return JSON only: {"sections": {"<section key>": "<section text>"}}
"""


class EsgDraftRequest(BaseModel):
    reportId: str = Field(min_length=1, max_length=200)
    sections: list[str] = Field(default_factory=list, max_length=len(SECTIONS))
    # The standards the page worked out (config/esgStandards.ts), to name them as the report does.
    standards: list[str] = Field(default_factory=list, max_length=40)


NUMBER = re.compile(r"(?<![\w.-])(\d{1,3}(?:[ ,]\d{3})+|\d+)(?:\.(\d+))?(?![\w-])")
YEAR = re.compile(r"^(19|20|21)\d\d$")
MONTHS = r"(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)"


def _value(whole: str, fraction: str | None) -> float:
    return float(f"{re.sub(r'[ ,]', '', whole)}.{fraction or '0'}")


def figures_in(text: str) -> list[tuple[str, float]]:
    """The figures in a text worth checking: not years, not disclosure numbers (302-1), not small counts (0-10)."""
    found = []
    for match in NUMBER.finditer(text or ""):
        token = match.group(0)
        value = _value(match.group(1), match.group(2))
        if YEAR.match(token) or (value <= 10 and not match.group(2)):
            continue
        # "GRI 14", "TSRS 2", "IFRS S2" and "King V" style references are standard names, not figures.
        before = text[max(0, match.start() - 6):match.start()].lower()
        if re.search(r"(gri|tsrs|scope)\s*$", before):
            continue
        # The day in a date ("28 February 2026", "February 28").
        after = text[match.end():match.end() + 12].lower()
        if value <= 31 and not match.group(2) and (re.match(rf"\s+{MONTHS}\b", after) or re.search(rf"\b{MONTHS}\s+$", text[max(0, match.start() - 12):match.start()].lower())):
            continue
        found.append((token, value))
    return found


def data_figures(report: dict[str, Any]) -> set[float]:
    """Every figure in the report's registers, and the whole-number change between each baseline and current value."""
    values: set[float] = set()

    def collect(text: Any) -> list[float]:
        return [value for _, value in figures_in(str(text or ""))] + [
            _value(match.group(1), match.group(2)) for match in NUMBER.finditer(str(text or ""))
        ]

    for key in ("indicators", "risks", "stakeholders", "actions"):
        for row in report.get(key) or []:
            if not isinstance(row, dict):
                continue
            for field_value in row.values():
                values.update(collect(field_value))
    for row in report.get("risks") or []:
        if isinstance(row, dict) and isinstance(row.get("likelihood"), (int, float)) and isinstance(row.get("impact"), (int, float)):
            values.add(float(row["likelihood"] * row["impact"]))
    for row in report.get("indicators") or []:
        if not isinstance(row, dict):
            continue
        baseline = collect(row.get("baseline"))
        current = collect(row.get("current"))
        if baseline and current and baseline[0]:
            change = abs((current[0] - baseline[0]) / baseline[0] * 100)
            values.update({float(round(change)), round(change, 1)})
    # The carbon footprint as the draft is given it: each source's usage, factor and tonnes, the scope totals and shares.
    summary = footprint_summary(report)
    if summary:
        for source in summary["sources"]:
            values.update(value for value in (source["usage"], source["factorKgCo2ePerUnit"], source["tCO2e"]) if isinstance(value, (int, float)))
        for key in ("total", "scope1", "scope2", "scope3"):
            values.add(summary["tCO2e"][key])
            if summary["tCO2e"]["total"]:
                values.add(float(round(summary["tCO2e"][key] / summary["tCO2e"]["total"] * 100)))
    return values


def _quantity(value: float) -> str:
    """'2 311.63', '1 056': as the report writes figures (formatQuantity in src/config/esgEmissions.ts)."""
    return f"{value:,.2f}".rstrip("0").rstrip(".").replace(",", " ")


def _formatted(summary: dict[str, Any] | None) -> dict[str, Any] | None:
    """The footprint summary with its figures written out, so the draft quotes them the way the report does."""
    if not summary:
        return None
    return {
        **summary,
        "tCO2e": {key: _quantity(value) for key, value in summary["tCO2e"].items()},
        "sources": [
            {
                **source,
                "usage": _quantity(source["usage"]),
                "tCO2e": _quantity(source["tCO2e"]) if source["tCO2e"] is not None else "no factor entered",
            }
            for source in summary["sources"]
        ],
    }


def footprint_summary(report: dict[str, Any]) -> dict[str, Any] | None:
    """The report's carbon footprint for the draft: totals by scope and by source, in tonnes CO2e (2 decimals).

    Calculated as the page does (src/config/esgEmissions.ts): usage over the twelve months times the factor in kg CO2e
    per unit, over 1 000. Lines without a factor are listed with no tonnes. Carbon tax amounts are left out on purpose.
    """
    footprint = report.get("footprint") if isinstance(report.get("footprint"), dict) else {}
    rows = [row for row in (footprint.get("sources") or []) if isinstance(row, dict)]
    if not rows:
        return None
    sources = []
    totals = {1: 0.0, 2: 0.0, 3: 0.0}
    for row in rows:
        scope = row.get("scope") if row.get("scope") in (1, 2) else 3
        monthly = row.get("monthly") if isinstance(row.get("monthly"), list) else []
        usage = sum(value for value in monthly[:12] if isinstance(value, (int, float)) and not isinstance(value, bool))
        factor = row.get("factor") if isinstance(row.get("factor"), (int, float)) and not isinstance(row.get("factor"), bool) else None
        tonnes = usage * factor / 1000 if factor is not None else None
        if tonnes is not None:
            totals[scope] += tonnes
        sources.append({
            "scope": scope,
            "source": str(row.get("label") or ""),
            "unit": str(row.get("unit") or ""),
            "usage": round(usage, 2),
            "factorKgCo2ePerUnit": factor,
            "factorSource": str(row.get("factorSource") or ""),
            "tCO2e": round(tonnes, 2) if tonnes is not None else None,
        })
    total = totals[1] + totals[2] + totals[3]
    payer = footprint.get("carbonTaxPayer")
    return {
        "method": "GHG Protocol Corporate Standard: activity data x emission factors; Scope 2 location-based",
        "tCO2e": {"total": round(total, 2), "scope1": round(totals[1], 2), "scope2": round(totals[2], 2), "scope3": round(totals[3], 2)},
        "sources": sources,
        "carbonTaxPosition": (
            "pays carbon tax directly on its Scope 1 emissions" if payer == "yes"
            else "does not pay carbon tax directly (carbon tax on petrol and diesel is paid at the pump)" if payer == "no"
            else "not stated"
        ) if report.get("country") == "ZA" else "not applicable (South African carbon tax only)",
    }


def unmatched_figures(text: str, allowed: set[float]) -> list[str]:
    missing = []
    for token, value in figures_in(text):
        if not any(abs(value - known) <= max(0.005 * abs(known), 0.01) for known in allowed):
            missing.append(token)
    return list(dict.fromkeys(missing))


def build_payload(report: dict[str, Any], provider: str, keys: list[str], standards: list[str]) -> dict[str, Any]:
    def rows(key: str, fields: tuple[str, ...]) -> list[dict[str, Any]]:
        return [
            {field: row.get(field) for field in fields if row.get(field) not in (None, "")}
            for row in (report.get(key) or [])
            if isinstance(row, dict)
        ]

    return {
        "preparedBy": provider,
        "client": report.get("clientName"),
        "sector": report.get("sector"),
        "country": report.get("country"),
        "reportingPeriod": {"start": report.get("periodStart"), "end": report.get("periodEnd")},
        "publicationDate": report.get("publicationDate"),
        "statementOfUse": "in accordance with the GRI Standards" if report.get("claim") == "in_accordance" else "with reference to the GRI Standards",
        "standards": standards,
        "otherFrameworks": report.get("otherFrameworks") or None,
        "indicators": rows("indicators", ("pillar", "indicator", "unit", "baseline", "current", "target", "period", "evidence", "qualityCheck", "disclosure")),
        "risks": rows("risks", ("pillar", "risk", "stakeholders", "likelihood", "impact", "mitigation", "owner", "status")),
        "stakeholders": rows("stakeholders", ("stakeholder", "concern", "influence", "impact", "engagement")),
        "actions": rows("actions", ("pillar", "action", "baseline", "target", "kpi", "owner", "startDate", "dueDate", "budget", "status")),
        "carbonFootprint": _formatted(footprint_summary(report)),
        "sectionsToWrite": [{"key": key, "title": SECTIONS[key][0], "brief": SECTIONS[key][1]} for key in keys],
    }


def create_esg_report_router(
    db: Any,
    call_gemini: Callable[..., str],
    require_auth: Callable[[str | None], Any],
    extract_json: Callable[[str], dict[str, Any] | None],
) -> APIRouter:
    router = APIRouter()

    @router.post("/api/esg/draft")
    async def draft_esg_sections(payload: EsgDraftRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
        identity = require_auth(authorization)
        company_code = str(getattr(identity, "company_code", "") or "").strip()
        if getattr(identity, "role", None) not in ESG_STAFF_ROLES or not company_code:
            raise HTTPException(status_code=403, detail="Only the company's ESG staff can draft its reports")
        company_snapshot = db.collection("companies").document(company_code).get()
        company = (company_snapshot.to_dict() or {}) if company_snapshot.exists else {}
        if company.get("esgReportingEnabled") is not True:
            raise HTTPException(status_code=403, detail="ESG reporting is not switched on for this company")
        snapshot = db.collection("esgReports").document(payload.reportId).get()
        report = (snapshot.to_dict() or {}) if snapshot.exists else {}
        if not report or str(report.get("companyCode") or "") != company_code:
            raise HTTPException(status_code=404, detail="Report not found")

        keys = [key for key in payload.sections if key in SECTIONS] or list(SECTIONS)
        provider = str(company.get("companyName") or company.get("name") or company_code)
        reply = call_gemini(
            SYSTEM_PROMPT,
            build_payload(report, provider, keys, payload.standards),
            max_output_tokens=8000,
            response_mime_type="application/json",
        )
        parsed = extract_json(reply) or {}
        written = parsed.get("sections") if isinstance(parsed.get("sections"), dict) else {}
        allowed = data_figures(report)
        sections = []
        for key in keys:
            text = str(written.get(key) or "").strip()
            if not text:
                continue
            sections.append({
                "key": key,
                "title": SECTIONS[key][0],
                "text": text,
                "unmatchedFigures": unmatched_figures(text, allowed),
            })
        if not sections:
            raise HTTPException(status_code=502, detail="The draft came back empty")
        return {"sections": sections}

    return router
