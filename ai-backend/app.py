from __future__ import annotations

import base64
import hmac
import json
import os
import re
import urllib.error
import urllib.request
import time
from datetime import date, datetime, timezone
from typing import Any

import firebase_admin
from fastapi import FastAPI, Header, HTTPException, Request, Response
from fastapi.exception_handlers import request_validation_exception_handler
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from firebase_admin import credentials, firestore
from pydantic import BaseModel, Field

from business_plan_agent import create_business_plan_router
from strategic_plan_agent import create_strategic_plan_router
from pitchfy_agent import create_pitchfy_router
from pitchfy_client import PitchfyClient
from document_provenance import create_document_provenance_router
from survey_import_agent import create_survey_import_router
from request_auth import create_request_authenticator
from whatsapp import (
    WhatsAppChatRequest,
    WhatsAppChatResponse,
    WhatsAppConversation,
    WhatsAppConversationStore,
    WhatsAppError,
    interpret_whatsapp_message,
)


GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash").strip()
AGENT_SHARED_SECRET = os.getenv("AGENT_SHARED_SECRET", "").strip()

pitchfy_client = PitchfyClient()

DEFAULT_ALLOWED_ORIGINS = [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
    "http://localhost:5174",
    "http://127.0.0.1:5174",
    "http://localhost:4173",
    "http://127.0.0.1:4173",
    "https://yoursdvniel-smart-incubation.hf.space",
]
ALLOWED_ORIGINS = [
    origin.strip()
    for origin in os.getenv("ALLOWED_ORIGINS", ",".join(DEFAULT_ALLOWED_ORIGINS)).split(",")
    if origin.strip()
]

MAX_DOCS_PER_COLLECTION = 8
SENSITIVE_FIELD_PARTS = {
    "email",
    "phone",
    "idnumber",
    "password",
    "token",
    "secret",
    "signature",
    "avatar",
    "photourl",
    "url",
    "path",
    "uid",
    "userid",
    "createdby",
}


def _load_service_account() -> dict[str, Any]:
    raw_json = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON", "").strip()
    raw_b64 = os.getenv("FIREBASE_SERVICE_ACCOUNT_B64", "").strip()

    if raw_json:
        return json.loads(raw_json)

    if raw_b64:
        return json.loads(base64.b64decode(raw_b64).decode("utf-8"))

    raise RuntimeError("Missing FIREBASE_SERVICE_ACCOUNT_JSON or FIREBASE_SERVICE_ACCOUNT_B64")


def _init_firestore() -> firestore.Client:
    if not firebase_admin._apps:
        service_account = _load_service_account()
        project_id = os.getenv("FIREBASE_PROJECT_ID", "").strip() or service_account.get("project_id")
        firebase_admin.initialize_app(credentials.Certificate(service_account), {"projectId": project_id})

    return firestore.client()


db = _init_firestore()
app = FastAPI(title="Smart Incubation AI", version="1.0.0")
whatsapp_conversations = WhatsAppConversationStore()
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-WhatsApp-Router-Secret"],
    expose_headers=["Content-Disposition", "X-Document-SHA256", "X-Document-Signature", "X-Document-Signature-Algorithm"],
)


def _whatsapp_error(code: str, reply: str, status_code: int) -> JSONResponse:
    payload = WhatsAppChatResponse(
        ok=False,
        reply=reply,
        intent=None,
        confidence=None,
        action=None,
        conversation=WhatsAppConversation(),
        error=WhatsAppError(code=code),
    )
    return JSONResponse(status_code=status_code, content=payload.model_dump())


@app.exception_handler(RequestValidationError)
async def request_validation_error(request: Request, error: RequestValidationError):
    if request.url.path == "/api/chat":
        return _whatsapp_error(
            "INVALID_REQUEST",
            "Please provide a valid channel, userId, and message.",
            422,
        )
    return await request_validation_exception_handler(request, error)


class AgentAction(BaseModel):
    key: str
    label: str
    description: str | None = None
    requiresConfirmation: bool | None = None


class PageContext(BaseModel):
    pageKey: str
    pageName: str
    purpose: str
    viewer: dict[str, Any] | None = None
    currentFilters: dict[str, Any] | None = None
    metrics: dict[str, Any] | None = None
    dataSummary: dict[str, Any] | None = None
    allowedActions: list[AgentAction] | None = None
    updatedAt: str | None = None


class ChatTurn(BaseModel):
    role: str
    content: str


class AgentRequest(BaseModel):
    message: str = Field(default="", max_length=4000)
    page: PageContext
    history: list[ChatTurn] = Field(default_factory=list)


class IntakeAnalyzeRequest(BaseModel):
    intakeId: str | None = Field(default=None, max_length=200)
    intake: dict[str, Any] | None = None
    companyCode: str | None = Field(default=None, max_length=100)
    programId: str | None = Field(default=None, max_length=200)


class RoadmapGenerateRequest(BaseModel):
    intakeId: str | None = Field(default=None, max_length=200)
    intake: dict[str, Any] | None = None
    participant: dict[str, Any] | None = None
    decision: dict[str, Any] | None = None
    language: str = Field(default="en", max_length=20)


class RoadmapAgentsRequest(BaseModel):
    intakeId: str | None = Field(default=None, max_length=200)
    roadmap: list[dict[str, Any]] = Field(default_factory=list)
    decision: dict[str, Any] | None = None
    participant: dict[str, Any] | None = None
    language: str = Field(default="en", max_length=20)


class RoadmapAgentChatRequest(BaseModel):
    agent: dict[str, Any] = Field(default_factory=dict)
    roadmapItem: dict[str, Any] | None = None
    participant: dict[str, Any] | None = None
    documents: list[dict[str, Any]] = Field(default_factory=list)
    documentStatus: list[dict[str, Any]] = Field(default_factory=list)
    message: str = Field(default="", max_length=3000)
    history: list[ChatTurn] = Field(default_factory=list)
    language: str = Field(default="en", max_length=20)


class ComplianceScanRequest(BaseModel):
    participantId: str | None = Field(default=None, max_length=200)
    programId: str | None = Field(default=None, max_length=200)
    updateDatabase: bool = True


class ReportInsightRequest(BaseModel):
    reportTitle: str = Field(default="Operations Report", max_length=160)
    periodLabel: str = Field(default="", max_length=160)
    companyName: str | None = Field(default=None, max_length=160)
    audience: str = Field(default="operations leadership", max_length=120)
    metrics: dict[str, Any] = Field(default_factory=dict)
    demandCoverage: list[dict[str, Any]] = Field(default_factory=list)
    attentionItems: list[dict[str, Any]] = Field(default_factory=list)
    attendance: dict[str, Any] = Field(default_factory=dict)
    compliance: dict[str, Any] = Field(default_factory=dict)


class InterventionMonitoringInsightRequest(BaseModel):
    companyName: str | None = Field(default=None, max_length=160)
    filters: dict[str, Any] = Field(default_factory=dict)
    metrics: dict[str, Any] = Field(default_factory=dict)
    statusBreakdown: list[dict[str, Any]] = Field(default_factory=list)
    holdUps: list[dict[str, Any]] = Field(default_factory=list)
    progressBuckets: list[dict[str, Any]] = Field(default_factory=list)
    overdue: list[dict[str, Any]] = Field(default_factory=list)
    groupedRisks: list[dict[str, Any]] = Field(default_factory=list)
    sampleAssignments: list[dict[str, Any]] = Field(default_factory=list)

class ApplicantConversationTurn(BaseModel):
    role: str = Field(default="", max_length=40)
    content: str = Field(default="", max_length=2000)
    field: str | None = Field(default=None, max_length=120)


class ApplicantDumpRequest(BaseModel):
    rawDump: str = Field(default="", max_length=8000)
    currentValues: dict[str, Any] = Field(default_factory=dict)
    missingFields: list[str] = Field(default_factory=list)
    conversationHistory: list[ApplicantConversationTurn] = Field(default_factory=list)
    language: str = Field(default="mixed", max_length=80)

class ApplicationGuidedConversationTurn(BaseModel):
    role: str = Field(default='', max_length=40)
    content: str = Field(default='', max_length=3000)
    field: str | None = Field(default=None, max_length=160)


class ApplicationGuidedProgramQuestion(BaseModel):
    id: str
    label: str
    type: str | None = 'text'
    options: list[str] | str | None = None
    required: bool | None = True


