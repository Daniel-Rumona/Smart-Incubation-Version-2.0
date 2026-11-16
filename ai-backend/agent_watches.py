"""Watches and chasers for the workspace assistant (Q).

* A WATCH is a condition the user states in plain words ("tell me if any Rustenburg SME goes High risk
  and has no session booked in the next two weeks", "let me know when Cash Flow Planning becomes
  reportable"). The model turns it into a structured condition with ``create_watch``; once the user
  confirms, it is stored in ``agentWatches``.
* A CHASER owns a list of assignments to get accepted or completed by a date ("get these 6
  interventions approved by Friday"), nudging whoever is holding each one up, up to an allowance.

Nothing here evaluates conditions: the nightly Cloud Function (functions/src/agentWatches.ts) does,
and posts cards into the user's AI chat (``agentChatMessages``). This module creates, lists and stops
watches, and applies the user's answer when a chaser asks whether to escalate. The document shape is
shared with agentWatches.ts; keep the two in step.

The same rules as agent_actions apply: the model only proposes, the user confirms, and identity comes
from the verified token.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any, Callable

from fastapi import APIRouter, Header, HTTPException
from firebase_admin import firestore
from pydantic import BaseModel

import agent_actions as aa
from agent_actions import ActionError, Actor, Prepared, _norm, _now, _require_company, _slug, _timezone, parse_when

COLLECTION = "agentWatches"
CHAT_COLLECTION = "agentChatMessages"
MAX_ACTIVE_PER_USER = 25
MAX_CHASER_ITEMS = 25
DEFAULT_WATCH_DAYS = 90
MAX_WATCH_DAYS = 365
LEAD_ROLES = ("projectadmin", "projectmanager")

SUBJECTS = {"sme", "intervention_reportable", "assignments_completed"}
RISK_LEVELS = {"high", "medium", "low"}
CONDITION_TYPES = {"risk", "no_session_within_days", "overdue_interventions", "compliance_attention"}
GOALS = {"accepted", "completed"}
CLOSED = {"cancelled", "canceled", "declined", "superseded"}


# --------------------------------------------------------------------------- helpers


def _local_day(value: datetime) -> str:
    return value.astimezone(_timezone()).strftime("%a %d %b %Y")


def _end_of_day(day: Any, label: str) -> datetime:
    text = str(day or "").strip()[:10]
    if not text:
        raise ActionError(f"The {label} is missing.")
    return parse_when(f"{text}T23:59", label)


def _sme_name(row: dict[str, Any]) -> str:
    return str(row.get("businessName") or row.get("participantName") or row.get("beneficiaryName") or "SME")


def _closed(row: dict[str, Any]) -> bool:
    return (_norm(row.get("status")) in CLOSED or _norm(row.get("assigneeStatus")) == "declined"
            or _norm(row.get("participantStatus")) == "declined")


def _completed(row: dict[str, Any]) -> bool:
    """The director dashboard's rule (and agentWatches.ts isAssignmentCompleted)."""
    try:
        progress = float(row.get("progress") or 0)
    except (TypeError, ValueError):
        progress = 0
    return (_norm(row.get("status")) == "completed" or _norm(row.get("completionStatus")) == "completed"
            or (_norm(row.get("assigneeCompletionStatus")) == "done" and _norm(row.get("participantCompletionStatus")) == "confirmed")
            or progress >= 100)


def blocking_parties(row: dict[str, Any], goal: str) -> list[str]:
    """Who is holding an assignment up: 'facilitator' and/or 'sme'. Mirrors agentWatches.ts."""
    if goal == "completed":
        if _completed(row):
            return []
        return ["facilitator"] if _norm(row.get("assigneeCompletionStatus")) != "done" else ["sme"]
    parties = []
    if _norm(row.get("assigneeStatus")) != "accepted":
        parties.append("facilitator")
    if _norm(row.get("participantStatus")) != "accepted":
        parties.append("sme")
    return parties


def _waiting_label(parties: list[str], goal: str) -> str:
    if not parties:
        return "done"
    who = " and ".join("the facilitator" if p == "facilitator" else "the SME" for p in parties)
    return f"waiting on {who} to {'accept' if goal == 'accepted' else 'complete or confirm'}"


