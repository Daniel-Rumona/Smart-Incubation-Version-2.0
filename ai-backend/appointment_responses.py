"""SME responses to appointment invitations (accept / decline / propose another time).

One implementation for every channel. The web workspace calls it with the SME's Firebase ID token and
the WhatsApp router calls it with the router secret; both end up in ``respond_to_appointment``.
SMEs cannot write ``appointments`` from the browser (Firestore rules), so this is also the only
safe web path.

Decline reasons
    not_available / other_engagement  -> the SME may propose a new time
    no_longer_needed                  -> offered only before any session has been held; records a
                                         decline *request* on the assignment that operations must
                                         confirm (see the operations "Confirm decline" action)
    other                             -> free text (e.g. from natural-language WhatsApp)
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from fastapi import APIRouter, Header, HTTPException, Request
from fastapi.responses import JSONResponse
from firebase_admin import firestore
from pydantic import BaseModel, ConfigDict, Field

from agent_actions import (
    ActionError,
    MAX_APPOINTMENT_HOURS,
    _as_utc,
    _fmt_local,
    _iso,
    _norm,
    _timezone,
    _now,
    parse_when,
)

DECLINE_REASONS: dict[str, dict[str, Any]] = {
    "not_available": {"label": "I'm not available at that time", "proposeTime": True},
    "other_engagement": {"label": "I have another engagement", "proposeTime": True},
    "no_longer_needed": {"label": "I no longer need this intervention", "proposeTime": False},
    "other": {"label": "Another reason", "proposeTime": True},
}
CLOSED_STATUSES = {"cancelled", "completed"}
MAX_TEXT = 300


@dataclass(frozen=True)
class Sme:
    uid: str
    email: str | None
    company_code: str | None
    participant_ids: frozenset[str]


# --------------------------------------------------------------------------- identity


def resolve_sme(db: Any, uid: str, email: str | None, company_code: str | None) -> Sme:
    """Port of participantContext() in whatsappBot.ts: every id this SME's records may be filed under."""
    ids = {uid}
    clean_email = _norm(email)
    queries = [db.collection("participants").where("uid", "==", uid)]
    if clean_email:
        queries.append(db.collection("participants").where("email", "==", clean_email))
    for query in queries:
        for snap in query.stream():
            ids.add(snap.id)
            data = snap.to_dict() or {}
            if data.get("participantId"):
                ids.add(str(data["participantId"]))
    for snap in db.collection("applications").where("participantId", "==", uid).stream():
        data = snap.to_dict() or {}
        if data.get("participantId"):
            ids.add(str(data["participantId"]))
    return Sme(uid=uid, email=clean_email or None, company_code=company_code, participant_ids=frozenset(ids))


def _load_own_appointment(db: Any, sme: Sme, appointment_id: str) -> dict[str, Any]:
    snap = db.collection("appointments").document(str(appointment_id)).get()
    data = (snap.to_dict() or {}) if snap.exists else None
    owned = data is not None and (
        str(data.get("participantId") or "") in sme.participant_ids
        or (sme.email and _norm(data.get("participantEmail")) == sme.email)
    )
    # Same answer for "doesn't exist" and "isn't yours".
    if not owned or (sme.company_code and data.get("companyCode") != sme.company_code):
        raise ActionError("I couldn't find that appointment for your account.")
    return {**data, "id": snap.id}


def _assignment(db: Any, appointment: dict[str, Any]) -> dict[str, Any] | None:
    aid = appointment.get("assignedInterventionId")
    if not aid:
        return None
    snap = db.collection("assignedInterventions").document(str(aid)).get()
    data = (snap.to_dict() or {}) if snap.exists else None
    if data is None or data.get("companyCode") != appointment.get("companyCode"):
        return None
    return {**data, "id": snap.id}


# --------------------------------------------------------------------------- rules


def _has_work(assignment: dict[str, Any]) -> bool:
    return (
        float(assignment.get("progress") or 0) > 0
        or float(assignment.get("timeSpent") or 0) > 0
        or bool(assignment.get("progressSteps"))
        or _norm(assignment.get("status")) in {"completed", "awaiting_confirmation"}
    )


def can_decline_intervention(db: Any, appointment: dict[str, Any]) -> bool:
    """True only before any session has been held: nothing recorded on the assignment and no
    completed appointment against it. After that the SME can move the meeting, not drop the work."""
    assignment = _assignment(db, appointment)
    if assignment is None or _has_work(assignment):
        return False
    for snap in db.collection("appointments").where("assignedInterventionId", "==", assignment["id"]).stream():
        if _norm((snap.to_dict() or {}).get("status")) == "completed":
            return False
    return True