class ApplicationGuidedDocumentRequirement(BaseModel):
    requirementId: str
    type: str
    description: str | None = None
    isRequired: bool = True
    requiresExpiry: bool = False
    allowedFormats: list[str] = Field(default_factory=lambda: ['pdf', 'jpg', 'jpeg', 'png'])
    maxSizeMB: int | float = 10
    hasFile: bool = False
    expiryDate: str | None = None


class ApplicationGuidedRequest(BaseModel):
    rawMessage: str = Field(default='', max_length=8000)
    currentValues: dict[str, Any] = Field(default_factory=dict)
    programId: str | None = Field(default=None, max_length=200)
    programName: str | None = Field(default=None, max_length=200)
    uiLanguage: str = Field(default='en', max_length=20)
    languageInstruction: str | None = Field(default=None, max_length=700)
    flowRules: dict[str, Any] = Field(default_factory=dict)
    programQuestions: list[ApplicationGuidedProgramQuestion] = Field(default_factory=list)
    documentRequirements: list[ApplicationGuidedDocumentRequirement] = Field(default_factory=list)
    complianceScore: int | float = 0
    conversationHistory: list[ApplicationGuidedConversationTurn] = Field(default_factory=list)


DEFAULT_COMPLIANCE_DOCUMENT_TYPES = [
    "CIPC registration",
    "Tax clearance",
    "B-BBEE certificate",
    "Bank confirmation",
    "Proof of address",
    "ID document",
]


_require_auth = create_request_authenticator(db, AGENT_SHARED_SECRET)


def _json_safe(value: Any) -> Any:
    if hasattr(value, "isoformat"):
        return value.isoformat()
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat()
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    return value


def _is_sensitive_key(key: str) -> bool:
    normalized = re.sub(r"[^a-z0-9]", "", key.lower())
    return any(part in normalized for part in SENSITIVE_FIELD_PARTS)


def _compact_document(doc: firestore.DocumentSnapshot) -> dict[str, Any]:
    data = doc.to_dict() or {}
    compact = {
        key: _json_safe(value)
        for key, value in data.items()
        if not _is_sensitive_key(key)
    }
    return compact


def _collection_snapshot(name: str, limit_count: int = MAX_DOCS_PER_COLLECTION) -> list[dict[str, Any]]:
    docs = db.collection(name).limit(limit_count).stream()
    return [_compact_document(doc) for doc in docs]


def _page_collections(page_key: str) -> list[str]:
    mapping = {
        "landing": ["programs", "participants", "applications"],
        "dashboard": ["users", "participants", "programs", "applications", "smeIntakeSubmissions"],
        "applicant": ["programs", "participants", "applications"],
        "application-tracker": ["applications", "programs"],
        "sme-intake": ["smeIntakeSubmissions", "smeIntakeAnalyses"],
        "profile": ["participants", "applications", "users"],
    }
    return mapping.get(page_key, ["programs", "participants", "applications", "smeIntakeSubmissions"])


def _firestore_context_for_page(page: PageContext) -> dict[str, Any]:
    collections: dict[str, Any] = {}

    for collection_name in _page_collections(page.pageKey):
        try:
            collections[collection_name] = _collection_snapshot(collection_name)
        except Exception as exc:
            collections[collection_name] = {"error": str(exc)}

    return collections


def _public_page_context(page: PageContext) -> dict[str, Any]:
    context = page.model_dump()
    viewer = context.get("viewer") or {}

    if viewer:
        context["viewer"] = {
            "name": viewer.get("name"),
            "role": viewer.get("role"),
            "companyCode": viewer.get("companyCode"),
        }

    return context


def _resolve_followup_message(message: str, history: list[ChatTurn], page: PageContext) -> str:
    normalized = message.strip().lower()

    if normalized not in {"yes", "yeah", "yep", "please", "sure", "ok", "okay"}:
        return message

    last_agent = next((turn.content.lower() for turn in reversed(history) if turn.role == "agent"), "")

    if "explain" in last_agent:
        return f"Yes. Continue by explaining {page.pageName} clearly."
    if "summar" in last_agent or "read" in last_agent:
        return f"Yes. Continue with the summary for {page.pageName}."
    if "next" in last_agent:
        return f"Yes. Continue with the next steps for {page.pageName}."

    return f"Yes. Continue the previous response for {page.pageName}."


def _extract_json_object(text: str) -> dict[str, Any] | None:
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL)
    candidate = fenced.group(1) if fenced else text
    start = candidate.find("{")
    end = candidate.rfind("}")

    if start == -1 or end == -1 or end <= start:
        return None

    try:
        return json.loads(candidate[start : end + 1])
    except json.JSONDecodeError:
        return None


def _number_metric(metrics: dict[str, Any], key: str) -> int | float:
    value = metrics.get(key)
    if isinstance(value, (int, float)):
        return value
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0


def _fallback_report_insights(payload: ReportInsightRequest) -> dict[str, Any]:
    metrics = payload.metrics or {}
    submitted = _number_metric(metrics, "submitted")
    accepted = _number_metric(metrics, "accepted")
    acceptance_rate = _number_metric(metrics, "acceptanceRate")
    participants = _number_metric(metrics, "participants")
    assigned = _number_metric(metrics, "assigned")
    completed = _number_metric(metrics, "completed")
    completion_rate = _number_metric(metrics, "completionRate")
    overdue = _number_metric(metrics, "overdue")
    compliance_risk = _number_metric(metrics, "complianceRisk")
    appointments = _number_metric(metrics, "appointments")
    attendance_rate = _number_metric(metrics, "attendanceRate")

    executive_summary = (
        f"This operations report covers {payload.periodLabel or 'the selected period'}. "
        f"Application intake recorded {submitted:g} submissions and {accepted:g} acceptances, "
        f"giving an acceptance rate of {acceptance_rate:g}%. The active participant base for the "
        f"scope is {participants:g}. Intervention delivery recorded {assigned:g} assigned items and "
        f"{completed:g} completions, with a completion rate of {completion_rate:g}%. "
        f"There are {overdue:g} overdue delivery items and {compliance_risk:g} compliance items needing "
        f"follow-up. Appointment activity includes {appointments:g} scheduled meetings, with an attendance "
        f"rate of {attendance_rate:g}% where attendance was captured."
    )

    return {
        "executiveSummary": executive_summary,
        "operationalHighlights": [
            f"{accepted:g} of {submitted:g} submitted applications were accepted.",
            f"{completed:g} of {assigned:g} assigned interventions were completed.",
            f"Attendance rate is {attendance_rate:g}% for captured appointment outcomes.",
        ],
        "risks": [
            f"{overdue:g} overdue intervention items require follow-up.",
            f"{compliance_risk:g} compliance items require review or remediation.",
        ],
        "attendanceSummary": (
            f"{appointments:g} appointments were scheduled in the period. Attendance was captured at "
            f"{attendance_rate:g}% for present/absent outcomes, with uncaptured appointments requiring "
            "administrative follow-up."
        ),
        "actionPlan": [
            {
                "action": "Follow up overdue intervention delivery items",
                "owner": "Operations",
                "priority": "High" if overdue else "Medium",
                "due": "Next reporting cycle",
                "successMeasure": "All overdue items have an owner and next action recorded",
            },
            {
                "action": "Resolve compliance exceptions",
                "owner": "Compliance",
                "priority": "High" if compliance_risk else "Medium",
                "due": "Next reporting cycle",
                "successMeasure": "Compliance exceptions are reduced or formally queried",
            },
            {
                "action": "Capture outstanding attendance outcomes",
                "owner": "Operations",
                "priority": "Medium",
                "due": "Next reporting cycle",
                "successMeasure": "All period appointments have attendance recorded",
            },
        ],
        "templateFields": {},
    }


def _clean_key(value: Any) -> str:
    return re.sub(r"(^-+|-+$)", "", re.sub(r"[^a-z0-9]+", "-", str(value or "").strip().lower()))


def _date_value(value: Any) -> date | None:
    if not value:
        return None
    if hasattr(value, "date"):
        return value.date()
    if isinstance(value, str):
        try:
            return date.fromisoformat(value[:10])
        except ValueError:
            return None
    return None


def _document_status(document: dict[str, Any]) -> str:
    expiry = _date_value(document.get("expiryDate") or (document.get("currentFile") or {}).get("expiryDate"))
    if expiry and expiry < date.today():
        return "expired"
    return str(document.get("currentStatus") or document.get("verificationStatus") or "pending").strip().lower()