def _company_assignments(db: Any, company: str) -> list[dict[str, Any]]:
    return [{**(s.to_dict() or {}), "id": s.id}
            for s in db.collection("assignedInterventions").where("companyCode", "==", company).stream()]


def _active_count(db: Any, actor: Actor) -> int:
    return sum(1 for _ in db.collection(COLLECTION).where("uid", "==", actor.uid).where("status", "==", "active").stream())


def _owned_watch(db: Any, actor: Actor, watch_id: str) -> dict[str, Any]:
    snap = db.collection(COLLECTION).document(str(watch_id or "")).get()
    data = (snap.to_dict() or {}) if snap.exists else None
    if data is None or data.get("uid") != actor.uid or data.get("companyCode") != actor.company_code:
        raise ActionError("I couldn't find that watch.")
    return {**data, "id": snap.id}


def _until(args: dict[str, Any], default_days: int) -> datetime:
    if args.get("until"):
        until = _end_of_day(args["until"], "end date")
    else:
        until = _now() + timedelta(days=default_days)
    if until <= _now():
        raise ActionError("The end date is in the past.")
    # +1 day: the default end is rounded to the end of its day when the proposal is re-checked on confirm.
    if until > _now() + timedelta(days=MAX_WATCH_DAYS + 1):
        raise ActionError("A watch can run for at most a year.")
    return until


# --------------------------------------------------------------------------- read tools


def tool_list_open_assignments(db: Any, actor: Actor, args: dict[str, Any]) -> dict[str, Any]:
    """Assignments still waiting on acceptance or completion, for picking what a chaser should own."""
    company = _require_company(actor)
    waiting_for = _norm(args.get("waitingFor")) or "acceptance"
    goal = "completed" if waiting_for == "completion" else "accepted"
    needle = _norm(args.get("query"))
    out = []
    for row in _company_assignments(db, company):
        if _closed(row) or (actor.role == "consultant" and row.get("assigneeId") != actor.uid):
            continue
        parties = blocking_parties(row, goal)
        if not parties or (goal == "accepted" and _completed(row)):
            continue
        haystack = " ".join(_norm(row.get(k)) for k in ("interventionTitle", "businessName", "participantName", "assigneeName", "programName"))
        if needle and needle not in haystack:
            continue
        out.append({
            "assignmentId": row["id"], "interventionTitle": row.get("interventionTitle"), "smeName": _sme_name(row),
            "assigneeName": row.get("assigneeName"), "programName": row.get("programName"),
            "waitingOn": _waiting_label(parties, goal), "dueDate": aa._iso(row.get("dueDate")),
        })
    out.sort(key=lambda r: (str(r.get("smeName")), str(r.get("interventionTitle"))))
    return {"assignments": out[:40], "total": len(out), "goal": goal}


def tool_list_watches(db: Any, actor: Actor, args: dict[str, Any]) -> dict[str, Any]:
    rows = []
    for snap in db.collection(COLLECTION).where("uid", "==", actor.uid).stream():
        data = snap.to_dict() or {}
        if data.get("companyCode") != actor.company_code:
            continue
        if not args.get("includeFinished") and data.get("status") != "active":
            continue
        row = {"watchId": snap.id, "kind": data.get("kind"), "title": data.get("title"), "status": data.get("status"),
               "request": data.get("request"), "endsAt": aa._iso(data.get("endsAt") or data.get("dueAt"))}
        if data.get("kind") == "chaser":
            items = data.get("items") or []
            row["progress"] = f"{sum(1 for i in items if i.get('done'))} of {len(items)} {data.get('goal') or 'accepted'}"
        rows.append(row)
    return {"watches": rows[:30]}


# --------------------------------------------------------------------------- create_watch


