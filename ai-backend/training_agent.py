"""AI for the awareness-training client module (see client_modules.py and src/pages/training/).

Three things live here:

* Assistant tools for the training staff (projectadmin / operations of a company with awareness training switched
  on). They plug into the confirm-before-write framework in agent_actions.py with their own permission and scope, so
  they never show up in the incubation assistant and the incubation tools never show up here. Read tools return
  data to the model; write tools only prepare a proposal the facilitator confirms on a card.
* ``POST /api/training/draft-assessment``: knowledge questions with memo answers, written from library documents,
  for the facilitator to edit in the assessment editor before saving.
* ``POST /api/training/funder-summary``: a short narrative of the funder report's totals.

Learners, client companies and funders never get the tools. Tool results carry learners' names and organisations
only: no emails, phone or ID numbers.
"""

from __future__ import annotations

import math
import re
from datetime import date, datetime, timedelta
from typing import Any, Callable

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field

import agent_actions as aa
from client_modules import AWARENESS_TRAINING_SETTING, company_record
from esg_report_agent import figures_in, unmatched_figures

TRAINING_PERMISSION = "manage_training"
TRAINING_SCOPE = "training"
STAFF_ROLES = ("projectadmin", "operations")

CLASSES = "trainingClasses"
LEARNERS = "trainingLearners"
SUBMISSIONS = "trainingSubmissions"
GROUPS = "trainingGroups"
ASSESSMENTS = "trainingAssessments"
SURVEYS = "trainingSurveys"
RESPONSES = "trainingSurveyResponses"
LIBRARY = "trainingLibrary"
LIBRARY_TEXTS = "trainingLibraryTexts"

MAX_LEARNERS = 200
MAX_LIST = 50


def training_enabled(db: Any, company_code: str | None) -> bool:
    return company_record(db, company_code).get(AWARENESS_TRAINING_SETTING) is True


def training_permissions(db: Any, identity: Any) -> set[str]:
    """Permission source for agent_actions.build_actor: training staff of a company that runs awareness training."""
    if getattr(identity, "is_service", False) or getattr(identity, "role", None) not in STAFF_ROLES:
        return set()
    return {TRAINING_PERMISSION} if training_enabled(db, getattr(identity, "company_code", None)) else set()


# --------------------------------------------------------------------------- helpers


def _now_local() -> datetime:
    return datetime.now(aa._timezone())


def _iso_now() -> str:
    return aa._now().isoformat().replace("+00:00", "Z")


def _company(actor: aa.Actor) -> str:
    return aa._require_company(actor)


def _rows(db: Any, collection: str, company: str, **filters: Any) -> list[dict[str, Any]]:
    query = db.collection(collection).where("companyCode", "==", company)
    for field, value in filters.items():
        query = query.where(field, "==", value)
    return [{**(snap.to_dict() or {}), "id": snap.id} for snap in query.stream()]


def _doc(db: Any, collection: str, doc_id: Any, company: str, label: str) -> dict[str, Any]:
    doc_id = str(doc_id or "").strip()
    if not doc_id:
        raise aa.ActionError(f"Which {label}? I need to look it up first.")
    snap = db.collection(collection).document(doc_id).get()
    data = (snap.to_dict() or {}) if snap.exists else None
    if not data or data.get("companyCode") != company:
        raise aa.ActionError(f"I couldn't find that {label}.")
    return {**data, "id": doc_id}


def _start(trainingClass: dict[str, Any]) -> date | None:
    try:
        return date.fromisoformat(str(trainingClass.get("startDate") or ""))
    except ValueError:
        return None


def _day_count(trainingClass: dict[str, Any]) -> int:
    try:
        return max(1, int(trainingClass.get("dayCount") or 1))
    except (TypeError, ValueError):
        return 1


def _end(trainingClass: dict[str, Any]) -> date | None:
    start = _start(trainingClass)
    return start + timedelta(days=_day_count(trainingClass) - 1) if start else None


def class_phase(trainingClass: dict[str, Any], now: datetime | None = None) -> str:
    """Same rule as classPhase in src/utils/trainingResults.ts: finished once the last day's end time has passed."""
    now = now or _now_local()
    start, end = _start(trainingClass), _end(trainingClass)
    if not start or not end:
        return "unknown"
    today = now.date()
    if today < start:
        return "upcoming"
    if today > end:
        return "finished"
    day_hours = trainingClass.get("dayHours") if isinstance(trainingClass.get("dayHours"), dict) else {}
    last = day_hours.get(str(_day_count(trainingClass))) or trainingClass.get("hours")
    if today == end and isinstance(last, dict) and last.get("end") and now.strftime("%H:%M") >= str(last["end"]):
        return "finished"
    return "running"


def _dates_label(trainingClass: dict[str, Any]) -> str:
    start, end = _start(trainingClass), _end(trainingClass)
    if not start or not end:
        return "dates not set"
    if start == end:
        return start.strftime("%d %b %Y").lstrip("0")
    return f"{start.strftime('%d %b').lstrip('0')} – {end.strftime('%d %b %Y').lstrip('0')}"