def _required_docs_for_program(program_id: str | None) -> list[dict[str, Any]]:
    if not program_id:
        return [
            {"key": _clean_key(title), "title": title, "type": "upload", "hasExpiry": False}
            for title in DEFAULT_COMPLIANCE_DOCUMENT_TYPES
        ]

    required: list[dict[str, Any]] = []

    try:
        dept_requirements = db.collection("programs").document(program_id).collection("deptRequirements").stream()
        for doc in dept_requirements:
            data = doc.to_dict() or {}
            for item in data.get("requiredDocuments") or []:
                if item.get("type") and item.get("type") != "upload":
                    continue
                title = item.get("title") or item.get("key") or item.get("presetId")
                key = _clean_key(item.get("key") or item.get("presetId") or title)
                if key:
                    required.append({"key": key, "title": title or key, "type": "upload", "hasExpiry": bool(item.get("hasExpiry") or item.get("expiryRule"))})
    except Exception:
        required = []

    if required:
        return required

    try:
        program_snap = db.collection("programs").document(program_id).get()
        program_data = program_snap.to_dict() or {}
        for item in program_data.get("complianceRequirements") or []:
            title = item.get("name")
            key = _clean_key(item.get("id") or title)
            if key:
                required.append({"key": key, "title": title or key, "type": "upload", "hasExpiry": bool(item.get("hasExpiry") or item.get("expiryRule"))})
    except Exception:
        required = []

    if required:
        return required

    try:
        docs = db.collection("programs").document(program_id).collection("requiredDocs").stream()
        for doc in docs:
            data = doc.to_dict() or {}
            if data.get("type") and data.get("type") != "upload":
                continue
            title = data.get("title") or doc.id
            key = _clean_key(data.get("key") or data.get("presetId") or doc.id)
            if key:
                required.append({"key": key, "title": title, "type": "upload", "hasExpiry": bool(data.get("hasExpiry") or data.get("expiryRule"))})
    except Exception:
        required = []

    return required or [
        {"key": _clean_key(title), "title": title, "type": "upload", "hasExpiry": False}
        for title in DEFAULT_COMPLIANCE_DOCUMENT_TYPES
    ]


def _participant_rows(participant_id: str | None, program_id: str | None) -> list[dict[str, Any]]:
    query = db.collection("participants")
    docs = query.stream()
    rows = []

    for snap in docs:
        data = snap.to_dict() or {}
        row_participant_id = str(data.get("participantId") or data.get("uid") or snap.id)
        row_program_id = data.get("programId")
        if participant_id and participant_id not in {snap.id, row_participant_id}:
            continue
        if program_id and row_program_id != program_id:
            continue
        rows.append({"id": snap.id, "participantId": row_participant_id, **_json_safe(data)})

    return rows


def _compliance_documents_for(participant_id: str, program_id: str | None) -> list[dict[str, Any]]:
    query = db.collection("complianceDocuments").where("participantId", "==", participant_id)
    if program_id:
        query = query.where("programId", "==", program_id)
    return [{"id": snap.id, **_json_safe(snap.to_dict() or {})} for snap in query.stream()]


def _scan_participant_compliance(participant: dict[str, Any]) -> dict[str, Any]:
    participant_id = str(participant.get("participantId") or participant.get("id"))
    program_id = participant.get("programId")
    required_docs = _required_docs_for_program(program_id)
    documents = _compliance_documents_for(participant_id, program_id)
    by_key: dict[str, dict[str, Any]] = {}

    for document in documents:
        key = _clean_key(document.get("key") or document.get("type"))
        if not key:
            continue
        existing = by_key.get(key)
        if not existing or (_document_status(existing) != "valid" and _document_status(document) == "valid"):
            by_key[key] = document

    compliance_documents = []
    for requirement in required_docs:
        document = by_key.get(requirement["key"])
        status = _document_status(document) if document else "missing"
        compliance_documents.append(
            {
                "key": requirement["key"],
                "type": requirement["title"],
                "requiredType": requirement.get("type") or "upload",
                "status": status,
                "fileName": (document or {}).get("fileName") or ((document or {}).get("currentFile") or {}).get("fileName"),
                "url": (document or {}).get("url") or ((document or {}).get("currentFile") or {}).get("url"),
                "expiryDate": (document or {}).get("expiryDate") or ((document or {}).get("currentFile") or {}).get("expiryDate"),
            }
        )

    required = [item["key"] for item in required_docs]
    completed = [item["key"] for item in compliance_documents if item["status"] == "valid"]
    missing = [item["key"] for item in compliance_documents if item["status"] == "missing"]
    pending = [item["key"] for item in compliance_documents if item["status"] in {"pending", "uploaded", "queried"}]
    problem = [item["key"] for item in compliance_documents if item["status"] in {"missing", "expired", "invalid", "rejected"}]
    score = round((len(completed) / len(required)) * 100) if required else 0

    return {
        "participantId": participant_id,
        "participantDocId": participant.get("id"),
        "businessName": participant.get("businessName") or participant.get("participantName") or "Unnamed participant",
        "programId": program_id,
        "summary": {
            "required": required,
            "completed": completed,
            "missing": missing,
            "pending": pending,
            "problem": problem,
            "score": score,
            "totalRequired": len(required),
            "totalCompleted": len(completed),
            "totalMissing": len(missing),
            "totalPending": len(pending),
            "totalProblem": len(problem),
            "source": "ai-backend-compliance-scan",
            "scannedAt": datetime.now(timezone.utc).isoformat(),
        },
        "documents": compliance_documents,
    }


def _persist_compliance_scan(scan: dict[str, Any]) -> None:
    payload = {
        "compliance": {
            "summary": {**scan["summary"], "updatedAt": firestore.SERVER_TIMESTAMP},
            "documents": scan["documents"],
        }
    }
    participant_doc_id = scan.get("participantDocId")
    if participant_doc_id:
        db.collection("participants").document(participant_doc_id).set(payload, merge=True)

    app_query = db.collection("applications").where("participantId", "==", scan["participantId"])
    if scan.get("programId"):
        app_query = app_query.where("programId", "==", scan.get("programId"))
    app_query = app_query.limit(1)
    for app_snap in app_query.stream():
        app_snap.reference.set(payload, merge=True)


def _call_gemini(
    system_prompt: str,
    user_payload: dict[str, Any],
    max_output_tokens: int = 1200,
    response_mime_type: str | None = None,
) -> str:
    if not GEMINI_API_KEY:
        raise HTTPException(status_code=500, detail="GEMINI_API_KEY is not configured")

    url = (
        f"https://generativelanguage.googleapis.com/v1beta/models/"
        f"{GEMINI_MODEL}:generateContent?key={GEMINI_API_KEY}"
    )

    generation_config: dict[str, Any] = {
        "temperature": 0.25,
        "maxOutputTokens": max_output_tokens,
    }

    if response_mime_type:
        generation_config["responseMimeType"] = response_mime_type

    payload = {
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": [
            {
                "role": "user",
                "parts": [{"text": json.dumps(user_payload, default=str)}],
            }
        ],
        "generationConfig": generation_config,
    }

    last_error = ""

    for attempt in range(3):
        request = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(request, timeout=35) as response:
                result = json.loads(response.read().decode("utf-8"))

            candidates = result.get("candidates") or []
            parts = (candidates[0].get("content", {}).get("parts") if candidates else []) or []
            text = "\n".join(part.get("text", "") for part in parts).strip()

            if not text:
                raise HTTPException(status_code=502, detail="Gemini returned an empty response")

            return text

        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="ignore")
            last_error = detail

            if exc.code in {429, 500, 503} and attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue

            if exc.code == 503:
                raise HTTPException(
                    status_code=503,
                    detail="The AI model is temporarily busy. Please try again in a moment.",
                ) from exc

            if exc.code == 429:
                raise HTTPException(
                    status_code=429,
                    detail="The AI service is receiving too many requests. Please wait a moment and try again.",
                ) from exc

            raise HTTPException(status_code=502, detail=f"Gemini request failed: {detail}") from exc

        except Exception as exc:
            last_error = str(exc)

            if attempt < 2:
                time.sleep(1.5 * (attempt + 1))
                continue

            raise HTTPException(status_code=502, detail=f"Gemini request failed: {exc}") from exc

    raise HTTPException(status_code=502, detail=last_error or "Gemini request failed")