def rsvp_context(db: Any, sme: Sme, appointment_id: str) -> dict[str, Any]:
    appointment = _load_own_appointment(db, sme, appointment_id)
    allow_drop = can_decline_intervention(db, appointment)
    start = _as_utc(appointment.get("startTime"))
    return {
        "appointment": {
            "id": appointment["id"],
            "title": str(appointment.get("interventionTitle") or "Appointment"),
            "status": _norm(appointment.get("status")) or "pending",
            "start": _iso(start),
            "end": _iso(_as_utc(appointment.get("endTime"))),
            "when": _fmt_local(start) if start else None,
            "meetingType": appointment.get("meetingType"),
        },
        "canDeclineIntervention": allow_drop,
        "declineOptions": [
            {"code": code, "label": spec["label"], "proposeTime": spec["proposeTime"]}
            for code, spec in DECLINE_REASONS.items()
            if code != "other" and (code != "no_longer_needed" or allow_drop)
        ],
    }


def _clean_text(value: Any, limit: int = MAX_TEXT) -> str | None:
    text = " ".join(str(value or "").split())
    return text[:limit] or None


def _proposal(reason_code: str, args: dict[str, Any]) -> dict[str, Any] | None:
    """A validated new-time suggestion (structured and/or free text). Never applied; ops decides."""
    if reason_code == "no_longer_needed":
        return None
    text = _clean_text(args.get("proposedText"), 200)
    start_raw, end_raw = args.get("proposedStart"), args.get("proposedEnd")
    start = end = None
    if start_raw:
        start = parse_when(start_raw, "proposed start time")
        end = parse_when(end_raw, "proposed end time") if end_raw else start + timedelta(hours=1)
        if end <= start or end - start > timedelta(hours=MAX_APPOINTMENT_HOURS):
            raise ActionError("The proposed time isn't valid.")
        if start < _now():
            raise ActionError("The proposed time is in the past.")
        text = text or f"{_fmt_local(start)} – {end.astimezone(_timezone()).strftime('%H:%M')}"
    if not text and not start:
        return None
    return {"start": start, "end": end, "text": text}


def _notification(appointment: dict[str, Any], kind: str, message: str) -> dict[str, Any]:
    return {
        "companyCode": appointment.get("companyCode"), "type": kind, "appointmentId": appointment["id"],
        "assignedInterventionId": appointment.get("assignedInterventionId"),
        "participantId": appointment.get("participantId"),
        "recipientRoles": ["operations", "consultant"], "message": message,
        "createdAt": firestore.SERVER_TIMESTAMP, "readBy": {},
    }


def _channel_fields(via: str, phone: str | None) -> dict[str, Any]:
    return {"confirmationSource": via, **({"confirmationPhone": phone} if phone else {})}


# --------------------------------------------------------------------------- respond