def _class_label(trainingClass: dict[str, Any]) -> str:
    return f"{trainingClass.get('courseTitle') or 'Class'} ({_dates_label(trainingClass)})"


def assessment_id_for(trainingClass: dict[str, Any], kind: str) -> str | None:
    if kind == "pre":
        return trainingClass.get("preAssessmentId") or trainingClass.get("assessmentId") or None
    return trainingClass.get("assessmentId") or None


def _best_marked(submissions: list[dict[str, Any]]) -> float | None:
    scores = [s["scorePct"] for s in submissions if s.get("status") == "marked" and isinstance(s.get("scorePct"), (int, float))]
    return max(scores) if scores else None


def learner_result(trainingClass: dict[str, Any], learner: dict[str, Any], submissions: list[dict[str, Any]], groups: list[dict[str, Any]]) -> dict[str, Any]:
    """Port of learnerResult in src/utils/trainingResults.ts: where a learner stands against the class's pass rule."""
    own = [s for s in submissions if s.get("learnerId") == learner["id"]]
    posts = [s for s in own if s.get("kind") == "post"]
    pre = _best_marked([s for s in own if s.get("kind") == "pre"])
    post = _best_marked(posts)
    awaiting = any(s.get("status") == "submitted" for s in posts)
    group = next((g for g in groups if learner["id"] in (g.get("learnerIds") or [])), None)
    group_marked = bool(group and group.get("markedAt"))
    participated = group_marked and learner["id"] not in (group.get("absentLearnerIds") or [])
    satisfied = not trainingClass.get("groupAssignmentRequired") or participated
    pass_mark = float(trainingClass.get("passMarkPct") or 0)
    allowed = 1 + max(0, int(trainingClass.get("reassessmentsAllowed") or 0))

    if post is None:
        status = "awaiting_marking" if awaiting else "not_started"
    elif post >= pass_mark:
        status = "passed" if satisfied else ("not_passed" if group_marked else "awaiting_group")
    elif awaiting:
        status = "awaiting_marking"
    elif len(posts) < allowed:
        status = "reassessment_available"
    else:
        status = "not_passed"
    return {"preScorePct": pre, "postScorePct": post, "postAttempts": len(posts), "groupParticipated": participated, "status": status}


def _attendance(learner: dict[str, Any]) -> dict[str, Any]:
    marks = learner.get("attendance")
    return marks if isinstance(marks, dict) else {}


def _id_copy_status(learner: dict[str, Any]) -> str:
    document = learner.get("idDocument")
    return str(document.get("status") or "pending") if isinstance(document, dict) else "missing"


def _average(values: list[float]) -> float | None:
    return round(sum(values) / len(values), 1) if values else None


def _names(learners: list[dict[str, Any]], limit: int = 8) -> str:
    names = [str(learner.get("name") or "Learner") for learner in learners]
    if not names:
        return "nobody"
    shown = ", ".join(names[:limit])
    return f"{shown} and {len(names) - limit} more" if len(names) > limit else shown


# --------------------------------------------------------------------------- read tools


def tool_list_training_classes(db: Any, actor: aa.Actor, args: dict[str, Any]) -> dict[str, Any]:
    company = _company(actor)
    query = aa._norm(args.get("query"))
    phase_wanted = aa._norm(args.get("phase"))
    classes = _rows(db, CLASSES, company)
    learners = _rows(db, LEARNERS, company)
    assessments = {a["id"]: a.get("title") or "Assessment" for a in _rows(db, ASSESSMENTS, company)}
    now = _now_local()
    out = []
    for trainingClass in sorted(classes, key=lambda c: str(c.get("startDate") or ""), reverse=True):
        phase = class_phase(trainingClass, now)
        if phase_wanted and phase != phase_wanted:
            continue
        if query and query not in aa._norm(trainingClass.get("courseTitle")) and query not in aa._norm(trainingClass.get("venue")):
            continue
        own = [learner for learner in learners if learner.get("classId") == trainingClass["id"]]
        tests = trainingClass.get("testsOpen") if isinstance(trainingClass.get("testsOpen"), dict) else {}
        out.append({
            "classId": trainingClass["id"],
            "course": trainingClass.get("courseTitle"),
            "dates": _dates_label(trainingClass),
            "startDate": trainingClass.get("startDate"),
            "days": _day_count(trainingClass),
            "phase": phase,
            "deliveryMode": trainingClass.get("deliveryMode"),
            "venue": trainingClass.get("venue") or None,
            "learners": len(own),
            "passMarkPct": trainingClass.get("passMarkPct"),
            "preAssessment": assessments.get(assessment_id_for(trainingClass, "pre") or "") or None,
            "postAssessment": assessments.get(assessment_id_for(trainingClass, "post") or "") or None,
            "preOpen": tests.get("pre") is True,
            "postOpen": tests.get("post") is True,
        })
    return {"today": now.date().isoformat(), "classes": out[:25], "total": len(out)}