APPLICANT_PROFILE_FIELDS = [
    "participantName",
    "fullName",
    "email",
    "gender",
    "idNumber",
    "phone",
    "alternativePhone",
    "maritalStatus",
    "employmentStatus",
    "educationLevel",
    "disabilityStatus",
    "businessName",
    "sector",
    "natureOfBusiness",
    "beeLevel",
    "youthOwnedPercent",
    "femaleOwnedPercent",
    "blackOwnedPercent",
    "registrationStatus",
    "registrationNumber",
    "dateOfRegistration",
    "yearsOfTrading",
    "businessAddress",
    "city",
    "postalCode",
    "province",
    "hostCommunity",
    "locationType",
]

APPLICANT_REQUIRED_FIELDS = [
    "participantName",
    "email",
    "phone",
    "gender",
    "businessName",
    "sector",
    "natureOfBusiness",
    "yearsOfTrading",
    "businessAddress",
    "city",
    "province",
]


def _clean_applicant_field_value(value: Any) -> Any:
    if value is None:
        return None

    if isinstance(value, str):
        cleaned = value.strip()
        return cleaned if cleaned else None

    if isinstance(value, (int, float, bool)):
        return value

    return value


def _normalize_applicant_ai_response(
    ai_result: dict[str, Any],
    payload: ApplicantDumpRequest,
) -> dict[str, Any]:
    raw_fields = ai_result.get("flatFields")
    if not isinstance(raw_fields, dict):
        raw_fields = {}

    flat_fields: dict[str, Any] = {}

    for key in APPLICANT_PROFILE_FIELDS:
        value = _clean_applicant_field_value(raw_fields.get(key))
        if value is not None:
            flat_fields[key] = value

    if flat_fields.get("fullName") and not flat_fields.get("participantName"):
        flat_fields["participantName"] = flat_fields["fullName"]

    if flat_fields.get("participantName") and not flat_fields.get("fullName"):
        flat_fields["fullName"] = flat_fields["participantName"]

    merged_values = {
        **(payload.currentValues or {}),
        **flat_fields,
    }

    missing_fields = [
        field
        for field in APPLICATION_REQUIRED_FIELDS
        if field not in APPLICATION_PROFILE_LOCKED_FIELDS and not _has_value(merged.get(field))
    ]

    ai_missing = ai_result.get("missingFields")
    if isinstance(ai_missing, list):
        for field in ai_missing:
            field_name = str(field).strip()
            if field_name in APPLICANT_PROFILE_FIELDS and field_name not in missing_fields:
                if not _clean_applicant_field_value(merged_values.get(field_name)):
                    missing_fields.append(field_name)

    follow_up_questions = ai_result.get("followUpQuestions")
    if not isinstance(follow_up_questions, list):
        follow_up_questions = []

    normalized_questions = []
    existing_question_fields = set()

    for item in follow_up_questions:
        if not isinstance(item, dict):
            continue

        field = str(item.get("field") or "").strip()
        question = str(item.get("question") or "").strip()

        if field in missing_fields and question:
            normalized_questions.append({"field": field, "question": question})
            existing_question_fields.add(field)

    for field in missing_fields:
        if field in existing_question_fields:
            continue

        normalized_questions.append(
            {
                "field": field,
                "question": f"Please provide the {field.replace('_', ' ')}.",
            }
        )

    confidence = ai_result.get("confidence")
    if not isinstance(confidence, (int, float)):
        confidence = 0.7 if flat_fields else 0.25

    return {
        "ok": True,
        "transcript": payload.rawDump,
        "detectedLanguages": ai_result.get("detectedLanguages") if isinstance(ai_result.get("detectedLanguages"), list) else [],
        "languageMixSummary": str(ai_result.get("languageMixSummary") or ""),
        "flatFields": flat_fields,
        "missingFields": missing_fields,
        "followUpQuestions": normalized_questions[:6],
        "assistantMessage": str(
            ai_result.get("assistantMessage")
            or (
                "I mapped the details I could find. Please review the form before saving."
                if flat_fields
                else "I could not confidently map the profile. Please add more applicant and business detail."
            )
        ),
        "confidence": confidence,
        "model": GEMINI_MODEL,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }

APPLICATION_ALLOWED_FIELDS = [
    'participantName', 'email', 'idNumber', 'gender', 'phone', 'beneficiaryName',
    'sector', 'natureOfBusiness', 'registrationNumber', 'dateOfRegistration',
    'yearsOfTrading', 'businessAddress', 'province', 'city', 'hub', 'postalCode',
    'location', 'motivation', 'challenges', 'facebook', 'instagram', 'linkedIn', 'stage'
]

APPLICATION_REQUIRED_FIELDS = [
    'motivation',
    'challenges',
]

APPLICATION_PROFILE_LOCKED_FIELDS = {
    'participantName',
    'email',
    'idNumber',
    'gender',
    'phone',
    'beneficiaryName',
    'businessName',
    'sector',
    'natureOfBusiness',
    'registrationNumber',
    'dateOfRegistration',
    'yearsOfTrading',
    'businessAddress',
    'province',
    'city',
    'hub',
    'postalCode',
    'location',
    'stage',
}


def _has_value(value: Any) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, (int, float, bool)):
        return True
    if isinstance(value, list):
        return bool(value)
    if isinstance(value, dict):
        return bool(value)
    return True


def _normalize_application_guided_response(ai_result: dict[str, Any], payload: ApplicationGuidedRequest) -> dict[str, Any]:
    flat_fields = ai_result.get('flatFields') if isinstance(ai_result.get('flatFields'), dict) else {}
    clean_fields = {key: value for key, value in flat_fields.items() if key in APPLICATION_ALLOWED_FIELDS and _has_value(value)}

    current_values = dict(payload.currentValues or {})
    merged = {**current_values, **clean_fields}

    program_answers = ai_result.get('programAnswers') if isinstance(ai_result.get('programAnswers'), dict) else {}
    existing_profile = current_values.get('profile') if isinstance(current_values.get('profile'), dict) else {}
    merged_profile = {**existing_profile, **program_answers}

    missing_fields = [field for field in APPLICATION_REQUIRED_FIELDS if not _has_value(merged.get(field))]

    for question in payload.programQuestions:
        if question.required is False:
            continue
        if not _has_value(merged_profile.get(question.id)):
            missing_fields.append(f'profile.{question.id}')

    available_interventions = payload.flowRules.get('availableInterventions') if isinstance(payload.flowRules.get('availableInterventions'), list) else []
    selected_intervention_ids = payload.flowRules.get('selectedInterventionIds') if isinstance(payload.flowRules.get('selectedInterventionIds'), list) else []
    needs_intervention_selection = bool(
        payload.flowRules.get('allowSmeInterventionSelection')
        and available_interventions
        and not selected_intervention_ids
    )
    if needs_intervention_selection:
        missing_fields.append('selectedInterventionIds')

    pending_required_docs = []
    for doc in payload.documentRequirements:
        if doc.isRequired and not doc.hasFile:
            pending_required_docs.append(doc)
        elif doc.isRequired and doc.requiresExpiry and doc.hasFile and not doc.expiryDate:
            pending_required_docs.append(doc)

    follow_ups = ai_result.get('followUpQuestions') if isinstance(ai_result.get('followUpQuestions'), list) else []
    normalized_follow_ups = []
    valid_missing = set(missing_fields)

    for item in follow_ups:
        if not isinstance(item, dict):
            continue
        field = str(item.get('field') or '').strip()
        question = str(item.get('question') or '').strip()
        input_type = str(item.get('inputType') or 'textarea').strip()
        if field in valid_missing and field not in APPLICATION_PROFILE_LOCKED_FIELDS and question:
            normalized_follow_ups.append({
                'field': field,
                'question': question,
                'inputType': input_type if input_type in {'text', 'textarea', 'select', 'date', 'upload', 'confirm'} else 'textarea',
                'options': item.get('options') if isinstance(item.get('options'), list) else None,
                'documentRequirementId': item.get('documentRequirementId'),
            })

    if needs_intervention_selection and not any(item.get('field') == 'selectedInterventionIds' for item in normalized_follow_ups):
        normalized_follow_ups.append({
            'field': 'selectedInterventionIds',
            'question': 'Which support interventions would help your business most? You can choose more than one.',
            'inputType': 'select',
            'options': [str(item.get('title')) for item in available_interventions if isinstance(item, dict) and item.get('title')],
            'documentRequirementId': None,
        })

    document_prompt = None
    if pending_required_docs:
        doc = pending_required_docs[0]
        if not doc.hasFile:
            question = f'Please upload your {doc.type}.'
        elif doc.requiresExpiry and not doc.expiryDate:
            question = f'What is the expiry date for your {doc.type}?'
        else:
            question = f'Please confirm your {doc.type}.'

        ai_doc_prompt = ai_result.get('documentPrompt') if isinstance(ai_result.get('documentPrompt'), dict) else {}
        document_prompt = {
            'requirementId': doc.requirementId,
            'type': doc.type,
            'description': doc.description,
            'requiresExpiry': doc.requiresExpiry,
            'allowedFormats': doc.allowedFormats,
            'maxSizeMB': doc.maxSizeMB,
            'question': str(ai_doc_prompt.get('question') or question),
        }

    assistant_message = str(ai_result.get('assistantMessage') or '').strip()
    if not assistant_message:
        if normalized_follow_ups:
            assistant_message = normalized_follow_ups[0]['question']
        elif document_prompt:
            assistant_message = document_prompt['question']
        else:
            assistant_message = 'Great, I have what I need for now. Please review the application before submitting.'

    return {
        'ok': True,
        'assistantMessage': assistant_message,
        'flatFields': clean_fields,
        'programAnswers': program_answers,
        'missingFields': missing_fields,
        'followUpQuestions': normalized_follow_ups[:4],
        'documentPrompt': document_prompt,
        'completedSections': ai_result.get('completedSections') if isinstance(ai_result.get('completedSections'), list) else [],
        'confidence': ai_result.get('confidence') if isinstance(ai_result.get('confidence'), (int, float)) else 0.7,
        'model': GEMINI_MODEL,
        'generatedAt': datetime.now(timezone.utc).isoformat(),
    }

