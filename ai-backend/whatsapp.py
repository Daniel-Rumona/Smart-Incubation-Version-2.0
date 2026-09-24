from __future__ import annotations

import json
import re
import threading
import time
from dataclasses import dataclass
from typing import Any, Callable, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError


MAX_TOOL_ROUNDS = 3

LepharoActionType = Literal[
    "appointment_accept",
    "appointment_decline",
    "appointment_reschedule_request",
    "get_appointment",
    "get_upcoming_appointments",
    "get_meeting_link",
]

ConversationAwaiting = Literal[
    "appointment_rsvp_confirmation",
    "appointment_decline_reason",
    "appointment_target",
]


@dataclass(frozen=True)
class ActionDefinition:
    description: str
    kind: Literal["read", "mutation"]
    requires_appointment: bool


AVAILABLE_ACTIONS: dict[LepharoActionType, ActionDefinition] = {
    "get_upcoming_appointments": ActionDefinition(
        description="Retrieve upcoming appointments belonging to the current authenticated SME.",
        kind="read",
        requires_appointment=False,
    ),
    "get_appointment": ActionDefinition(
        description="Retrieve details for a specific appointment supplied through trusted context.",
        kind="read",
        requires_appointment=True,
    ),
    "get_meeting_link": ActionDefinition(
        description="Retrieve the joining link for a specific appointment supplied through trusted context.",
        kind="read",
        requires_appointment=True,
    ),
    "appointment_accept": ActionDefinition(
        description="Record a clear RSVP acceptance for the trusted appointment.",
        kind="mutation",
        requires_appointment=True,
    ),
    "appointment_decline": ActionDefinition(
        description="Record a clear RSVP decline with a reason for the trusted appointment.",
        kind="mutation",
        requires_appointment=True,
    ),
    "appointment_reschedule_request": ActionDefinition(
        description="Request a date or time change for the trusted appointment without claiming it was changed.",
        kind="mutation",
        requires_appointment=True,
    ),
}


class WhatsAppConversationInput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    awaiting: str | None = Field(default=None, max_length=100)
    appointmentId: str | None = Field(default=None, max_length=200)


class ToolResultInput(BaseModel):
    model_config = ConfigDict(extra="ignore")

    type: str = Field(min_length=1, max_length=100)
    result: dict[str, Any] = Field(default_factory=dict)


class WhatsAppContext(BaseModel):
    # The router contract can grow without changing this endpoint.
    model_config = ConfigDict(extra="allow")

    engine: str | None = Field(default=None, max_length=100)
    type: str | None = Field(default=None, max_length=100)
    appointmentId: str | None = Field(default=None, max_length=200)
    appointment: dict[str, Any] = Field(default_factory=dict)
    conversation: WhatsAppConversationInput | None = None
    toolResults: list[ToolResultInput] = Field(default_factory=list)


class WhatsAppChatRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    channel: Literal["whatsapp"]
    userId: str = Field(min_length=1, max_length=200)
    message: str = Field(min_length=1, max_length=4000)
    context: WhatsAppContext = Field(default_factory=WhatsAppContext)