def tool_get_class_results(db: Any, actor: aa.Actor, args: dict[str, Any]) -> dict[str, Any]:
    company = _company(actor)
    trainingClass = _doc(db, CLASSES, args.get("classId"), company, "class")
    learners = _rows(db, LEARNERS, company, classId=trainingClass["id"])[:MAX_LEARNERS]
    submissions = _rows(db, SUBMISSIONS, company, classId=trainingClass["id"])
    groups = _rows(db, GROUPS, company, classId=trainingClass["id"])
    days = [str(day) for day in range(1, _day_count(trainingClass) + 1)]

    rows = []
    for learner in sorted(learners, key=lambda l: (str(l.get("organisation") or ""), str(l.get("name") or ""))):
        result = learner_result(trainingClass, learner, submissions, groups)
        marks = _attendance(learner)
        rows.append({
            "learnerId": learner["id"],
            "name": learner.get("name"),
            "organisation": learner.get("organisation") or "Not given",
            "daysPresent": sum(1 for day in days if isinstance(marks.get(day), dict) and marks[day].get("present") is True),
            "daysAbsent": sum(1 for day in days if isinstance(marks.get(day), dict) and marks[day].get("present") is False),
            **result,
            "idCopy": _id_copy_status(learner),
            "certified": bool(learner.get("certificateId")),
            "hasAccount": bool(learner.get("uid")),
        })

    statuses: dict[str, int] = {}
    for row in rows:
        statuses[row["status"]] = statuses.get(row["status"], 0) + 1
    organisations: dict[str, dict[str, int]] = {}
    for row in rows:
        entry = organisations.setdefault(row["organisation"], {"learners": 0, "passed": 0})
        entry["learners"] += 1
        entry["passed"] += row["status"] == "passed"
    attendance = []
    for day in days:
        marked = [_attendance(l).get(day) for l in learners if isinstance(_attendance(l).get(day), dict)]
        attendance.append({"day": int(day), "present": sum(1 for m in marked if m.get("present") is True), "absent": sum(1 for m in marked if m.get("present") is False), "notMarked": len(learners) - len(marked)})
    tests = trainingClass.get("testsOpen") if isinstance(trainingClass.get("testsOpen"), dict) else {}
    return {
        "class": {
            "classId": trainingClass["id"], "course": trainingClass.get("courseTitle"), "dates": _dates_label(trainingClass),
            "phase": class_phase(trainingClass), "passMarkPct": trainingClass.get("passMarkPct"),
            "reassessmentsAllowed": trainingClass.get("reassessmentsAllowed") or 0,
            "groupAssignmentRequired": bool(trainingClass.get("groupAssignmentRequired")),
            "preOpen": tests.get("pre") is True, "postOpen": tests.get("post") is True,
        },
        "totals": {
            "learners": len(rows), "byStatus": statuses,
            "averagePrePct": _average([r["preScorePct"] for r in rows if r["preScorePct"] is not None]),
            "averagePostPct": _average([r["postScorePct"] for r in rows if r["postScorePct"] is not None]),
            "awaitingMarking": sum(1 for s in submissions if s.get("status") == "submitted"),
        },
        "byOrganisation": [{"organisation": name, **counts} for name, counts in organisations.items()],
        "attendanceByDay": attendance,
        "learners": rows,
    }


def tool_list_marking_backlog(db: Any, actor: aa.Actor, args: dict[str, Any]) -> dict[str, Any]:
    company = _company(actor)
    waiting = _rows(db, SUBMISSIONS, company, status="submitted")
    classes = {c["id"]: c for c in _rows(db, CLASSES, company)}
    learners = {l["id"]: l for l in _rows(db, LEARNERS, company)}
    waiting.sort(key=lambda s: str(s.get("submittedAt") or ""))
    items = [{
        "classId": s.get("classId"),
        "class": _class_label(classes[s["classId"]]) if s.get("classId") in classes else "Class",
        "learner": (learners.get(s.get("learnerId")) or {}).get("name") or "Learner",
        "test": "pre-assessment" if s.get("kind") == "pre" else ("post-assessment" if (s.get("attempt") or 1) <= 1 else f"reassessment {int(s['attempt']) - 1}"),
        "submittedAt": aa._iso(s.get("submittedAt")),
    } for s in waiting[:MAX_LIST]]
    return {"total": len(waiting), "submissions": items}


def tool_list_id_copies(db: Any, actor: aa.Actor, args: dict[str, Any]) -> dict[str, Any]:
    company = _company(actor)
    wanted = aa._norm(args.get("status")) or "pending"
    if wanted not in ("pending", "queried", "verified", "missing"):
        raise aa.ActionError("I can list ID copies that are pending, queried, verified or missing.")
    class_id = str(args.get("classId") or "").strip()
    classes = {c["id"]: c for c in _rows(db, CLASSES, company)}
    if class_id and class_id not in classes:
        raise aa.ActionError("I couldn't find that class.")
    learners = _rows(db, LEARNERS, company, **({"classId": class_id} if class_id else {}))
    phase_of = {cid: class_phase(c) for cid, c in classes.items()}
    matches = [l for l in learners if _id_copy_status(l) == wanted]
    # Running and upcoming classes first: those copies can still be chased.
    order = {"running": 0, "upcoming": 1, "finished": 2}
    matches.sort(key=lambda l: (order.get(phase_of.get(l.get("classId"), ""), 3), str(l.get("name") or "")))
    by_phase: dict[str, int] = {}
    for learner in matches:
        phase = phase_of.get(learner.get("classId"), "unknown")
        by_phase[phase] = by_phase.get(phase, 0) + 1
    return {
        "status": wanted,
        "scope": "one class" if class_id else "all classes",
        "learnersChecked": len(learners),
        "classesChecked": 1 if class_id else len({l.get("classId") for l in learners}),
        "total": len(matches),
        "byClassPhase": by_phase,
        "learners": [{
            "learnerId": l["id"], "name": l.get("name"), "organisation": l.get("organisation") or "Not given",
            "class": _class_label(classes[l["classId"]]) if l.get("classId") in classes else "Class",
            "classPhase": phase_of.get(l.get("classId"), "unknown"),
            **({"note": l["idDocument"].get("note")} if wanted == "queried" and l["idDocument"].get("note") else {}),
        } for l in matches[:MAX_LIST]],
    }