@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "smart-incubation-ai",
        "geminiModel": GEMINI_MODEL,
        "firestore": True,
    }


@app.post("/api/chat", response_model=WhatsAppChatResponse)
def channel_chat(payload: WhatsAppChatRequest, request: Request):
    """Interpret a trusted router's WhatsApp message; never execute business actions."""
    configured_secret = os.getenv("WHATSAPP_ROUTER_SECRET", "").strip()
    supplied_secret = request.headers.get("x-whatsapp-router-secret", "").strip()
    if not configured_secret:
        return _whatsapp_error(
            "SERVICE_NOT_CONFIGURED",
            "I couldn't process that message right now.",
            503,
        )
    if not GEMINI_API_KEY:
        return _whatsapp_error(
            "SERVICE_NOT_CONFIGURED",
            "I couldn't process that message right now.",
            503,
        )
    if not supplied_secret or not hmac.compare_digest(supplied_secret, configured_secret):
        return _whatsapp_error(
            "UNAUTHORIZED",
            "I couldn't process that message right now.",
            401,
        )

    try:
        return interpret_whatsapp_message(payload, whatsapp_conversations, _call_gemini)
    except Exception as error:
        print(
            "WhatsApp message interpretation failed:",
            type(error).__name__,
            str(error),
            flush=True,
        )
        return _whatsapp_error(
            "PROCESSING_ERROR",
            "I couldn't process that message right now.",
            500,
        )