def _clean_conditions(raw: Any) -> list[dict[str, Any]]:
    if not isinstance(raw, list) or not raw:
        raise ActionError("Tell me what to watch for: a risk level, no session booked within some days, overdue interventions or compliance problems.")
    out: list[dict[str, Any]] = []
    for item in raw[:6]:
        kind = _norm((item or {}).get("type")) if isinstance(item, dict) else ""
        if kind not in CONDITION_TYPES:
            raise ActionError("I can watch SMEs for: risk level, no session booked within a number of days, overdue interventions, or compliance documents needing attention.")
        if kind == "risk":
            level = _norm(item.get("level"))
            if level not in RISK_LEVELS:
                raise ActionError("Risk level must be High, Medium or Low.")
            out.append({"type": "risk", "level": level})
        elif kind == "no_session_within_days":
            try:
                days = int(item.get("days") or 14)
            except (TypeError, ValueError) as exc:
                raise ActionError("Give the number of days to look ahead for a booked session.") from exc
            if not 1 <= days <= 90:
                raise ActionError("I can look between 1 and 90 days ahead for a booked session.")
            out.append({"type": kind, "days": days})
        else:
            out.append({"type": kind})
    return out


def _describe_condition(condition: dict[str, Any]) -> str:
    kind = condition["type"]
    if kind == "risk":
        return f"{condition['level'].title()} risk (progress and growth, as on the director dashboard)"
    if kind == "no_session_within_days":
        return f"No session booked in the next {condition['days']} days"
    if kind == "overdue_interventions":
        return "Has an overdue intervention"
    return "Has compliance documents needing attention"


def _resolve_intervention(db: Any, company: str, wanted: str) -> dict[str, Any]:
    wanted_slug = _slug(wanted)
    if not wanted_slug:
        raise ActionError("Which intervention should I watch?")
    catalogue = aa._catalogue(db, company)
    title_of = lambda row: str(row.get("interventionTitle") or row.get("title") or "")  # noqa: E731
    exact = [r for r in catalogue if _norm(r["id"]) == _norm(wanted) or _slug(title_of(r)) == wanted_slug]
    close = exact or [r for r in catalogue if wanted_slug in _slug(title_of(r))]
    if not close:
        raise ActionError(f"I couldn't find an intervention called '{wanted}'.")
    if len(close) > 1:
        names = ", ".join(sorted({title_of(r) for r in close})[:5])
        raise ActionError(f"More than one intervention matches '{wanted}': {names}. Which one?")
    return {"id": close[0]["id"], "title": title_of(close[0]) or wanted}