def tool_list_organisation_results(db: Any, actor: aa.Actor, args: dict[str, Any]) -> dict[str, Any]:
    company = _company(actor)
    query = aa._norm(args.get("query"))
    learners = _rows(db, LEARNERS, company)
    totals: dict[str, dict[str, Any]] = {}
    for learner in learners:
        name = str(learner.get("organisation") or "Not given")
        if query and query not in aa._norm(name):
            continue
        entry = totals.setdefault(name, {"organisation": name, "learners": 0, "certified": 0, "classes": set()})
        entry["learners"] += 1
        entry["certified"] += bool(learner.get("certificateId"))
        entry["classes"].add(learner.get("classId"))
    rows = sorted(({**e, "classes": len(e["classes"])} for e in totals.values()), key=lambda e: e["learners"], reverse=True)
    return {"organisations": rows[:MAX_LIST], "total": len(rows)}


def tool_get_survey_results(db: Any, actor: aa.Actor, args: dict[str, Any]) -> dict[str, Any]:
    company = _company(actor)
    survey_id = str(args.get("surveyId") or "").strip()
    if not survey_id:
        surveys = _rows(db, SURVEYS, company)
        responses = _rows(db, RESPONSES, company)
        return {"surveys": [{
            "surveyId": s["id"], "title": s.get("title"), "audience": s.get("audience"), "status": s.get("status"),
            "responses": sum(1 for r in responses if r.get("surveyId") == s["id"]),
        } for s in sorted(surveys, key=lambda s: str(s.get("createdAt") or ""), reverse=True)[:MAX_LIST]]}

    survey = _doc(db, SURVEYS, survey_id, company, "survey")
    responses = _rows(db, RESPONSES, company, surveyId=survey_id)
    questions = []
    for question in survey.get("questions") or []:
        if not isinstance(question, dict):
            continue
        answers = [r.get("answers", {}).get(question.get("id")) for r in responses if isinstance(r.get("answers"), dict)]
        answers = [a for a in answers if a not in (None, "")]
        kind = question.get("type")
        row: dict[str, Any] = {"question": question.get("text"), "type": kind, "answered": len(answers)}
        if kind == "rating":
            ratings = [float(a) for a in answers if isinstance(a, (int, float))]
            row["averageOutOf5"] = _average(ratings)
        elif kind in ("choice", "yesno"):
            counts: dict[str, int] = {}
            for answer in answers:
                counts[str(answer)] = counts.get(str(answer), 0) + 1
            row["counts"] = counts
        else:
            # Comments only, without names.
            row["comments"] = [str(a)[:300] for a in answers[:12]]
        questions.append(row)
    return {"survey": {"title": survey.get("title"), "audience": survey.get("audience"), "status": survey.get("status")}, "responses": len(responses), "questions": questions}


# --------------------------------------------------------------------------- write tools


def _as_bool(value: Any) -> bool | None:
    if isinstance(value, bool):
        return value
    text = aa._norm(value)
    return True if text in ("true", "open", "yes", "1") else False if text in ("false", "close", "closed", "no", "0") else None


def _test_kind(value: Any) -> str:
    kind = aa._norm(value).replace("-", "").replace("assessment", "").replace("test", "").strip()
    if kind not in ("pre", "post"):
        raise aa.ActionError("Is that the pre-assessment or the post-assessment?")
    return kind


def prepare_set_assessment_open(db: Any, actor: aa.Actor, args: dict[str, Any]) -> aa.Prepared:
    company = _company(actor)
    trainingClass = _doc(db, CLASSES, args.get("classId"), company, "class")
    kind = _test_kind(args.get("test"))
    want_open = _as_bool(args.get("open"))
    if want_open is None:
        raise aa.ActionError("Should I open it or close it?")
    label = "pre-assessment" if kind == "pre" else "post-assessment"
    if want_open and not assessment_id_for(trainingClass, kind):
        raise aa.ActionError(f"This class has no {label} chosen yet. Choose one on the class page first.")
    tests = trainingClass.get("testsOpen") if isinstance(trainingClass.get("testsOpen"), dict) else {}
    if (tests.get(kind) is True) == want_open:
        raise aa.ActionError(f"The {label} is already {'open' if want_open else 'closed'} for this class.")
    warnings = []
    if want_open and kind == "post" and class_phase(trainingClass) == "upcoming":
        warnings.append("This class hasn't started yet.")
    return aa.Prepared(
        title=f"{'Open' if want_open else 'Close'} the {label}",
        summary=[
            {"label": "Class", "value": _class_label(trainingClass)},
            {"label": "What happens", "value": f"Learners can start the {label} online." if want_open else f"Learners can no longer start the {label}; attempts already started can still be handed in."},
        ],
        warnings=warnings,
        payload={"classId": trainingClass["id"], "test": kind, "open": want_open},
    )