class LepharoAction(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: LepharoActionType
    appointmentId: str | None = Field(default=None, max_length=200)
    reason: str | None = Field(default=None, max_length=1000)
    requestedDate: str | None = Field(default=None, max_length=40)
    requestedTime: str | None = Field(default=None, max_length=40)
    requestedDateText: str | None = Field(default=None, max_length=160)
    requestedTimeText: str | None = Field(default=None, max_length=160)


class WhatsAppConversation(BaseModel):
    model_config = ConfigDict(extra="forbid")

    awaiting: ConversationAwaiting | None = None
    appointmentId: str | None = Field(default=None, max_length=200)


class WhatsAppError(BaseModel):
    code: str


class ToolCallSelection(BaseModel):
    model_config = ConfigDict(extra="forbid")

    type: LepharoActionType
    arguments: dict[str, Any] = Field(default_factory=dict)


class WhatsAppChatResponse(BaseModel):
    ok: bool
    reply: str
    intent: str | None = None
    confidence: float | None = Field(default=None, ge=0, le=1)
    action: LepharoAction | None = None
    toolCall: ToolCallSelection | None = None
    conversation: WhatsAppConversation = Field(default_factory=WhatsAppConversation)
    error: WhatsAppError | None = None


class WhatsAppAgentDecision(BaseModel):
    """Private model contract. Nothing reaches the router before this validates."""

    model_config = ConfigDict(extra="forbid")

    intent: str = Field(min_length=1, max_length=100)
    confidence: float = Field(ge=0, le=1)
    action: LepharoAction | None = None
    toolCall: ToolCallSelection | None = None
    conversation: WhatsAppConversation = Field(default_factory=WhatsAppConversation)
    reply: str = Field(min_length=1, max_length=1000)


@dataclass
class _PendingConversation:
    awaiting: str
    appointment_id: str
    expires_at: float


class WhatsAppConversationStore:
    """Instance-local convenience cache; never an authoritative data store."""

    def __init__(self, ttl_seconds: int = 60 * 60 * 24):
        self._ttl_seconds = ttl_seconds
        self._items: dict[str, _PendingConversation] = {}
        self._lock = threading.Lock()

    def get(self, user_id: str) -> _PendingConversation | None:
        now = time.monotonic()
        with self._lock:
            item = self._items.get(user_id)
            if item and item.expires_at > now:
                return item
            self._items.pop(user_id, None)
            return None

    def set(self, user_id: str, awaiting: str, appointment_id: str) -> None:
        with self._lock:
            self._items[user_id] = _PendingConversation(
                awaiting=awaiting,
                appointment_id=appointment_id,
                expires_at=time.monotonic() + self._ttl_seconds,
            )

    def clear(self, user_id: str) -> None:
        with self._lock:
            self._items.pop(user_id, None)


ModelCaller = Callable[..., str]
_MUTATING_ACTIONS = {
    name for name, definition in AVAILABLE_ACTIONS.items() if definition.kind == "mutation"
}
_READ_ACTIONS = {
    name for name, definition in AVAILABLE_ACTIONS.items() if definition.kind == "read"
}
_RSVP_ACTIONS = {"appointment_accept", "appointment_decline"}


def _extract_json_object(text: str) -> dict[str, Any] | None:
    # Regex is deliberately limited to JSON-envelope extraction, not intent recognition.
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", text, re.DOTALL | re.IGNORECASE)
    candidate = fenced.group(1) if fenced else text
    start = candidate.find("{")
    end = candidate.rfind("}")
    if start == -1 or end == -1 or end <= start:
        return None
    try:
        value = json.loads(candidate[start : end + 1])
        return value if isinstance(value, dict) else None
    except json.JSONDecodeError:
        return None


def _action_registry_payload() -> dict[str, dict[str, Any]]:
    return {
        name: {
            "description": definition.description,
            "kind": definition.kind,
            "requiresAppointment": definition.requires_appointment,
        }
        for name, definition in AVAILABLE_ACTIONS.items()
    }


def _agent_system_prompt() -> str:
    return (
        "You are the natural-language intent and action-selection agent for Smart Incubation WhatsApp conversations. "
        "Return one JSON object only with exactly: intent, confidence, action, toolCall, conversation, reply. "
        "Select action.type or toolCall.type only from actionRegistry. Understand meaning and paraphrases instead "
        "of matching keywords. Read requests such as upcoming appointments do not require an existing appointment "
        "context. Use get_upcoming_appointments for schedules, calendars, bookings, next meetings, or anything "
        "coming up. Use get_appointment or get_meeting_link only when a specific appointment is known in "
        "trustedContext. You cannot see real appointment data yourself: whenever you need a read action's result "
        "to answer, set toolCall to that one read action and leave action null. The router will run it and call "
        "you again with the result added to toolResults. Once toolResults already contains the result for your "
        "question, answer from that real data with action null and toolCall null, and do not request the same "
        "tool call again. Never invent appointment details that are not present in toolResults. "
        "Be conservative with mutations. appointment_accept and appointment_decline are allowed only when "
        "trustedContext indicates an RSVP or conversationState indicates RSVP confirmation. A bare yes outside "
        "that context is never an acceptance. Any mutation requires trustedAppointmentId. Never extract or copy "
        "an appointment ID from the user's message. If a target is missing, use action null and set conversation "
        "awaiting to appointment_target. A decline without a reason must use action null and awaiting "
        "appointment_decline_reason. Ambiguous attendance must use action null and awaiting "
        "appointment_rsvp_confirmation. "
        "Never claim a mutation succeeded. Replies before execution should say you understand the request "
        "or will check it. Unsupported requests should receive a natural conversational or clarification reply "
        "with action null and toolCall null. The action object may contain only type, appointmentId, reason, "
        "requestedDate, requestedTime, requestedDateText, and requestedTimeText. The toolCall object may contain "
        "only type and arguments. conversation may contain only awaiting and appointmentId. Use null for absent "
        "values."
    )


def _pending_conversation(
    payload: WhatsAppChatRequest,
    store: WhatsAppConversationStore,
    store_key: str,
) -> _PendingConversation | None:
    supplied = payload.context.conversation
    if supplied and supplied.awaiting:
        return _PendingConversation(
            awaiting=supplied.awaiting,
            appointment_id=(supplied.appointmentId or payload.context.appointmentId or "").strip(),
            expires_at=0,
        )
    return store.get(store_key)


def _safe_decision(pending: _PendingConversation | None = None) -> WhatsAppChatResponse:
    awaiting = None
    appointment_id = None
    if pending and pending.awaiting in {
        "appointment_rsvp_confirmation",
        "appointment_decline_reason",
        "appointment_target",
    }:
        awaiting = pending.awaiting
        appointment_id = pending.appointment_id or None
    return WhatsAppChatResponse(
        ok=True,
        reply="I want to make sure I understand. Could you rephrase what you would like me to do?",
        intent="unclear",
        confidence=0.0,
        action=None,
        conversation=WhatsAppConversation(awaiting=awaiting, appointmentId=appointment_id),
    )


def _call_agent(
    payload: WhatsAppChatRequest,
    pending: _PendingConversation | None,
    call_ai: ModelCaller,
    tool_results: list[dict[str, Any]],
) -> WhatsAppAgentDecision | None:
    trusted_appointment_id = (
        (pending.appointment_id if pending else "") or payload.context.appointmentId or ""
    ).strip() or None
    model_payload = {
        "message": payload.message.strip(),
        "trustedContext": {
            "engine": payload.context.engine,
            "type": payload.context.type,
            "trustedAppointmentId": trusted_appointment_id,
            "appointment": payload.context.appointment,
        },
        "conversationState": {
            "awaiting": pending.awaiting if pending else None,
            "trustedAppointmentId": trusted_appointment_id if pending else None,
        },
        "actionRegistry": _action_registry_payload(),
        "toolResults": tool_results,
        "requiredOutputSchema": WhatsAppAgentDecision.model_json_schema(),
    }

    raw = call_ai(
        _agent_system_prompt(),
        model_payload,
        max_output_tokens=1000,
        response_mime_type="application/json",
    )
    for attempt in range(2):
        parsed = _extract_json_object(raw)
        if parsed is not None:
            try:
                return WhatsAppAgentDecision.model_validate(parsed)
            except ValidationError:
                pass
        if attempt == 0:
            try:
                raw = call_ai(
                    "Repair the candidate into valid JSON for requiredOutputSchema. Do not add unsupported actions, "
                    "identifiers, or facts. Return JSON only.",
                    {
                        "candidate": raw[:4000],
                        "requiredOutputSchema": WhatsAppAgentDecision.model_json_schema(),
                        "actionRegistry": _action_registry_payload(),
                    },
                    max_output_tokens=1000,
                    response_mime_type="application/json",
                )
            except Exception:
                return None
    return None


def _neutral_action_reply(action_type: LepharoActionType) -> str:
    return {
        "appointment_accept": "I understand that you want to attend the appointment.",
        "appointment_decline": "I understand that you cannot attend the appointment.",
        "appointment_reschedule_request": "I understand that you would like to reschedule the appointment.",
    }[action_type]


def _apply_policy(
    decision: WhatsAppAgentDecision,
    payload: WhatsAppChatRequest,
    pending: _PendingConversation | None,
    store: WhatsAppConversationStore,
    store_key: str,
    tool_round: int,
) -> WhatsAppChatResponse:
    context_type = (payload.context.type or "").strip().lower()
    trusted_appointment_id = (
        (pending.appointment_id if pending else "") or payload.context.appointmentId or ""
    ).strip() or None
    pending_awaiting = pending.awaiting if pending else None
    action = decision.action.model_copy(deep=True) if decision.action else None
    tool_call = decision.toolCall.model_copy(deep=True) if decision.toolCall else None
    awaiting = decision.conversation.awaiting
    intent = decision.intent
    reply = decision.reply.strip()

    # A read-kind action selection is treated as a tool call, whichever field carried it.
    if not tool_call and action and action.type in _READ_ACTIONS:
        tool_call = ToolCallSelection(type=action.type, arguments={})
        action = None

    if tool_call:
        definition = AVAILABLE_ACTIONS[tool_call.type]
        if definition.requires_appointment and not trusted_appointment_id:
            store.clear(store_key)
            return WhatsAppChatResponse(
                ok=True,
                reply="Which appointment would you like help with?",
                intent="unclear",
                confidence=min(decision.confidence, 0.6),
                action=None,
                toolCall=None,
                conversation=WhatsAppConversation(awaiting="appointment_target", appointmentId=None),
            )
        if tool_round >= MAX_TOOL_ROUNDS:
            store.clear(store_key)
            return WhatsAppChatResponse(
                ok=True,
                reply="I'm having trouble finding that right now. Could you try again in a moment?",
                intent="unclear",
                confidence=decision.confidence,
                action=None,
                toolCall=None,
                conversation=WhatsAppConversation(),
            )
        store.clear(store_key)
        return WhatsAppChatResponse(
            ok=True,
            reply=reply,
            intent=intent,
            confidence=decision.confidence,
            action=None,
            toolCall=tool_call,
            conversation=WhatsAppConversation(),
        )

    if action:
        definition = AVAILABLE_ACTIONS[action.type]
        # The model can select a capability, but it can never select its target ID.
        action.appointmentId = trusted_appointment_id if definition.requires_appointment else None

        if definition.requires_appointment and not trusted_appointment_id:
            action = None
            awaiting = "appointment_target"
            reply = "Which appointment would you like help with?"
        elif action.type in _RSVP_ACTIONS and not (
            context_type == "appointment_rsvp"
            or pending_awaiting in {"appointment_rsvp_confirmation", "appointment_decline_reason"}
        ):
            action = None
            awaiting = None
            intent = "unclear"
            reply = "Could you tell me what you are saying yes or no to?"
        elif action.type in _MUTATING_ACTIONS and decision.confidence < 0.80:
            uncertain_action_type = action.type
            action = None
            awaiting = (
                "appointment_rsvp_confirmation"
                if uncertain_action_type in _RSVP_ACTIONS
                else "appointment_target"
            )
            intent = "unclear"
            reply = "Could you confirm what you would like me to do with the appointment?"

    if action and action.type == "appointment_decline" and not (action.reason or "").strip():
        action = None
        awaiting = "appointment_decline_reason"
        reply = "I understand that you cannot attend. Please tell me why you are unable to make the appointment."

    if action:
        awaiting = None
        reply = _neutral_action_reply(action.type)
        store.clear(store_key)
    elif awaiting and trusted_appointment_id:
        store.set(store_key, awaiting, trusted_appointment_id)
    elif not awaiting:
        store.clear(store_key)

    return WhatsAppChatResponse(
        ok=True,
        reply=reply,
        intent=intent,
        confidence=decision.confidence,
        action=action,
        toolCall=None,
        conversation=WhatsAppConversation(
            awaiting=awaiting,
            appointmentId=trusted_appointment_id if awaiting else None,
        ),
    )


# Engines this backend serves. The Smart Incubation router sends QTX; LPH is kept so the original
# contract and its tests keep working. Anything else is rejected before the model is called.
SUPPORTED_ENGINES = {"QTX", "LPH"}


def interpret_whatsapp_message(
    payload: WhatsAppChatRequest,
    store: WhatsAppConversationStore,
    call_ai: ModelCaller,
) -> WhatsAppChatResponse:
    if payload.context.engine and payload.context.engine.strip().upper() not in SUPPORTED_ENGINES:
        return WhatsAppChatResponse(
            ok=True,
            reply="I can't help with that conversation from here. Send menu to see what I can do.",
            intent="unclear",
            confidence=1.0,
            action=None,
            conversation=WhatsAppConversation(),
        )

    store_key = f"whatsapp:{payload.userId.strip()}"
    pending = _pending_conversation(payload, store, store_key)
    tool_results = [item.model_dump() for item in payload.context.toolResults[:MAX_TOOL_ROUNDS]]
    decision = _call_agent(payload, pending, call_ai, tool_results)
    if decision is None:
        return _safe_decision(pending)
    return _apply_policy(decision, payload, pending, store, store_key, len(tool_results))