def prepare_create_watch(db: Any, actor: Actor, args: dict[str, Any]) -> Prepared:
    company = _require_company(actor)
    subject = _norm(args.get("subject")) or "sme"
    if subject not in SUBJECTS:
        raise ActionError("I can watch SMEs, an intervention gathering enough data to show its impact, or a set of assignments being completed.")
    if _active_count(db, actor) >= MAX_ACTIVE_PER_USER:
        raise ActionError(f"You already have {MAX_ACTIVE_PER_USER} active watches and chasers. Stop one first.")
    request = str(args.get("request") or "").strip()[:500]
    title = str(args.get("title") or "").strip()[:80] or (request[:60] if request else "Watch")
    payload: dict[str, Any] = {"subject": subject, "title": title, "request": request}
    summary = [{"label": "Watch", "value": title}]

    if subject == "sme":
        conditions = _clean_conditions(args.get("conditions"))
        filters_in = args.get("filters") if isinstance(args.get("filters"), dict) else {}
        filters = {k: str(filters_in.get(k) or "").strip()[:80] for k in ("city", "province", "programName") if str(filters_in.get(k) or "").strip()}
        ids = [str(i) for i in (filters_in.get("participantIds") or []) if str(i).strip()][:50]
        if ids:
            filters["participantIds"] = ids
        until = _until(args, DEFAULT_WATCH_DAYS)
        payload.update({"conditions": conditions, "filters": filters, "until": until.isoformat()})
        where = ", ".join(f"{v}" for k, v in filters.items() if k != "participantIds") or "All SMEs in your workspace"
        if ids:
            where += f" ({len(ids)} chosen SME{'s' if len(ids) != 1 else ''})"
        if actor.role == "consultant":
            where += ", that you deliver to"
        summary += [{"label": "Which SMEs", "value": where},
                    {"label": "Tell me when", "value": "; and ".join(_describe_condition(c) for c in conditions)},
                    {"label": "Until", "value": _local_day(until)}]
        warnings = ["I check every night and post a card here for each SME that newly matches."]
    elif subject == "intervention_reportable":
        # On confirmation the stored payload carries the resolved id rather than the user's wording.
        intervention = _resolve_intervention(db, company, str(args.get("interventionId") or args.get("intervention") or ""))
        until = _until(args, MAX_WATCH_DAYS)
        payload.update({"interventionId": intervention["id"], "interventionTitle": intervention["title"], "until": until.isoformat()})
        summary += [{"label": "Tell me when", "value": f"{intervention['title']} has enough data on Impact analysis to show its effect on revenue or jobs"},
                    {"label": "Until", "value": _local_day(until)}]
        warnings = ["That is when at least 10 SMEs have completed it (confirmed by the SME) and have monthly figures, and at least 10 comparable SMEs that have not had it can be compared with them. The watch ends once it fires."]
    else:
        ids = [str(i) for i in (args.get("assignmentIds") or []) if str(i).strip()][:MAX_CHASER_ITEMS]
        if not ids:
            raise ActionError("Which interventions should I watch? Look them up first.")
        rows = [aa._company_doc(db, "assignedInterventions", i, company, "intervention") for i in ids]
        until = _until(args, DEFAULT_WATCH_DAYS)
        payload.update({"assignmentIds": [r["id"] for r in rows], "until": until.isoformat()})
        summary += [{"label": "Tell me when", "value": f"All {len(rows)} are complete"},
                    {"label": "Interventions", "value": "; ".join(f"{r.get('interventionTitle') or 'Intervention'} ({_sme_name(r)})" for r in rows[:8])},
                    {"label": "Until", "value": _local_day(until)}]
        warnings = ["The watch ends once they are all complete."]
    return Prepared(title="Start a watch", summary=summary, warnings=warnings, payload=payload)


def execute_create_watch(db: Any, actor: Actor, args: dict[str, Any]) -> dict[str, Any]:
    prepared = prepare_create_watch(db, actor, {**args, "until": str(args.get("until") or "")[:10] or None})
    payload = prepared.payload
    ref = db.collection(COLLECTION).document()
    doc = {
        "uid": actor.uid, "companyCode": actor.company_code, "role": actor.role, "kind": "watch", "status": "active",
        "subject": payload["subject"], "title": payload["title"], "request": payload["request"],
        "endsAt": parse_when(payload["until"]), "notifiedIds": [],
        "createdAt": firestore.SERVER_TIMESTAMP, "updatedAt": firestore.SERVER_TIMESTAMP,
    }
    for key in ("conditions", "filters", "interventionId", "interventionTitle", "assignmentIds"):
        if key in payload:
            doc[key] = payload[key]
    if actor.role == "consultant":
        doc["assigneeId"] = actor.uid
    ref.set(doc)
    return {"watchId": ref.id}


# --------------------------------------------------------------------------- create_chaser