def execute_set_assessment_open(db: Any, actor: aa.Actor, args: dict[str, Any]) -> dict[str, Any]:
    prepared = prepare_set_assessment_open(db, actor, args)
    payload = prepared.payload
    db.collection(CLASSES).document(payload["classId"]).update({
        f"testsOpen.{payload['test']}": payload["open"], "updatedAt": _iso_now(), "updatedBy": actor.uid,
    })
    return {"classId": payload["classId"], "test": payload["test"], "open": payload["open"]}


def _id_list(value: Any) -> list[str] | None:
    if value is None:
        return None
    if not isinstance(value, list):
        raise aa.ActionError("Give the learners as a list.")
    return [str(item).strip() for item in value if str(item).strip()]


def prepare_record_attendance(db: Any, actor: aa.Actor, args: dict[str, Any]) -> aa.Prepared:
    company = _company(actor)
    trainingClass = _doc(db, CLASSES, args.get("classId"), company, "class")
    try:
        day = int(args.get("day"))
    except (TypeError, ValueError) as exc:
        raise aa.ActionError("Which training day is this for (1 for the first day)?") from exc
    if day < 1 or day > _day_count(trainingClass):
        raise aa.ActionError(f"This class has {_day_count(trainingClass)} training day(s).")
    start = _start(trainingClass)
    day_date = start + timedelta(days=day - 1) if start else None
    if day_date and day_date > _now_local().date():
        raise aa.ActionError(f"Day {day} of this class is on {day_date.strftime('%d %b %Y').lstrip('0')}, which hasn't happened yet.")

    learners = {l["id"]: l for l in _rows(db, LEARNERS, company, classId=trainingClass["id"])}
    present_given, absent = _id_list(args.get("presentLearnerIds")), set(_id_list(args.get("absentLearnerIds")) or [])
    if present_given is None and not absent and args.get("everyonePresent") is not True:
        raise aa.ActionError("Who was absent? Or was everyone there?")
    present = set(present_given) if present_given is not None else set(learners) - absent
    unknown = (present | absent) - set(learners)
    if unknown:
        raise aa.ActionError("Some of those learners are not in this class. Look them up with get_class_results.")
    if present & absent:
        raise aa.ActionError("A learner can't be both present and absent.")

    overwrite = args.get("overwrite") is True
    already = {lid for lid in present | absent if isinstance(_attendance(learners[lid]).get(str(day)), dict)}
    if not overwrite:
        present, absent = present - already, absent - already
    if not present and not absent:
        raise aa.ActionError(f"Everyone named already has a mark for day {day}. Say so if you want me to replace them.")

    mode = aa._norm(args.get("mode")).replace(" ", "_").replace("-", "_") or None
    if trainingClass.get("deliveryMode") != "hybrid":
        mode = None
    elif mode and mode not in ("in_person", "online"):
        raise aa.ActionError("Did they attend in person or online?")

    order = lambda ids: sorted((learners[i] for i in ids), key=lambda l: str(l.get("name") or ""))
    summary = [
        {"label": "Class", "value": _class_label(trainingClass)},
        {"label": "Day", "value": f"Day {day}" + (f" ({day_date.strftime('%a %d %b').replace(' 0', ' ')})" if day_date else "")},
        {"label": f"Present ({len(present)})", "value": _names(order(present))},
    ]
    if absent:
        summary.append({"label": f"Absent ({len(absent)})", "value": _names(order(absent))})
    if mode:
        summary.append({"label": "Attended", "value": "In person" if mode == "in_person" else "Online"})
    warnings = []
    skipped = already - present - absent
    if skipped:
        warnings.append(f"{len(skipped)} learner(s) already marked for day {day} are left as they are.")
    elif overwrite and already:
        warnings.append(f"This replaces the marks already recorded for {len(already)} learner(s).")
    return aa.Prepared(
        title=f"Record attendance for day {day}",
        summary=summary,
        warnings=warnings,
        payload={"classId": trainingClass["id"], "day": day, "presentLearnerIds": sorted(present), "absentLearnerIds": sorted(absent), "mode": mode, "overwrite": overwrite},
    )