def respond_to_appointment(
    db: Any, sme: Sme, appointment_id: str, args: dict[str, Any], *, via: str, phone: str | None = None,
) -> dict[str, Any]:
    response = _norm(args.get("response"))
    if response not in {"accept", "decline", "reschedule_request"}:
        raise ActionError("Please choose accept, decline or ask to reschedule.")
    appointment = _load_own_appointment(db, sme, appointment_id)
    current = _norm(appointment.get("status")) or "pending"
    if current in CLOSED_STATUSES:
        raise ActionError(f"That appointment is already {current}, so it can no longer be changed here.")

    title = str(appointment.get("interventionTitle") or "appointment")
    who = str(appointment.get("participantName") or "The SME")
    ref = db.collection("appointments").document(appointment["id"])
    assignment = _assignment(db, appointment)
    batch = db.batch()

    def withdraw_drop_request(reason: str) -> None:
        request = (assignment or {}).get("declineRequest")
        if assignment and isinstance(request, dict) and _norm(request.get("status")) == "requested":
            batch.update(db.collection("assignedInterventions").document(assignment["id"]), {
                "declineRequest": {**request, "status": "withdrawn", "withdrawnReason": reason,
                                   "withdrawnAt": firestore.SERVER_TIMESTAMP},
                "updatedAt": firestore.SERVER_TIMESTAMP,
            })

    if response == "accept":
        if current == "accepted":
            return {"status": "accepted", "changed": False, "title": title}
        batch.update(ref, {
            "status": "accepted", "beneficiaryConfirmation": "confirmed", "userConfirmation": "confirmed",
            **_channel_fields(via, phone),
            "beneficiaryConfirmedAt": firestore.SERVER_TIMESTAMP, "declineNeedsReview": False,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        if appointment.get("declineNeedsReview"):
            withdraw_drop_request("SME accepted the appointment")
        # Booked together with the intervention -> accepted together (mirrors acceptIncubateeIntervention).
        if (assignment and str(appointment.get("acceptanceBundle") or "").startswith("intervention_")
                and assignment.get("participantId") == appointment.get("participantId")
                and _norm(assignment.get("participantStatus")) == "pending"):
            batch.update(db.collection("assignedInterventions").document(assignment["id"]), {
                "participantStatus": "accepted", "participantAcceptedAt": firestore.SERVER_TIMESTAMP,
                "status": "in-progress", "updatedAt": firestore.SERVER_TIMESTAMP,
            })
        batch.set(db.collection("notifications").document(), _notification(
            appointment, "appointment_accepted", f"{who} confirmed the {title} appointment."))
        batch.commit()
        return {"status": "accepted", "changed": True, "title": title}

    if response == "reschedule_request":
        proposal = _proposal("other", args)
        reason = _clean_text(args.get("detail"))
        if not proposal and not reason:
            raise ActionError("When would suit you better?")
        batch.update(ref, {
            "rescheduleRequest": _reschedule_request(proposal, reason, via),
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        wanted = f" to {proposal['text']}" if proposal and proposal.get("text") else ""
        batch.set(db.collection("notifications").document(), _notification(
            appointment, "appointment_reschedule_requested",
            f"{who} asked to reschedule the {title} appointment{wanted}" + (f" ({reason})." if reason else ".")))
        batch.commit()
        return {"status": current, "changed": True, "title": title}

    # ---- decline
    code = _norm(args.get("reasonCode"))
    if code not in DECLINE_REASONS:
        raise ActionError("Please tell me why you can't make it.")
    detail = _clean_text(args.get("detail"))
    if code == "other" and not detail:
        raise ActionError("Please tell me briefly why you can't make it.")
    if code == "no_longer_needed" and not can_decline_intervention(db, appointment):
        raise ActionError("You can only drop an intervention before its first session has been held. "
                          "Please choose another reason, or suggest a new time.")
    proposal = _proposal(code, args)
    label = DECLINE_REASONS[code]["label"]
    reason_text = f"{label}: {detail}" if detail and code != "other" else (detail or label)

    same_as_before = (
        current == "declined" and appointment.get("declineReasonCode") == code
        and appointment.get("declineDetail") == detail
        and (proposal or {}).get("text") == ((appointment.get("rescheduleRequest") or {}).get("requestedDateText"))
    )
    if same_as_before:
        return {"status": "declined", "changed": False, "title": title, "needsReview": code == "no_longer_needed"}

    drop = code == "no_longer_needed"
    batch.update(ref, {
        "status": "declined", "beneficiaryConfirmation": "declined", "userConfirmation": "declined",
        "declineReasonCode": code, "declineReason": reason_text, "declineDetail": detail,
        "declineNeedsReview": drop, "declinedVia": via, **_channel_fields(via, phone),
        "beneficiaryDeclinedAt": firestore.SERVER_TIMESTAMP,
        "rescheduleRequest": _reschedule_request(proposal, reason_text, via) if proposal else None,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    if drop and assignment:
        batch.update(db.collection("assignedInterventions").document(assignment["id"]), {
            "declineRequest": {
                "status": "requested", "reasonCode": code, "reasonText": reason_text, "appointmentId": appointment["id"],
                "requestedVia": via, "requestedByUid": sme.uid, "requestedAt": firestore.SERVER_TIMESTAMP,
            },
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
    elif appointment.get("declineNeedsReview"):
        withdraw_drop_request("SME chose another reason")
    if drop:
        message = f"{who} no longer needs {title} and declined the appointment. Review and confirm the decline."
        kind = "intervention_decline_requested"
    else:
        wanted = f" They suggested {proposal['text']}." if proposal and proposal.get("text") else ""
        message = f"{who} declined the {title} appointment ({reason_text}).{wanted}"
        kind = "appointment_declined"
    batch.set(db.collection("notifications").document(), _notification(appointment, kind, message))
    batch.commit()
    return {"status": "declined", "changed": True, "title": title, "needsReview": drop}


def _reschedule_request(proposal: dict[str, Any] | None, reason: str | None, via: str) -> dict[str, Any]:
    proposal = proposal or {}
    return {
        "status": "requested", "reasonText": reason,
        "requestedStart": proposal.get("start"), "requestedEnd": proposal.get("end"),
        "requestedDateText": proposal.get("text"), "requestedTimeText": None,
        "requestedVia": via, "requestedAt": firestore.SERVER_TIMESTAMP,
    }


# --------------------------------------------------------------------------- routers


class RespondBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    response: str = Field(pattern="^(accept|decline|reschedule_request)$")
    reasonCode: str | None = Field(default=None, max_length=40)
    detail: str | None = Field(default=None, max_length=500)
    proposedText: str | None = Field(default=None, max_length=200)
    proposedStart: str | None = Field(default=None, max_length=40)
    proposedEnd: str | None = Field(default=None, max_length=40)


class WhatsAppRespondBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    userId: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=5, max_length=32)
    appointmentId: str = Field(min_length=1, max_length=200)
    response: str = Field(pattern="^(accept|decline|reschedule_request)$")
    reasonCode: str | None = Field(default=None, max_length=40)
    detail: str | None = Field(default=None, max_length=500)
    proposedText: str | None = Field(default=None, max_length=200)
    proposedStart: str | None = Field(default=None, max_length=40)
    proposedEnd: str | None = Field(default=None, max_length=40)


class WhatsAppContextBody(BaseModel):
    model_config = ConfigDict(extra="forbid")

    userId: str = Field(min_length=1, max_length=200)
    phone: str = Field(min_length=5, max_length=32)
    appointmentId: str = Field(min_length=1, max_length=200)


def create_appointment_responses_router(
    db: Any,
    authenticate: Callable[[str | None], Any],
    authorize_whatsapp_user: Callable[[Request, str, str], tuple[dict[str, Any] | None, JSONResponse | None]],
) -> APIRouter:
    router = APIRouter()

    def web_sme(authorization: str | None) -> Sme:
        identity = authenticate(authorization)
        if identity.is_service or _norm(identity.role) != "incubatee":
            raise HTTPException(status_code=403, detail="Only the SME can respond to an appointment.")
        return resolve_sme(db, identity.uid, identity.email, identity.company_code)

    def fail(status: int, error: ActionError) -> JSONResponse:
        return JSONResponse(status_code=status, content={"ok": False, "reply": str(error), "error": {"code": "ACTION_REJECTED"}})

    @router.get("/api/appointments/{appointment_id}/rsvp-context")
    def web_context(appointment_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
        sme = web_sme(authorization)
        try:
            return rsvp_context(db, sme, appointment_id)
        except ActionError as exc:
            raise HTTPException(status_code=404, detail=str(exc)) from exc

    @router.post("/api/appointments/{appointment_id}/respond")
    def web_respond(appointment_id: str, body: RespondBody, authorization: str | None = Header(default=None)) -> dict[str, Any]:
        sme = web_sme(authorization)
        try:
            return {"ok": True, **respond_to_appointment(db, sme, appointment_id, body.model_dump(), via="web")}
        except ActionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    def whatsapp_sme(request: Request, user_id: str, phone: str) -> tuple[Sme | None, JSONResponse | None]:
        user, error = authorize_whatsapp_user(request, user_id, phone)
        if error or user is None:
            return None, error
        if _norm(user.get("role")) != "incubatee":
            return None, JSONResponse(status_code=403, content={"ok": False, "error": {"code": "NOT_AN_SME"},
                                                                "reply": "Only the SME can respond to an appointment invitation."})
        return resolve_sme(db, user_id, user.get("email"), str(user.get("companyCode") or "") or None), None

    @router.post("/api/whatsapp/appointments/context")
    def whatsapp_context(body: WhatsAppContextBody, request: Request):
        sme, error = whatsapp_sme(request, body.userId, body.phone)
        if error:
            return error
        try:
            return {"ok": True, **rsvp_context(db, sme, body.appointmentId)}  # type: ignore[arg-type]
        except ActionError as exc:
            return fail(409, exc)

    @router.post("/api/whatsapp/appointments/respond")
    def whatsapp_respond(body: WhatsAppRespondBody, request: Request):
        sme, error = whatsapp_sme(request, body.userId, body.phone)
        if error:
            return error
        args = body.model_dump(exclude={"userId", "phone", "appointmentId"})
        try:
            result = respond_to_appointment(db, sme, body.appointmentId, args, via="whatsapp", phone=body.phone)  # type: ignore[arg-type]
        except ActionError as exc:
            return fail(409, exc)
        return {"ok": True, **result}

    return router