def prepare_create_chaser(db: Any, actor: Actor, args: dict[str, Any]) -> Prepared:
    company = _require_company(actor)
    goal = _norm(args.get("goal")) or "accepted"
    if goal not in GOALS:
        raise ActionError("I can chase interventions to be accepted (by the facilitator and SME) or completed.")
    ids = list(dict.fromkeys(str(i) for i in (args.get("assignmentIds") or []) if str(i).strip()))
    if not ids:
        raise ActionError("Which interventions should I chase? Look them up first.")
    if len(ids) > MAX_CHASER_ITEMS:
        raise ActionError(f"I can chase up to {MAX_CHASER_ITEMS} interventions at a time.")
    due = _end_of_day(args.get("dueDate"), "deadline")
    if due <= _now():
        raise ActionError("The deadline is in the past.")
    try:
        allowance = int(args.get("nudgesEach") if args.get("nudgesEach") is not None else 2)
    except (TypeError, ValueError) as exc:
        raise ActionError("The number of reminders each must be a whole number.") from exc
    if not 1 <= allowance <= 5:
        raise ActionError("I can send between 1 and 5 reminders to each person.")
    if _active_count(db, actor) >= MAX_ACTIVE_PER_USER:
        raise ActionError(f"You already have {MAX_ACTIVE_PER_USER} active watches and chasers. Stop one first.")

    items, lines, already = [], [], 0
    for assignment_id in ids:
        row = aa._company_doc(db, "assignedInterventions", assignment_id, company, "intervention")
        if actor.role == "consultant" and row.get("assigneeId") != actor.uid:
            raise ActionError("You can only chase interventions you deliver.")
        if _closed(row):
            raise ActionError(f"{row.get('interventionTitle') or 'One intervention'} for {_sme_name(row)} was cancelled or declined, so it can't be chased.")
        parties = blocking_parties(row, goal)
        done = not parties
        already += 1 if done else 0
        items.append({
            "assignmentId": row["id"], "title": str(row.get("interventionTitle") or "Intervention"),
            "participantName": _sme_name(row), "assigneeName": str(row.get("assigneeName") or ""),
            "done": done, "nudges": {"facilitator": 0, "sme": 0}, "lastNudgedAt": None,
        })
        lines.append(f"{row.get('interventionTitle') or 'Intervention'} ({_sme_name(row)}): {_waiting_label(parties, goal)}")
    if already == len(items):
        raise ActionError(f"All of those are already {goal}. There is nothing to chase.")

    request = str(args.get("request") or "").strip()[:500]
    title = str(args.get("title") or "").strip()[:80] or f"Get {len(items)} interventions {goal}"
    goal_text = "accepted by the facilitator and the SME" if goal == "accepted" else "completed and confirmed by the SME"
    summary = [
        {"label": "Chase", "value": title},
        {"label": "Goal", "value": f"{len(items)} interventions {goal_text}"},
        {"label": "By", "value": _local_day(due)},
        {"label": "Reminders", "value": f"Up to {allowance} each to whoever is holding an item up, spaced out"},
        {"label": "Interventions", "value": "; ".join(lines[:8]) + (f"; and {len(lines) - 8} more" if len(lines) > 8 else "")},
    ]
    warnings = [
        "Reminders are the same in-app reminders as the Remind button on Intervention monitoring.",
        "I report progress here, ask you before escalating, and stop once everything is done.",
    ]
    if already:
        warnings.append(f"{already} of these {'is' if already == 1 else 'are'} already {goal}.")
    return Prepared(title="Start a chaser", summary=summary, warnings=warnings, payload={
        "goal": goal, "assignmentIds": ids, "dueDate": due.astimezone(_timezone()).strftime("%Y-%m-%d"),
        "nudgesEach": allowance, "title": title, "request": request,
    })