def execute_record_attendance(db: Any, actor: aa.Actor, args: dict[str, Any]) -> dict[str, Any]:
    prepared = prepare_record_attendance(db, actor, args)
    payload = prepared.payload
    stamp = _iso_now()
    batch = db.batch()
    for learner_id, present in [(i, True) for i in payload["presentLearnerIds"]] + [(i, False) for i in payload["absentLearnerIds"]]:
        mark = {"present": present, "recordedAt": stamp, "recordedBy": "facilitator", **({"mode": payload["mode"]} if present and payload["mode"] else {})}
        batch.update(db.collection(LEARNERS).document(learner_id), {f"attendance.{payload['day']}": mark, "updatedAt": stamp, "updatedBy": actor.uid})
    batch.commit()
    return {"classId": payload["classId"], "day": payload["day"], "present": len(payload["presentLearnerIds"]), "absent": len(payload["absentLearnerIds"])}


def prepare_review_id_copy(db: Any, actor: aa.Actor, args: dict[str, Any]) -> aa.Prepared:
    company = _company(actor)
    learner = _doc(db, LEARNERS, args.get("learnerId"), company, "learner")
    status = aa._norm(args.get("status"))
    if status not in ("verified", "queried"):
        raise aa.ActionError("Should the ID copy be verified or queried?")
    document = learner.get("idDocument")
    if not isinstance(document, dict):
        raise aa.ActionError(f"{learner.get('name') or 'This learner'} hasn't uploaded an ID copy yet.")
    if document.get("status") == status:
        raise aa.ActionError(f"That ID copy is already {status}.")
    note = str(args.get("note") or "").strip()[:500]
    if status == "queried" and not note:
        raise aa.ActionError("What should the learner fix? The note is shown to them.")
    summary = [
        {"label": "Learner", "value": str(learner.get("name") or "Learner")},
        {"label": "Organisation", "value": str(learner.get("organisation") or "Not given")},
        {"label": "Uploaded", "value": str(document.get("uploadedAt") or "")[:10] or "Unknown"},
    ]
    if note:
        summary.append({"label": "Note", "value": note})
    return aa.Prepared(
        title="Verify ID copy" if status == "verified" else "Query ID copy",
        summary=summary,
        warnings=["Only confirm if you have opened and checked the copy yourself. I can't see ID documents."] if status == "verified" else [],
        payload={"learnerId": learner["id"], "status": status, "note": note},
    )


def execute_review_id_copy(db: Any, actor: aa.Actor, args: dict[str, Any]) -> dict[str, Any]:
    prepared = prepare_review_id_copy(db, actor, args)
    payload = prepared.payload
    stamp = _iso_now()
    db.collection(LEARNERS).document(payload["learnerId"]).update({
        "idDocument.status": payload["status"], "idDocument.note": payload["note"] or None,
        "idDocument.reviewedAt": stamp, "idDocument.reviewedBy": actor.uid, "updatedAt": stamp, "updatedBy": actor.uid,
    })
    return {"learnerId": payload["learnerId"], "status": payload["status"]}


def _tool(name: str, kind: str, description: str, arguments: str, **fns: Callable[..., Any]) -> aa.Tool:
    return aa.Tool(name, kind, description, arguments, (TRAINING_PERMISSION,), scope=TRAINING_SCOPE, **fns)


TRAINING_TOOLS: list[aa.Tool] = [
    _tool("list_training_classes", "read", "List classes (gives classId) with dates, phase (upcoming, running, finished), learner count, assessments and whether each test is open.",
          '{"query"?: "course or venue", "phase"?: "upcoming"|"running"|"finished"}', run=tool_list_training_classes),
    _tool("get_class_results", "read", "One class in full: each learner (gives learnerId) with organisation, days present, pre and best post score, pass status, ID copy and certificate; totals by status and organisation; attendance per day.",
          '{"classId"}', run=tool_get_class_results),
    _tool("list_marking_backlog", "read", "Assessments handed in and waiting to be marked, oldest first.", "{}", run=tool_list_marking_backlog),
    _tool("list_id_copies", "read", "Learners whose ID copy is pending review (default), queried, verified or missing (never uploaded), across ALL classes unless a classId is given. Each row gives the class and its phase.",
          '{"status"?: "pending"|"queried"|"verified"|"missing", "classId"?}', run=tool_list_id_copies),
    _tool("list_organisation_results", "read", "Client organisations with learners trained, certified and classes attended, across all classes.",
          '{"query"?: "organisation name"}', run=tool_list_organisation_results),
    _tool("get_survey_results", "read", "Without surveyId: the surveys with response counts (gives surveyId). With surveyId: each question's average rating, choice counts or written comments (no names).",
          '{"surveyId"?}', run=tool_get_survey_results),
    _tool("set_assessment_open", "write", "Open a class's pre- or post-assessment so learners can start it online, or close it.",
          '{"classId","test": "pre"|"post","open": true|false}', prepare=prepare_set_assessment_open, execute=execute_set_assessment_open),
    _tool("record_attendance", "write",
          "Record one training day's register. Give absentLearnerIds to mark everyone else present, presentLearnerIds to mark only those present, or everyonePresent:true. "
          "Learners already marked that day are left alone unless overwrite:true. mode only for hybrid classes.",
          '{"classId","day": 1-based number,"absentLearnerIds"?: [learnerId],"presentLearnerIds"?: [learnerId],"everyonePresent"?: true,"mode"?: "in_person"|"online","overwrite"?: true}',
          prepare=prepare_record_attendance, execute=execute_record_attendance),
    _tool("review_id_copy", "write", "Verify a learner's ID copy, or query it with a note the learner sees. Only when the user says they checked it.",
          '{"learnerId","status": "verified"|"queried","note"?: "required when querying"}', prepare=prepare_review_id_copy, execute=execute_review_id_copy),
]