@app.post("/api/agent")
async def page_agent(payload: AgentRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    _require_auth(authorization)

    firestore_context = _firestore_context_for_page(payload.page)
    actions = [action.model_dump() for action in payload.page.allowedActions or []]
    user_message = _resolve_followup_message(payload.message, payload.history, payload.page)
    system_prompt = (
        "Your name is Q. You are the Smart Incubation assistant. Greet the viewer by first name when it feels "
        "natural, especially at the start of a conversation. Answer as a concise, warm operational assistant. "
        "Use the page context, recent conversation, and sanitized Firestore snapshots to explain what is "
        "happening and suggest useful next steps. Do not expose implementation details, collection names, raw "
        "record fields, internal action keys, secrets, service-account details, user IDs, emails, phone numbers, "
        "or document IDs. If a user says yes, sure, ok, or similar, continue the previous assistant offer instead "
        "of treating it as a new request. Mention user-facing action labels only when helpful."
    )
    reply = _call_gemini(
        system_prompt,
        {
            "userMessage": user_message,
            "viewerName": (payload.page.viewer or {}).get("name") if payload.page.viewer else None,
            "botName": "Q",
            "page": _public_page_context(payload.page),
            "availableUserActions": [
                {"label": action.get("label"), "description": action.get("description")}
                for action in actions
            ],
            "recentConversation": [turn.model_dump() for turn in payload.history[-8:]],
            "firestore": firestore_context,
        },
    )

    action_key = None
    lowered = payload.message.lower()
    for action in actions:
        if action["key"].replace("_", " ") in lowered or action["label"].lower() in lowered:
            action_key = action["key"]
            break

    return {"reply": reply, "actionKey": action_key}

@app.post('/api/applications/guided-dump')
async def guided_application_dump(payload: ApplicationGuidedRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
    _require_auth(authorization)

    if not payload.rawMessage.strip() and not payload.conversationHistory:
        raise HTTPException(status_code=400, detail='Provide application information to process')

    system_prompt = (
        'You are a warm SME incubation application assistant. Extract structured application data and guide the SME one question at a time. '
        'The SME may use English or mixed South African languages such as isiZulu, Sepedi/Northern Sotho, Setswana, Tshivenda, or English. '
        'Return valid JSON only. Do not wrap in Markdown. '
        'Use these exact keys: ok, assistantMessage, flatFields, programAnswers, missingFields, followUpQuestions, documentPrompt, completedSections, confidence. '
        f'flatFields may only contain these keys: {", ".join(APPLICATION_ALLOWED_FIELDS)}. '
        'programAnswers must be a map keyed by the supplied programQuestions ids. '
        "Use uiLanguage as the default response language. "
        "If uiLanguage is 'en', respond in English. "
        "Only switch away from English if the user's latest rawMessage is clearly written mostly in another language. "
        "Do not use isiZulu just because isiZulu is supported. "
        "Only use isiZulu if uiLanguage is 'zu' or the user's latest message is mostly isiZulu. "
        "If the user mixes languages, mirror that mix naturally. "
        "Applicant profile and business profile fields are already completed before the SME reaches this page. "
        "Never ask for participantName, email, gender, phone, beneficiaryName, businessName, sector, natureOfBusiness, registrationNumber, yearsOfTrading, businessAddress, city, province, postalCode, hub, location, or stage. "
        "Do not return those fields in followUpQuestions. "
        "Only use those fields as background context from currentValues. "
        "Focus only on application motivation, challenges, programme-specific questions, required documents, expiry dates, and allowed intervention choices. "
        "Respect flowRules strictly. "
        "If flowRules.hasProgramQuestions is false, do not ask programme profile questions. "
        "If flowRules.hasDocuments is false, do not ask for document uploads. "
        "If flowRules.isForcedInterventionProgram is true, do not ask the SME to select interventions or support areas. "
        "When interventions are forced, explain briefly that the programme already includes the required support interventions. "
        "If flowRules.allowSmeInterventionSelection is false, never generate intervention selection follow-up questions. "
        "If flowRules.allowSmeInterventionSelection is true and flowRules.selectedInterventionIds is empty, ask the SME to choose one or more items from flowRules.availableInterventions. Use field selectedInterventionIds, inputType select, and use only the supplied intervention titles as options. "
        'Respect currentValues as confirmed data. Do not ask for fields that already have usable values. '
        'Ask one practical next question at a time. Motivation questions must be phrased naturally in a way the SME understands, not as a form label. '
        'assistantMessage and followUpQuestions[].question must sound conversational and may naturally mix the same languages as the user. '
        'For documents, never invent requirements. Use only documentRequirements. If a required document is missing, set documentPrompt for the next document. '
        'If a document has requiresExpiry true and hasFile true but no expiryDate, ask for the expiry date. '
        'followUpQuestions items must have field, question, inputType, and optional options. inputType must be text, textarea, select, date, upload, or confirm. '
        'Do not put raw JSON inside assistantMessage. Do not invent exact values. If unclear, leave the field out and ask a follow-up question.'
    )

    text = _call_gemini(
        system_prompt,
        {
            'rawMessage': payload.rawMessage,
            'currentValues': payload.currentValues,
            'programId': payload.programId,
            'programName': payload.programName,
            'uiLanguage': payload.uiLanguage,
            'languageInstruction': payload.languageInstruction,
            'flowRules': payload.flowRules,
            'programQuestions': [item.model_dump() for item in payload.programQuestions],
            'documentRequirements': [item.model_dump() for item in payload.documentRequirements],
            'complianceScore': payload.complianceScore,
            'conversationHistory': [turn.model_dump() for turn in payload.conversationHistory[-12:]],
            'requiredFields': APPLICATION_REQUIRED_FIELDS,
            'allowedFields': APPLICATION_ALLOWED_FIELDS,
            'lockedProfileFields': list(APPLICATION_PROFILE_LOCKED_FIELDS),
        },
        max_output_tokens=2600,
        response_mime_type='application/json',
    )

    ai_result = _extract_json_object(text) or {
        'ok': True,
        'assistantMessage': text,
        'flatFields': {},
        'programAnswers': {},
        'missingFields': APPLICATION_REQUIRED_FIELDS,
        'followUpQuestions': [],
        'documentPrompt': None,
        'completedSections': [],
        'confidence': 0.25,
    }

    return _normalize_application_guided_response(ai_result, payload)


@app.post("/applicant/dump")
@app.post("/api/applicant/dump")
async def map_applicant_dump(
    payload: ApplicantDumpRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    _require_auth(authorization)

    if not payload.rawDump.strip() and not payload.conversationHistory:
        raise HTTPException(status_code=400, detail="Provide applicant information to map")

    system_prompt = (
        "You extract structured applicant profile data for an SME incubation platform. "
        "The user may write in English or mixed South African languages such as isiZulu, "
        "Sepedi/Northern Sotho, Setswana, Tshivenda, or English. "
        "Respect currentValues as already confirmed user data. Do not ask follow-up questions "
        "for fields that already have usable values in currentValues. "
        "When the user answers a follow-up question, update that field and return only the "
        "remaining missingFields and remaining followUpQuestions. "
        "Return valid JSON only. Do not wrap it in Markdown. "
        "The JSON values for assistantMessage and followUpQuestions[].question must sound natural "
        "and conversational, not robotic. "
        "Use the same language style as the user where practical. If the user mixes languages, "
        "you may also mix the same languages naturally in assistantMessage and follow-up questions. "
        "Keep assistantMessage short, warm, and useful. Do not put raw JSON inside assistantMessage. "
        "Use these exact keys: ok, transcript, detectedLanguages, languageMixSummary, flatFields, "
        "missingFields, followUpQuestions, assistantMessage, confidence. "
        "flatFields must only contain these applicant profile fields: "
        f"{', '.join(APPLICANT_PROFILE_FIELDS)}. "
        "Use participantName for the applicant's full name. If fullName is present, also mirror it "
        "to participantName. "
        "yearsOfTrading, youthOwnedPercent, femaleOwnedPercent, and blackOwnedPercent must be numbers "
        "when possible. "
        "followUpQuestions must be an array of objects with field and question. "
        "Ask only for missing important fields. Do not invent values. "
        "If information is unclear, leave the field out and ask a follow-up question."
    )

    text = _call_gemini(
        system_prompt,
        {
            "rawDump": payload.rawDump,
            "currentValues": payload.currentValues,
            "missingFields": payload.missingFields,
            "conversationHistory": [turn.model_dump() for turn in payload.conversationHistory[-12:]],
            "language": payload.language,
            "requiredFields": APPLICANT_REQUIRED_FIELDS,
            "allowedFields": APPLICANT_PROFILE_FIELDS,
        },
        max_output_tokens=2200,
        response_mime_type="application/json",
    )

    ai_result = _extract_json_object(text) or {
        "ok": True,
        "transcript": payload.rawDump,
        "flatFields": {},
        "missingFields": APPLICANT_REQUIRED_FIELDS,
        "followUpQuestions": [],
        "assistantMessage": text,
        "confidence": 0.25,
    }

    return _normalize_applicant_ai_response(ai_result, payload)

@app.post("/api/intake/analyze")
async def analyze_intake(
    payload: IntakeAnalyzeRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    _require_auth(authorization)

    intake = payload.intake
    intake_ref = None

    if payload.intakeId:
        intake_ref = db.collection("smeIntakeSubmissions").document(payload.intakeId)
        snap = intake_ref.get()
        if not snap.exists:
            raise HTTPException(status_code=404, detail="Intake submission not found")
        intake = {"id": snap.id, **_json_safe(snap.to_dict() or {})}

    if not intake:
        raise HTTPException(status_code=400, detail="Provide intakeId or intake")

    catalogue = _catalogue_for_intake(intake, payload.companyCode, payload.programId)
    catalogue_brief = [
        {
            "title": item.get("title"),
            "areaOfSupport": item.get("areaOfSupport"),
            "scopeType": item.get("scopeType"),
            "agentSupportMode": item.get("agentSupportMode"),
        }
        for item in catalogue[:80]
    ]

    system_prompt = (
        "You analyze South African SME incubation intake submissions. Return only JSON with these keys: "
        "summary, readinessScore, strengths, risks, missingInformation, recommendedActions, supportFit, decision. "
        "decision.recommendedInterventions must only use intervention titles and areaOfSupport values from the supplied catalogue. "
        "If the SME need does not match the catalogue, put it in decision.unmatchedNeeds and set decision.supportFitStatus to await_review. "
        "readinessScore must be a number from 0 to 100. Each list should contain short, practical items."
    )
    text = _call_gemini(system_prompt, {"intake": intake, "availableCatalogue": catalogue_brief})
    analysis = _extract_json_object(text) or {
        "summary": text,
        "readinessScore": None,
        "strengths": [],
        "risks": [],
        "missingInformation": [],
        "recommendedActions": [],
        "supportFit": [],
    }
    decision = analysis.get("decision") if isinstance(analysis.get("decision"), dict) else {}
    analysis["decision"] = _constrain_recommendations_to_catalogue(decision, catalogue)

    analysis_payload = {
        "intakeId": payload.intakeId,
        "analysis": analysis,
        "availableInterventionCatalogue": catalogue_brief,
        "supportFitStatus": analysis["decision"].get("supportFitStatus"),
        "unmatchedNeeds": analysis["decision"].get("unmatchedNeeds", []),
        "externalInterventionSuggestions": analysis["decision"].get("externalInterventionSuggestions", []),
        "model": GEMINI_MODEL,
        "createdAt": firestore.SERVER_TIMESTAMP,
    }
    analysis_ref = db.collection("smeIntakeAnalyses").document()
    analysis_ref.set(analysis_payload)

    if intake_ref:
        intake_ref.set(
            {
                "status": "analysis_complete",
                "analysisId": analysis_ref.id,
                "analysisSummary": analysis.get("summary"),
                "readinessScore": analysis.get("readinessScore"),
                "decision": analysis["decision"],
                "supportFitStatus": analysis["decision"].get("supportFitStatus"),
                "unmatchedNeeds": analysis["decision"].get("unmatchedNeeds", []),
                "externalInterventionSuggestions": analysis["decision"].get("externalInterventionSuggestions", []),
                "updatedAt": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )

    return {
        "reply": analysis.get("summary") or "Intake analysis completed.",
        "analysisId": analysis_ref.id,
        "analysis": analysis,
    }


def _category_from_text(value: Any) -> str:
    text = str(value or "").lower()
    if any(part in text for part in ["tax", "compliance", "cipc", "legal", "safety", "certificate"]):
        return "compliance"
    if any(part in text for part in ["finance", "fund", "cash", "account", "record", "bookkeep"]):
        return "finance"
    if any(part in text for part in ["market", "sales", "customer", "brand", "tender", "buyer"]):
        return "market"
    if any(part in text for part in ["operation", "process", "production", "workflow", "stock"]):
        return "operations"
    if any(part in text for part in ["training", "skill", "mentor", "coaching"]):
        return "training"
    return "general"


def _norm_key(value: Any) -> str:
    return re.sub(r"[^a-z0-9]+", " ", str(value or "").lower()).strip()


def _catalogue_for_intake(intake: dict[str, Any] | None, company_code: str | None = None, program_id: str | None = None) -> list[dict[str, Any]]:
    intake = intake or {}
    clean_company = str(company_code or intake.get("companyCode") or "").strip()
    clean_program = str(program_id or intake.get("programId") or intake.get("recommendedProgramId") or "").strip()
    rows: list[dict[str, Any]] = []

    try:
        docs = db.collection("interventions").stream()
        for doc_snap in docs:
            data = doc_snap.to_dict() or {}
            row_company = str(data.get("companyCode") or "").strip()
            scope_type = str(data.get("scopeType") or "company").strip().lower()
            row_program = str(data.get("programId") or "").strip()
            if clean_company and row_company and row_company.upper() != clean_company.upper():
                continue
            if scope_type == "program" and clean_program and row_program != clean_program:
                continue
            if scope_type == "program" and not clean_program:
                continue
            title = str(data.get("interventionTitle") or data.get("title") or data.get("name") or "").strip()
            if not title:
                continue
            area = str(
                data.get("areaOfSupport")
                or data.get("supportArea")
                or data.get("department")
                or data.get("category")
                or "General Support"
            ).strip()
            rows.append(
                {
                    "id": doc_snap.id,
                    "interventionId": doc_snap.id,
                    "title": title,
                    "areaOfSupport": area,
                    "scopeType": scope_type,
                    "programId": row_program or None,
                    "companyCode": row_company or clean_company or None,
                    "agentSupportMode": data.get("agentSupportMode"),
                }
            )
    except Exception:
        return []

    return rows


def _match_catalogue_item(recommendation: dict[str, Any], catalogue: list[dict[str, Any]]) -> dict[str, Any] | None:
    title = _norm_key(recommendation.get("title") or recommendation.get("name"))
    area = _norm_key(recommendation.get("areaOfSupport") or recommendation.get("department") or recommendation.get("area"))
    if not title and not area:
        return None

    best: tuple[int, dict[str, Any]] | None = None
    title_words = set(title.split())
    area_words = set(area.split())
    for item in catalogue:
        item_title = _norm_key(item.get("title"))
        item_area = _norm_key(item.get("areaOfSupport"))
        score = 0
        if title and (title in item_title or item_title in title):
            score += 8
        if area and (area in item_area or item_area in area):
            score += 5
        score += len(title_words.intersection(item_title.split()))
        score += len(area_words.intersection(item_area.split()))
        if score and (best is None or score > best[0]):
            best = (score, item)

    return best[1] if best and best[0] >= 2 else None


def _constrain_recommendations_to_catalogue(decision: dict[str, Any], catalogue: list[dict[str, Any]]) -> dict[str, Any]:
    recommendations = decision.get("recommendedInterventions")
    if not isinstance(recommendations, list):
        decision["supportFitStatus"] = "await_review" if catalogue else "no_catalogue"
        decision["recommendedInterventions"] = []
        return decision

    matched: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in recommendations:
        item = raw if isinstance(raw, dict) else {"title": str(raw)}
        catalogue_item = _match_catalogue_item(item, catalogue)
        if not catalogue_item:
            unmatched.append(item)
            continue
        key = str(catalogue_item.get("id") or catalogue_item.get("title"))
        if key in seen:
            continue
        seen.add(key)
        matched.append(
            {
                **item,
                "title": catalogue_item.get("title"),
                "interventionId": catalogue_item.get("interventionId") or catalogue_item.get("id"),
                "areaOfSupport": catalogue_item.get("areaOfSupport"),
                "department": catalogue_item.get("areaOfSupport"),
                "catalogueMatched": True,
                "agentSupportMode": catalogue_item.get("agentSupportMode"),
            }
        )

    decision["recommendedInterventions"] = matched
    decision["availableInterventionCatalogue"] = catalogue[:50]
    decision["unmatchedNeeds"] = unmatched
    decision["externalInterventionSuggestions"] = [
        {
            "title": str(item.get("title") or item.get("need") or "External support need"),
            "reason": str(item.get("reason") or "No matching company intervention was found in the current catalogue."),
            "status": "await_operations_review",
        }
        for item in unmatched
    ]
    decision["supportFitStatus"] = "matched" if matched and not unmatched else "partial_match" if matched else "await_review"
    if not matched:
        decision["selectedPath"] = "await_review"
        decision["summary"] = (
            f"{decision.get('summary') or 'Intake analysed.'} No matching internal intervention was found; operations should review for an external intervention."
        )
    return decision


def _agent_name_for_category(category: str) -> str:
    return {
        "compliance": "Compliance Navigator",
        "finance": "Finance Readiness Agent",
        "market": "Market Linkage Agent",
        "operations": "Operations Improvement Agent",
        "training": "Skills Development Agent",
        "general": "Business Support Agent",
    }.get(category, "Business Support Agent")


def _requested_items_for_category(category: str) -> list[str]:
    return {
        "compliance": ["Director ID", "CIPC document", "Tax PIN", "Relevant compliance certificates"],
        "finance": ["Latest bank statement", "Revenue estimate", "Expense breakdown", "Funding requirement"],
        "market": ["Product/service list", "Target customers", "Past sales evidence", "Tender or buyer interest"],
        "operations": ["Current process description", "Staff count", "Equipment list", "Known bottlenecks"],
        "training": ["Training need description", "Team roles", "Preferred training dates"],
        "general": ["Business profile", "Main challenge", "Available supporting documents"],
    }.get(category, ["Business profile", "Main challenge", "Available supporting documents"])


def _fallback_roadmap(decision: dict[str, Any] | None, intake: dict[str, Any] | None) -> list[dict[str, Any]]:
    decision = decision or {}
    interventions = decision.get("recommendedInterventions")
    if not isinstance(interventions, list) or not interventions:
        interventions = [
            {
                "title": "Business readiness review",
                "areaOfSupport": "General Support",
                "department": "General Support",
                "urgency": decision.get("urgencyLevel") or "medium",
                "reason": "Confirm the SME's main readiness gaps and agree on immediate support priorities.",
            },
            {
                "title": "Financial records cleanup",
                "areaOfSupport": "Finance",
                "department": "Finance",
                "urgency": "medium",
                "reason": "Improve reporting confidence and prepare better evidence for programme monitoring.",
            },
            {
                "title": "Market access planning",
                "areaOfSupport": "Market Access",
                "department": "Market Access",
                "urgency": "medium",
                "reason": "Clarify target customers, channels, and buyer-readiness actions.",
            },
        ]

    roadmap: list[dict[str, Any]] = []
    for index, item in enumerate(interventions[:8]):
        if not isinstance(item, dict):
            continue
        urgency = str(item.get("urgency") or decision.get("urgencyLevel") or "medium")
        area = str(item.get("areaOfSupport") or item.get("department") or "General Support")
        weeks = item.get("estimatedWeeks")
        if not isinstance(weeks, (int, float)):
            weeks = 2 if urgency == "urgent" else 4 if urgency == "high" else 6 if urgency == "medium" else 8
        roadmap.append(
            {
                "title": str(item.get("title") or "Recommended intervention"),
                "interventionId": item.get("interventionId") or item.get("id"),
                "areaOfSupport": area,
                "department": area,
                "urgency": urgency,
                "reason": str(item.get("reason") or "Recommended from the SME intake analysis."),
                "expectedImpact": str(item.get("expectedImpact") or "Improve readiness and reduce the identified support gap."),
                "targetOutcome": str(item.get("targetOutcome") or "Complete the agreed support action and capture evidence of progress."),
                "estimatedWeeks": weeks,
                "status": "in_progress" if index == 0 else "not_started",
                "progress": 20 if index == 0 else 0,
            }
        )

    return roadmap


def _fallback_agents(roadmap: list[dict[str, Any]]) -> list[dict[str, Any]]:
    grouped: dict[str, dict[str, Any]] = {}
    for item in roadmap:
        area = item.get("areaOfSupport") or item.get("department") or "General Support"
        category = _category_from_text(f"{area} {item.get('title')}")
        key = category
        title = str(item.get("title") or "Recommended support")
        if key not in grouped:
            grouped[key] = {
                "id": key,
                "name": _agent_name_for_category(category),
                "title": f"{_agent_name_for_category(category).replace(' Agent', '')} Support",
                "category": category,
                "department": area,
                "areaOfSupport": area,
                "focus": title,
                "intro": f"I can help with {title.lower()} and guide documents, questions, and next steps.",
                "requestedItems": _requested_items_for_category(category),
                "matchedInterventionTitle": title,
                "matchedInterventionTitles": [title],
                "urgency": item.get("urgency") or "medium",
            }
            continue

        agent = grouped[key]
        titles = agent.get("matchedInterventionTitles")
        if not isinstance(titles, list):
            titles = [agent.get("matchedInterventionTitle")]
        if title not in titles:
            titles.append(title)
        agent["matchedInterventionTitles"] = titles
        agent["focus"] = ", ".join(str(value) for value in titles[:3] if value)
        if str(area or "") not in str(agent.get("department") or ""):
            agent["department"] = "Multi-area Support"
            agent["areaOfSupport"] = "Multi-area Support"
        if item.get("urgency") == "urgent" or (item.get("urgency") == "high" and agent.get("urgency") != "urgent"):
            agent["urgency"] = item.get("urgency")
    return list(grouped.values())


@app.post("/api/roadmap/generate")
async def generate_roadmap(
    payload: RoadmapGenerateRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    _require_auth(authorization)

    intake = payload.intake
    if payload.intakeId and not intake:
        snap = db.collection("smeIntakeSubmissions").document(payload.intakeId).get()
        if not snap.exists:
            raise HTTPException(status_code=404, detail="Intake submission not found")
        intake = {"id": snap.id, **_json_safe(snap.to_dict() or {})}

    if not intake and not payload.decision:
        raise HTTPException(status_code=400, detail="Provide intakeId, intake, or decision")

    system_prompt = (
        "You generate SME incubation support roadmaps. Return valid JSON only with keys: "
        "summary, roadmap. roadmap must be a list of objects with title, department, urgency, reason, "
        "expectedImpact, targetOutcome, estimatedWeeks, status, and progress. Keep items practical."
    )

    try:
        text = _call_gemini(
            system_prompt,
            {
                "intake": intake,
                "participant": payload.participant,
                "decision": payload.decision,
                "language": payload.language,
            },
            max_output_tokens=2200,
            response_mime_type="application/json",
        )
        result = _extract_json_object(text) or {}
        roadmap = result.get("roadmap") if isinstance(result.get("roadmap"), list) else []
        if not roadmap:
            roadmap = _fallback_roadmap(payload.decision, intake)
        return {
            "ok": True,
            "summary": str(result.get("summary") or "Roadmap generated."),
            "roadmap": roadmap,
            "agents": _fallback_agents(roadmap),
            "model": GEMINI_MODEL,
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        }
    except HTTPException:
        roadmap = _fallback_roadmap(payload.decision, intake)
        return {
            "ok": True,
            "summary": "Roadmap generated from fallback rules.",
            "roadmap": roadmap,
            "agents": _fallback_agents(roadmap),
            "model": "fallback",
            "generatedAt": datetime.now(timezone.utc).isoformat(),
        }


@app.post("/api/roadmap/agents")
async def build_roadmap_agents(
    payload: RoadmapAgentsRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    _require_auth(authorization)

    roadmap = payload.roadmap or _fallback_roadmap(payload.decision, None)
    agents = _fallback_agents(roadmap)
    return {
        "ok": True,
        "agents": agents,
        "count": len(agents),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }


@app.post("/api/roadmap/agent-chat")
async def roadmap_agent_chat(
    payload: RoadmapAgentChatRequest,
    authorization: str | None = Header(default=None),
) -> dict[str, Any]:
    _require_auth(authorization)

    agent_name = str(payload.agent.get("name") or "Business Support Agent")
    focus = str(
        payload.agent.get("focus")
        or ((payload.roadmapItem or {}).get("title"))
        or "the support roadmap"
    )
    system_prompt = (
        f"You are {agent_name}, an SME incubation roadmap support agent. "
        "Answer warmly and practically. Help the SME understand required documents, next steps, blockers, "
        "and evidence needed for the matched roadmap intervention. Use the supplied documents and documentStatus "
        "to avoid asking for files that are already uploaded. Do not invent official approvals or legal advice."
    )

    try:
        reply = _call_gemini(
            system_prompt,
            {
                "message": payload.message,
                "agent": payload.agent,
                "roadmapItem": payload.roadmapItem,
                "participant": payload.participant,
                "documents": payload.documents,
                "documentStatus": payload.documentStatus,
                "history": [turn.model_dump() for turn in payload.history[-10:]],
                "language": payload.language,
            },
            max_output_tokens=1000,
        )
    except HTTPException:
        message_text = payload.message.strip().lower()
        requested = payload.agent.get("requestedItems") if isinstance(payload.agent.get("requestedItems"), list) else []
        requested_text = ", ".join(str(item) for item in requested[:3]) or "your business profile, main challenge, and supporting documents"
        ready_items = [
            str(item.get("item"))
            for item in payload.documentStatus
            if isinstance(item, dict) and item.get("ready") and item.get("item")
        ]
        missing_items = [
            str(item.get("item"))
            for item in payload.documentStatus
            if isinstance(item, dict) and not item.get("ready") and item.get("item")
        ]
        if re.match(r"^(hi|hie|hello|hey|sawubona|dumelang|avuxeni)\b", message_text):
            reply = (
                f"Hi, I am {agent_name}. I can help you with {focus}. "
                "Tell me what you already have ready and what is blocking you."
            )
        elif any(word in message_text for word in ("document", "prepare", "need")):
            if ready_items and missing_items:
                reply = (
                    f"I can see these are already uploaded: {', '.join(ready_items)}. "
                    f"Still outstanding for {focus}: {', '.join(missing_items[:3])}."
                )
            elif ready_items and not missing_items:
                reply = f"I can see the requested documents for {focus} are already uploaded. Next we should review quality and verification status."
            else:
                reply = (
                    f"For {focus}, prepare these first: {requested_text}. "
                    "If one is missing, tell me which one and I will help you work through it."
                )
        else:
            reply = (
                f"I can help with {focus}. What specific support do you need next: "
                "documents, requirements, timeline, or a blocker?"
            )

    return {
        "ok": True,
        "reply": reply,
        "agent": payload.agent,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
    }


# -------------------------------------------------------------------------
# Text-to-speech (ElevenLabs) — agentic home's conversation mode "speaking"
# audio. Proxied server-side so the ElevenLabs key never reaches the client.
# -------------------------------------------------------------------------

ELEVENLABS_API_BASE = "https://api.elevenlabs.io/v1"
# "Rachel" — a stock ElevenLabs preset voice, used only as a default so
# conversation mode has a voice out of the box; override with the
# ELEVENLABS_VOICE_ID env var once a preferred voice is picked in ElevenLabs.
ELEVENLABS_DEFAULT_VOICE_ID = os.getenv("ELEVENLABS_VOICE_ID", "21m00Tcm4TlvDq8ikWAM")
# The Turbo model line trades a little quality for much lower latency, which
# matters more for a live back-and-forth than for a one-off narration.
ELEVENLABS_MODEL_ID = os.getenv("ELEVENLABS_MODEL_ID", "eleven_turbo_v2_5")
MAX_TTS_CHARS = 2000


class TtsRequest(BaseModel):
    text: str = Field(default="", max_length=MAX_TTS_CHARS)
    voiceId: str | None = None


@app.post("/tts")
def synthesize_speech(payload: TtsRequest, authorization: str | None = Header(default=None)) -> Response:
    _require_auth(authorization)

    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        raise HTTPException(status_code=503, detail="Voice output is not configured.")

    text = payload.text.strip()[:MAX_TTS_CHARS]
    if not text:
        raise HTTPException(status_code=400, detail="Text is required.")

    voice_id = (payload.voiceId or ELEVENLABS_DEFAULT_VOICE_ID).strip()
    url = f"{ELEVENLABS_API_BASE}/text-to-speech/{voice_id}"
    body = json.dumps({
        "text": text,
        "model_id": ELEVENLABS_MODEL_ID,
        "voice_settings": {"stability": 0.5, "similarity_boost": 0.75},
    }).encode("utf-8")

    request_obj = urllib.request.Request(
        url,
        data=body,
        method="POST",
        headers={
            "xi-api-key": api_key,
            "Content-Type": "application/json",
            "Accept": "audio/mpeg",
        },
    )
    try:
        with urllib.request.urlopen(request_obj, timeout=30) as response:
            audio_bytes = response.read()
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="ignore")[:300]
        raise HTTPException(
            status_code=502, detail=f"ElevenLabs request failed: {detail}"
        ) from error
    except (urllib.error.URLError, TimeoutError) as error:
        raise HTTPException(status_code=502, detail="Could not reach ElevenLabs.") from error

    return Response(content=audio_bytes, media_type="audio/mpeg")


app.include_router(create_business_plan_router(_call_gemini, _require_auth))
app.include_router(create_strategic_plan_router(_call_gemini, _require_auth))
app.include_router(create_document_provenance_router(_require_auth))
app.include_router(create_survey_import_router(_call_gemini, _require_auth))
app.include_router(
    create_pitchfy_router(
        pitchfy_client,
        db,
        _require_auth,
    )
)
