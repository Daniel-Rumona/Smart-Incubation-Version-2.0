"""WhatsApp channel for the agentic operations in ``agent_actions``.

The WhatsApp router (Cloud Functions) resolves a sender's phone number to a Smart Incubation user and
calls these endpoints with the shared router secret. The tools, permissions, validation and proposal
store are exactly the web ones; only identity resolution and the reply format differ.

Trust model:
* The router secret proves the caller is our router (constant-time compare, fails closed if unset).
* The router asserts ``userId`` + ``phone``. We do NOT trust that blindly: the phone must belong to
  that user's own WhatsApp numbers, so a leaked secret alone can't act as an arbitrary user.
* Role, company and permissions always come from the user's document, never from the request.
* Writes still need a stored proposal owned by that user. The router is responsible for the extra
  action-PIN step (``WHATSAPP_ACTION_PIN``) between showing the confirm button and calling /confirm,
  the same control the existing assign-intervention flow uses.
"""

from __future__ import annotations

import hmac
import os
import re
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any, Callable

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from agent_actions import (
    ActionError,
    ProposalStore,
    actions_enabled,
    build_actor,
    confirm_proposal,
    run_agent_turn,
    tools_for,
)

SESSION_COLLECTION = "agentChannelSessions"
SESSION_TTL = timedelta(minutes=30)
SESSION_TURNS = 8
BUTTON_BODY_LIMIT = 1000  # WhatsApp interactive button bodies are capped at 1024 characters

WHATSAPP_STYLE = (
    "You are replying on WhatsApp to a staff member. Use short plain text: no markdown, no tables, no "
    "headings, no asterisks. Keep replies under about 500 characters. Ask one question at a time. "
    "Refer to people and interventions by name, never by id."
)


class WhatsAppAgentRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    channel: str = Field(default="whatsapp", pattern="^whatsapp$")
    userId: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=5, max_length=32)
    message: str = Field(min_length=1, max_length=1000)


class WhatsAppProposalRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    userId: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=5, max_length=32)
    proposalId: str = Field(min_length=1, max_length=200)


def _digits(value: Any) -> str:
    return re.sub(r"\D", "", str(value or ""))


def phone_matches_user(user: dict[str, Any], phone: str) -> bool:
    """True if ``phone`` is one of this user's WhatsApp numbers (mirrors the router's lookup)."""
    wanted = _digits(phone)
    if len(wanted) < 8:
        return False
    listed = user.get("whatsappPhoneNumbers")
    if isinstance(listed, list) and any(_digits(item) == wanted for item in listed):
        return True
    for number_field, flag_field in (("phone", "phoneIsWhatsApp"), ("alternativePhone", "alternativePhoneIsWhatsApp")):
        stored = _digits(user.get(number_field))
        if user.get(flag_field) is True and len(stored) >= 8 and stored[-9:] == wanted[-9:]:
            return True
    return False


def format_proposal_text(proposal: dict[str, Any]) -> str:
    """Confirmation body for a WhatsApp button message (bold via *...*, hard length cap)."""
    lines = [f"*{proposal['title']}*", ""]
    for row in proposal.get("summary", []):
        lines.append(f"{row['label']}: {row['value']}" if row.get("value") else f"{row['label']}:")
    warnings = proposal.get("warnings") or []
    if warnings:
        lines += [""] + [f"• {w}" for w in warnings]
    text = "\n".join(lines)
    return text if len(text) <= BUTTON_BODY_LIMIT else text[: BUTTON_BODY_LIMIT - 1].rstrip() + "…"


def _fail(status: int, code: str, reply: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"ok": False, "reply": reply, "error": {"code": code}})


def configured_router_secrets() -> list[str]:
    names = ("WHATSAPP_ROUTER_SECRET", "QTX_WHATSAPP_ROUTER_SECRET")
    return [value for value in (os.getenv(name, "").strip() for name in names) if value]


def authorize_router_user(db: Any, request: Request, user_id: str, phone: str) -> tuple[dict[str, Any] | None, JSONResponse | None]:
    """Router secret + "this phone belongs to this user". Returns (user document, None) or (None, error response)."""
    secrets = configured_router_secrets()
    if not secrets:
        return None, _fail(503, "SERVICE_NOT_CONFIGURED", "I couldn't process that right now.")
    supplied = request.headers.get("x-whatsapp-router-secret", "").strip()
    if not supplied or not any(hmac.compare_digest(supplied, secret) for secret in secrets):
        return None, _fail(401, "UNAUTHORIZED", "I couldn't process that right now.")
    try:
        snap = db.collection("users").document(user_id).get()
        user = (snap.to_dict() or {}) if snap.exists else None
    except Exception:
        user = None
    # Identical response for "no such user" and "number doesn't belong to them".
    if user is None or not phone_matches_user(user, phone):
        return None, _fail(403, "IDENTITY_MISMATCH", "I couldn't match this number to your account.")
    return user, None