TRAINING_INTRO = (
    "You can also look up the training workspace's records and prepare a few actions for the staff member, using tools. "
    "Use the read tools for numbers across classes, learners, marking, ID copies, organisations and surveys whenever the "
    "page context does not already hold them; ground every number in a tool result or the page. Look up classId and "
    "learnerId with the read tools; never ask the user for ids. Attendance days are numbered from 1 (the class's first day); "
    "work out 'today' or 'yesterday' from the class dates. Opening a test lets the class's learners start it online. "
)
# Placed after the general planner rules, so they win over "ask when a detail is missing" for look-ups.
TRAINING_RULES = (
    "- Training look-ups: when the user does not name a class, cover ALL classes and say so; never ask which class "
    "before a read tool. Ask a question only before a write, and only for a detail you cannot look up.\n"
    "- Read recentConversation before asking anything. If the user has already answered (for example 'all classes' "
    "or 'list them all'), act on that answer now. Never ask the same question twice.\n"
    "- When a tool finds nothing, say exactly what was checked (for example 'none of the 42 learners in 5 classes'), "
    "and mention the closest related status if it helps (for example copies still waiting for review).\n"
)
TRAINING_FALLBACK ="I couldn't finish that from what I found. Could you tell me which class (course and dates) you mean?"


def register(register_tools: Callable[..., None], register_permission_source: Callable[..., None]) -> None:
    register_tools(TRAINING_TOOLS)
    register_permission_source(training_permissions)


# --------------------------------------------------------------------------- drafting and summaries

MAX_SOURCE_CHARS = 40_000

DRAFT_SYSTEM_PROMPT = (
    "You write knowledge questions for an awareness training course's assessment, from the provider's own course "
    "material. Use only what the material says; never test facts that are not in it, and do not mention 'the document'. "
    "Each question has a type: 'written' (a short written answer, with the expected answer the facilitator marks "
    "against) or 'choice' (3 to 5 options, exactly one correct, plausible wrong options of similar length, the correct "
    "position varied). Marks: 1 for a simple recall question, 2 to 5 for one that asks for explanation or examples. "
    "For a written answer, say what a full-mark answer contains in one to three sentences. Avoid questions that repeat "
    "any in existingQuestions. Reply with ONLY a JSON object: "
    '{"questions": [{"type": "written"|"choice", "text": "...", "marks": 1, "options": ["..."], "answer": "..."}]}. '
    "For a choice question, answer is the correct option's exact text; for a written question use an empty options list."
)

SUMMARY_SYSTEM_PROMPT = (
    "You write the summary at the top of an awareness training provider's report to a funder. Write three or four "
    "short paragraphs in plain, warm, factual English: what was delivered (classes, learners trained, certified and the "
    "pass rate), who was reached (women, youth, people with a disability, the businesses served), the income, and the "
    "businesses' figures when given. Use ONLY the figures in the data; do not estimate, round differently or invent "
    "figures, and leave out anything that is zero or missing rather than drawing attention to it. Write amounts as "
    "'R 12 500'. Never name or describe individual learners. The courses are awareness training and are not accredited; "
    "never call them accredited. Mention ESG reporting only if showEsg is true. Plain text only: no headings, bullets or markdown."
)


class DraftAssessmentRequest(BaseModel):
    libraryItemIds: list[str] = Field(min_length=1, max_length=3)
    count: int = Field(default=8, ge=1, le=20)
    style: str = Field(default="mixed")  # written | choice | mixed
    focus: str = Field(default="", max_length=300)
    existingQuestions: list[str] = Field(default_factory=list, max_length=60)


class FunderSummaryRequest(BaseModel):
    summary: dict[str, Any]
    showEsg: bool = False


def clean_questions(raw: Any, style: str, count: int) -> list[dict[str, Any]]:
    """The model's questions in the editor's shape, dropping any that are malformed (a choice without its answer
    among the options, a written one without an expected answer)."""
    out = []
    for item in raw if isinstance(raw, list) else []:
        if not isinstance(item, dict):
            continue
        text = re.sub(r"\s+", " ", str(item.get("text") or "")).strip()[:600]
        answer = str(item.get("answer") or "").strip()[:1000]
        kind = "choice" if item.get("type") == "choice" else "written"
        if not text or not answer or (style in ("written", "choice") and kind != style):
            continue
        try:
            marks = max(1, min(10, int(item.get("marks") or 1)))
        except (TypeError, ValueError):
            marks = 1
        if kind == "choice":
            options = list(dict.fromkeys(str(option).strip()[:300] for option in item.get("options") or [] if str(option).strip()))
            correct = next((option for option in options if option.lower() == answer.lower()), None)
            if not 3 <= len(options) <= 6 or not correct:
                continue
            out.append({"type": "choice", "text": text, "marks": marks, "options": options, "memo": correct})
        else:
            out.append({"type": "written", "text": text, "marks": marks, "options": [], "memo": answer})
    return out[:count]