def execute_create_chaser(db: Any, actor: Actor, args: dict[str, Any]) -> dict[str, Any]:
    prepared = prepare_create_chaser(db, actor, args)
    payload = prepared.payload
    company = _require_company(actor)
    items = []
    for assignment_id in payload["assignmentIds"]:
        row = aa._company_doc(db, "assignedInterventions", assignment_id, company, "intervention")
        items.append({
            "assignmentId": row["id"], "title": str(row.get("interventionTitle") or "Intervention"),
            "participantName": _sme_name(row), "assigneeName": str(row.get("assigneeName") or ""),
            "done": not blocking_parties(row, payload["goal"]), "nudges": {"facilitator": 0, "sme": 0}, "lastNudgedAt": None,
        })
    ref = db.collection(COLLECTION).document()
    ref.set({
        "uid": actor.uid, "companyCode": actor.company_code, "role": actor.role, "kind": "chaser", "status": "active",
        "title": payload["title"], "request": payload["request"], "goal": payload["goal"],
        "dueAt": _end_of_day(payload["dueDate"], "deadline"), "endsAt": _end_of_day(payload["dueDate"], "deadline"),
        "nudgesEach": payload["nudgesEach"], "items": items, "escalation": {"status": "none"},
        "createdAt": firestore.SERVER_TIMESTAMP, "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    return {"watchId": ref.id}


# --------------------------------------------------------------------------- stop_watch


def prepare_stop_watch(db: Any, actor: Actor, args: dict[str, Any]) -> Prepared:
    watch = _owned_watch(db, actor, str(args.get("watchId") or ""))
    if watch.get("status") != "active":
        raise ActionError("That one has already finished.")
    kind = "chaser" if watch.get("kind") == "chaser" else "watch"
    return Prepared(title=f"Stop {kind}", summary=[{"label": kind.title(), "value": str(watch.get("title") or kind)}],
                    warnings=[] if kind == "watch" else ["No more reminders will be sent for it."], payload={"watchId": watch["id"]})


def stop_watch(db: Any, actor: Actor, watch_id: str) -> dict[str, Any]:
    watch = _owned_watch(db, actor, watch_id)
    if watch.get("status") == "active":
        db.collection(COLLECTION).document(watch["id"]).update({"status": "stopped", "stoppedAt": firestore.SERVER_TIMESTAMP, "updatedAt": firestore.SERVER_TIMESTAMP})
    return {"watchId": watch["id"], "status": "stopped"}


def execute_stop_watch(db: Any, actor: Actor, args: dict[str, Any]) -> dict[str, Any]:
    prepare_stop_watch(db, actor, args)
    return stop_watch(db, actor, str(args.get("watchId")))


# --------------------------------------------------------------------------- escalation


def answer_escalation(db: Any, actor: Actor, watch_id: str, decision: str) -> dict[str, Any]:
    """The user's answer to a chaser's "shall I escalate?" card. Escalating tells the programme leads."""
    watch = _owned_watch(db, actor, watch_id)
    if watch.get("kind") != "chaser":
        raise ActionError("Only chasers can be escalated.")
    escalation = watch.get("escalation") or {}
    if escalation.get("status") in ("escalated", "declined"):
        raise ActionError(f"You already chose to {'escalate' if escalation['status'] == 'escalated' else 'not escalate'} this one.")
    if escalation.get("status") != "asked":
        raise ActionError("This chaser hasn't asked to escalate yet.")
    decision = _norm(decision)
    if decision not in ("escalate", "decline"):
        raise ActionError("Choose to escalate or not.")
    company = _require_company(actor)
    batch = db.batch()
    outstanding = [i for i in (watch.get("items") or []) if not i.get("done")]
    leads: list[str] = []
    if decision == "escalate":
        for snap in db.collection("users").where("companyCode", "==", company).stream():
            data = snap.to_dict() or {}
            if _norm(data.get("role")) in LEAD_ROLES and snap.id != actor.uid:
                leads.append(snap.id)
        if not leads:
            raise ActionError("There is no project admin or project manager in your workspace to escalate to.")
        by = actor.name or actor.email or "A colleague"
        body = "\n".join(f"{i.get('title')} ({i.get('participantName')})" for i in outstanding[:8])
        for uid in leads[:20]:
            batch.set(db.collection("staffNotifications").document(), {
                "recipientUid": uid, "companyCode": company, "type": "agent_chaser_escalation",
                "title": f"{by} escalated: {len(outstanding)} intervention{'s' if len(outstanding) != 1 else ''} still {watch.get('goal') or 'waiting'}",
                "body": body, "link": "/operations/interventions/monitoring", "watchId": watch["id"],
                "readAt": None, "createdAt": firestore.SERVER_TIMESTAMP,
            })
    status = "escalated" if decision == "escalate" else "declined"
    batch.update(db.collection(COLLECTION).document(watch["id"]), {
        "escalation.status": status, "escalation.resolvedAt": firestore.SERVER_TIMESTAMP,
        "escalation.leadCount": len(leads), "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    message_id = escalation.get("messageId")
    if message_id:
        batch.update(db.collection(CHAT_COLLECTION).document(str(message_id)), {"card.response": status})
    batch.commit()
    reply = (f"I've escalated {len(outstanding)} outstanding intervention{'s' if len(outstanding) != 1 else ''} to {len(leads)} programme lead{'s' if len(leads) != 1 else ''}."
             if decision == "escalate" else "Okay, I won't escalate. I'll keep chasing until the deadline.")
    return {"status": status, "reply": reply, "leads": len(leads)}


# --------------------------------------------------------------------------- registry and routes


_READ_PERMS = ("assign_interventions", "track_interventions", "view_participants")
_CHASE_PERMS = ("assign_interventions", "track_interventions")

WATCH_TOOLS = [
    aa.Tool("list_open_assignments", "read",
            "List interventions still waiting on acceptance (facilitator/SME) or completion, across the workspace. Use it to find the assignmentIds a chaser should own.",
            '{"waitingFor"?: "acceptance"|"completion", "query"?: "SME, intervention, facilitator or programme name"}', _READ_PERMS, run=tool_list_open_assignments),
    aa.Tool("list_watches", "read", "List the user's own watches and chasers (gives watchId) with their progress.",
            '{"includeFinished"?: true}', _READ_PERMS, run=tool_list_watches),
    aa.Tool("create_watch", "write",
            "Start a nightly WATCH that posts a card in this chat when a condition is met. subject 'sme': SMEs matching filters AND all conditions "
            "(condition types: risk {level: high|medium|low}, no_session_within_days {days}, overdue_interventions, compliance_attention). "
            "subject 'intervention_reportable': when an intervention's impact becomes reportable (give its name in 'intervention'). "
            "subject 'assignments_completed': when all listed assignments are complete. request = the user's own words; title = a short name.",
            '{"subject": "sme"|"intervention_reportable"|"assignments_completed", "request", "title", "filters"?: {"city"?, "province"?, "programName"?, "participantIds"?: []}, '
            '"conditions"?: [{"type", ...}], "intervention"?: "name", "assignmentIds"?: [], "until"?: "YYYY-MM-DD"}',
            _READ_PERMS, prepare=prepare_create_watch, execute=execute_create_watch),
    aa.Tool("create_chaser", "write",
            "Start a CHASER that owns a list of interventions and gets them accepted (goal 'accepted': facilitator and SME accept) or completed (goal 'completed') by a date, "
            "sending in-app reminders to whoever is holding each up, up to nudgesEach (default 2) per person. It reports progress and asks before escalating. "
            "Find assignmentIds with list_open_assignments first; never guess them.",
            '{"assignmentIds": [], "goal": "accepted"|"completed", "dueDate": "YYYY-MM-DD", "nudgesEach"?: 1-5, "request", "title"}',
            _CHASE_PERMS, prepare=prepare_create_chaser, execute=execute_create_chaser),
    aa.Tool("stop_watch", "write", "Stop one of the user's watches or chasers (find it with list_watches).",
            '{"watchId"}', _READ_PERMS, prepare=prepare_stop_watch, execute=execute_stop_watch),
]

PROMPT_RULES = (
    "- Watches and chasers: when the user asks to be told / alerted / kept posted when something happens, use create_watch. "
    "When they ask you to get a set of interventions approved, accepted or completed by a date, use create_chaser "
    "('approved' means accepted unless they say completed). Map their words onto the supported conditions only; if part of "
    "what they ask can't be checked, say which part and offer the closest watch. Watches are checked every night, not instantly.\n"
)


class EscalationAnswer(BaseModel):
    decision: str


def create_agent_watches_router(db: Any, authenticate: Callable[[str | None], Any]) -> APIRouter:
    router = APIRouter()

    def _actor(authorization: str | None) -> Actor:
        return aa.build_actor(db, authenticate(authorization))

    @router.post("/api/agent/watches/{watch_id}/stop")
    def stop(watch_id: str, authorization: str | None = Header(default=None)) -> dict[str, Any]:
        actor = _actor(authorization)
        try:
            return {"ok": True, **stop_watch(db, actor, watch_id)}
        except ActionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    @router.post("/api/agent/watches/{watch_id}/escalation")
    def escalation(watch_id: str, answer: EscalationAnswer, authorization: str | None = Header(default=None)) -> dict[str, Any]:
        actor = _actor(authorization)
        try:
            return {"ok": True, **answer_escalation(db, actor, watch_id, answer.decision)}
        except ActionError as exc:
            raise HTTPException(status_code=409, detail=str(exc)) from exc

    return router