def create_whatsapp_agent_router(
    db: Any,
    call_model: Callable[..., str],
    extract_json: Callable[[str], dict[str, Any] | None],
    persona: str,
) -> APIRouter:
    router = APIRouter()
    store = ProposalStore(db)

    def _authorize(request: Request, body_user_id: str, phone: str) -> tuple[Any, JSONResponse | None]:
        """Returns (actor, None) or (None, error response). Never raises for expected failures."""
        if not actions_enabled():
            return None, _fail(404, "DISABLED", "That isn't available right now.")
        user, error = authorize_router_user(db, request, body_user_id, phone)
        if error or user is None:
            return None, error

        role = str(user.get("role") or "").strip().lower() or None
        company = str(user.get("companyCode") or "").strip() or None
        identity = SimpleNamespace(uid=body_user_id, role=role, company_code=company,
                                   email=user.get("email"), is_service=False)
        return build_actor(db, identity), None

    def _load_turns(uid: str) -> list[dict[str, str]]:
        try:
            snap = db.collection(SESSION_COLLECTION).document(f"whatsapp_{uid}").get()
            data = (snap.to_dict() or {}) if snap.exists else {}
        except Exception:
            return []
        updated = data.get("updatedAt")
        if isinstance(updated, datetime):
            updated = updated if updated.tzinfo else updated.replace(tzinfo=timezone.utc)
            if datetime.now(timezone.utc) - updated > SESSION_TTL:
                return []
        turns = data.get("turns")
        return [t for t in turns if isinstance(t, dict)][-SESSION_TURNS:] if isinstance(turns, list) else []

    def _save_turns(uid: str, turns: list[dict[str, str]]) -> None:
        try:
            db.collection(SESSION_COLLECTION).document(f"whatsapp_{uid}").set({
                "uid": uid, "channel": "whatsapp", "turns": turns[-SESSION_TURNS:],
                "updatedAt": datetime.now(timezone.utc),
            })
        except Exception:
            pass  # losing short-term memory must never fail the request

    @router.post("/api/whatsapp/agent")
    def whatsapp_agent(payload: WhatsAppAgentRequest, request: Request):
        actor, error = _authorize(request, payload.userId, payload.phone)
        if error:
            return error
        if not tools_for(actor):
            return {"ok": True, "reply": "Appointment and intervention actions aren't available for your role.", "proposal": None}

        history = _load_turns(actor.uid)
        first_name = (actor.name or "").split(" ")[0] or None
        try:
            turn = run_agent_turn(
                db, actor,
                persona=f"{persona}\n\n{WHATSAPP_STYLE}",
                base_payload={
                    "userMessage": payload.message, "viewerName": first_name, "botName": "Q", "channel": "whatsapp",
                    "recentConversation": history,
                },
                call_model=call_model,
                extract_json=extract_json,
                store=store,
            )
        except Exception as exc:  # model / network trouble: never leak details to WhatsApp
            print("WhatsApp agent turn failed:", type(exc).__name__, flush=True)  # never log exc text: URLs can carry keys
            return _fail(500, "PROCESSING_ERROR", "I couldn't process that message right now. Please try again in a moment.")

        proposal = turn["proposal"]
        if proposal:
            proposal = {**proposal, "text": format_proposal_text(proposal)}
        _save_turns(actor.uid, history + [
            {"role": "user", "content": payload.message},
            {"role": "agent", "content": turn["reply"]},
        ])
        return {"ok": True, "reply": turn["reply"], "proposal": proposal}

    @router.post("/api/whatsapp/agent/confirm")
    def whatsapp_confirm(payload: WhatsAppProposalRequest, request: Request):
        actor, error = _authorize(request, payload.userId, payload.phone)
        if error:
            return error
        try:
            outcome = confirm_proposal(db, store, actor, payload.proposalId)
        except ActionError as exc:
            return _fail(409, "ACTION_REJECTED", str(exc))
        except Exception as exc:
            print("WhatsApp confirm failed:", type(exc).__name__, flush=True)
            return _fail(500, "PROCESSING_ERROR", "I couldn't complete that. Nothing was changed, or it needs checking in the workspace.")
        _save_turns(actor.uid, _load_turns(actor.uid) + [{"role": "agent", "content": f"(Confirmed: {outcome['title']})"}])
        return {"ok": True, "reply": f"Done — {str(outcome['title']).lower()} completed.", "result": outcome["result"]}

    @router.post("/api/whatsapp/agent/cancel")
    def whatsapp_cancel(payload: WhatsAppProposalRequest, request: Request):
        actor, error = _authorize(request, payload.userId, payload.phone)
        if error:
            return error
        try:
            store.claim(payload.proposalId, actor, "cancelled")
        except ActionError as exc:
            return _fail(409, "ACTION_REJECTED", str(exc))
        return {"ok": True, "reply": "No problem — I've discarded that. Nothing was changed."}

    return router