def summary_figures(summary: dict[str, Any]) -> set[float]:
    """Every number in the report data, plus the shares a narrative is likely to quote."""
    values: set[float] = set()

    def walk(value: Any) -> None:
        if isinstance(value, bool):
            return
        if isinstance(value, (int, float)):
            values.add(float(value))
        elif isinstance(value, dict):
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)
        elif isinstance(value, str):
            values.update(number for _, number in figures_in(value))

    walk(summary)
    training = summary.get("training") if isinstance(summary.get("training"), dict) else {}
    people = training.get("people") if isinstance(training.get("people"), dict) else {}
    learners = training.get("learners") or 0
    gender_total = (people.get("female") or 0) + (people.get("male") or 0)
    for part, whole in ((people.get("female"), gender_total), (people.get("male"), gender_total), (people.get("youth"), learners),
                        (people.get("withDisability"), learners), (training.get("learnersCertified"), learners)):
        if isinstance(part, (int, float)) and whole:
            share = part / whole * 100
            values.update({float(math.floor(share)), float(math.ceil(share))})  # 62.5% may be written 62% or 63%
    return values


def _public_summary(summary: dict[str, Any], show_esg: bool) -> dict[str, Any]:
    """What the model is shown: the report's totals and organisation rows, ESG left out unless the company shows it."""
    data = {key: summary.get(key) for key in ("companyName", "funderName", "revenue", "training", "businesses") if key in summary}
    organisations = summary.get("organisations") if isinstance(summary.get("organisations"), list) else []
    data["organisations"] = [
        {k: v for k, v in row.items() if k in ("name", "learners", "certified", "revenue") or (show_esg and k == "esgReports")}
        for row in organisations[:20] if isinstance(row, dict)
    ]
    data["organisationsServed"] = len(organisations)
    if show_esg and isinstance(summary.get("esg"), dict):
        data["esg"] = summary["esg"]
    return data


def create_training_router(db: Any, call_gemini: Callable[..., str], require_auth: Callable[[str | None], Any], extract_json: Callable[[str], dict[str, Any] | None]) -> APIRouter:
    router = APIRouter()

    def _training_company(identity: Any, roles: tuple[str, ...]) -> str:
        code = str(getattr(identity, "company_code", "") or "").strip()
        if getattr(identity, "role", None) not in roles or not code:
            raise HTTPException(status_code=403, detail="Only the training company's staff can do this")
        if not training_enabled(db, code):
            raise HTTPException(status_code=403, detail="Awareness training is not switched on for this company")
        return code

    @router.post("/api/training/draft-assessment")
    async def draft_assessment(payload: DraftAssessmentRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
        company = _training_company(require_auth(authorization), STAFF_ROLES)
        sources, used = [], 0
        for item_id in dict.fromkeys(payload.libraryItemIds):
            snap = db.collection(LIBRARY).document(item_id).get()
            item = (snap.to_dict() or {}) if snap.exists else {}
            if item.get("companyCode") != company:
                raise HTTPException(status_code=404, detail="Library item not found")
            text_snap = db.collection(LIBRARY_TEXTS).document(item_id).get()
            text = str(((text_snap.to_dict() or {}) if text_snap.exists else {}).get("text") or "").strip()
            if text and used < MAX_SOURCE_CHARS:
                text = text[: MAX_SOURCE_CHARS - used]
                sources.append({"title": item.get("title") or "Course material", "text": text})
                used += len(text)
        if not sources:
            raise HTTPException(status_code=400, detail="no_readable_text")
        style = payload.style if payload.style in ("written", "choice", "mixed") else "mixed"
        reply = call_gemini(
            DRAFT_SYSTEM_PROMPT,
            {
                "questionsWanted": payload.count,
                "questionTypes": {"written": "written only", "choice": "multiple choice only", "mixed": "mostly multiple choice, some written"}[style],
                "focus": payload.focus.strip() or None,
                "existingQuestions": [q[:300] for q in payload.existingQuestions],
                "material": sources,
            },
            max_output_tokens=6000,
            response_mime_type="application/json",
        )
        questions = clean_questions((extract_json(reply) or {}).get("questions"), style, payload.count)
        if not questions:
            raise HTTPException(status_code=502, detail="draft_empty")
        return {"questions": questions, "sources": [source["title"] for source in sources]}

    @router.post("/api/training/funder-summary")
    async def funder_summary(payload: FunderSummaryRequest, authorization: str | None = Header(default=None)) -> dict[str, Any]:
        _training_company(require_auth(authorization), STAFF_ROLES + ("funder",))
        data = _public_summary(payload.summary, payload.showEsg)
        text = call_gemini(SUMMARY_SYSTEM_PROMPT, {"showEsg": payload.showEsg, "report": data}, max_output_tokens=1500).strip()
        if not text:
            raise HTTPException(status_code=502, detail="summary_empty")
        return {"text": text, "unmatchedFigures": unmatched_figures(text, summary_figures(data))}

    return router
