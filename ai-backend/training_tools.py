"""Read-only tools for the awareness training assistant (client module, see client_modules.py).

Every tool reads one company's records only: the signed-in person's own company code, never one passed in by the
model. Staff (projectadmin, operations) can look at their company's classes, learners, results, certificates,
surveys, client companies, funders, income and ESG reports; a learner can look at their own training only. Funders and
client companies keep the report their page sends.

Nothing here returns ID numbers, emails, phone numbers, user ids, assessment answers or memo answers.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import date, datetime, timedelta
from typing import Any

from agent_actions import ActionError, Actor, Tool, _timezone

STAFF_ROLES = ("projectadmin", "operations")
MAX_ROWS = 1000
LIST_LIMIT = 40

TRAINING_TOOLS_INTRO = (
    "You can look up this training workspace's own records with read-only tools. Use them when the page context does "
    "not already hold the answer; a tool's result grounds a number just as the page context does. You cannot change "
    "anything: if asked to, say where in the app to do it. "
)
TRAINING_FALLBACK = "I couldn't find that in your training records. Could you tell me which class, learner or company you mean?"


# --------------------------------------------------------------------------- reading


def _company(actor: Actor) -> str:
    code = str(actor.company_code or "").strip()
    if not code:
        raise ActionError("These records belong to a training company, and you are not signed in to one.")
    return code


def _rows(db: Any, collection: str, company: str) -> list[dict[str, Any]]:
    """One company's records of a collection, each with its id under "_id"."""
    try:
        docs = db.collection(collection).where("companyCode", "==", company).limit(MAX_ROWS).stream()
        return [{**(doc.to_dict() or {}), "_id": doc.id} for doc in docs]
    except Exception as exc:  # a missing index or a network error is the model's to explain, not a 500
        raise ActionError(f"I couldn't read the {collection} records just now.") from exc


def _text(value: Any) -> str:
    return str(value or "").strip()


def _norm(value: Any) -> str:
    return " ".join(_text(value).lower().split())


def _when(value: Any) -> str | None:
    """A stored date or time as ISO text (stored as a string, a datetime or a Firestore timestamp)."""
    if value is None or value == "":
        return None
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    return str(value)


def _day(value: Any) -> date | None:
    text = _when(value)
    try:
        return date.fromisoformat(text[:10]) if text else None
    except ValueError:
        return None


def _today() -> datetime:
    return datetime.now(_timezone())


# --------------------------------------------------------------------------- the rules (src/utils/trainingResults.ts)


def class_end(training_class: dict[str, Any]) -> date | None:
    start = _day(training_class.get("startDate"))
    if not start:
        return None
    return start + timedelta(days=max(1, int(training_class.get("dayCount") or 1)) - 1)


def class_phase(training_class: dict[str, Any], now: datetime | None = None) -> str:
    """upcoming, running or finished: finished after the last day's end time, or the day after it without hours."""
    now = now or _today()
    start, end = _day(training_class.get("startDate")), class_end(training_class)
    if not start or not end:
        return "unknown"
    today = now.date()
    if today < start:
        return "upcoming"
    if today > end:
        return "finished"
    day_hours = (training_class.get("dayHours") or {}).get(str(max(1, int(training_class.get("dayCount") or 1))))
    hours = day_hours or training_class.get("hours")
    if today == end and isinstance(hours, dict) and hours.get("end") and now.strftime("%H:%M") >= str(hours["end"]):
        return "finished"
    return "running"


def _best_marked(submissions: list[dict[str, Any]]) -> int | None:
    scores = [s.get("scorePct") for s in submissions if s.get("status") == "marked" and isinstance(s.get("scorePct"), (int, float))]
    return round(max(scores)) if scores else None


def learner_result(training_class: dict[str, Any], learner: dict[str, Any], submissions: list[dict[str, Any]], groups: list[dict[str, Any]]) -> dict[str, Any]:
    """Where a learner stands against the class pass rule (mirrors learnerResult in trainingResults.ts)."""
    own = [s for s in submissions if s.get("learnerId") == learner["_id"]]
    posts = [s for s in own if s.get("kind") == "post"]
    pre_pct = _best_marked([s for s in own if s.get("kind") == "pre"])
    post_pct = _best_marked(posts)
    awaiting = any(s.get("status") == "submitted" for s in posts)
    group = next((g for g in groups if learner["_id"] in (g.get("learnerIds") or [])), None)
    group_marked = bool(group and group.get("markedAt"))
    group_took_part = group_marked and learner["_id"] not in (group.get("absentLearnerIds") or [])
    group_ok = not training_class.get("groupAssignmentRequired") or group_took_part
    pass_mark = training_class.get("passMarkPct") or 0
    allowed = 1 + max(0, int(training_class.get("reassessmentsAllowed") or 0))

    if post_pct is None:
        status = "awaiting marking" if awaiting else "post-assessment not written yet"
    elif post_pct >= pass_mark:
        status = "passed" if group_ok else ("not passed (missed the group assignment)" if group_marked else "awaiting the group assignment mark")
    elif awaiting:
        status = "awaiting marking"
    elif len(posts) < allowed:
        status = "reassessment available"
    else:
        status = "not passed"
    return {
        "preScorePct": pre_pct,
        "postScorePct": post_pct,
        "postAttempts": len(posts),
        "attemptsAllowed": allowed,
        "groupAssignment": None if not training_class.get("groupAssignmentRequired") else ("marked" if group_marked else "not marked yet"),
        "status": status,
    }


def _days_present(training_class: dict[str, Any], learner: dict[str, Any]) -> str:
    days = max(1, int(training_class.get("dayCount") or 1))
    attendance = learner.get("attendance") or {}
    present = sum(1 for day in range(1, days + 1) if (attendance.get(str(day)) or {}).get("present"))
    return f"{present} of {days}"


def _delivery(training_class: dict[str, Any]) -> str:
    mode = _text(training_class.get("deliveryMode")) or "in_person"
    label = {"in_person": "in person", "online": "online", "hybrid": "hybrid"}.get(mode, mode)
    venue = _text(training_class.get("venue"))
    return f"{label}, {venue}" if venue and mode != "online" else label


# --------------------------------------------------------------------------- shared lookups


class _Workspace:
    """A company's training records, read once per tool call."""

    def __init__(self, db: Any, company: str):
        self.db, self.company = db, company
        self._cache: dict[str, list[dict[str, Any]]] = {}

    def __call__(self, collection: str) -> list[dict[str, Any]]:
        if collection not in self._cache:
            self._cache[collection] = _rows(self.db, collection, self.company)
        return self._cache[collection]

    def by_id(self, collection: str) -> dict[str, dict[str, Any]]:
        return {row["_id"]: row for row in self(collection)}

    def class_label(self, class_id: str | None) -> str:
        training_class = self.by_id("trainingClasses").get(class_id or "")
        if not training_class:
            return "an unknown class"
        return f"{_text(training_class.get('courseTitle')) or 'Course'} starting {_text(training_class.get('startDate'))}"

    def funder_name(self, funder_id: str | None) -> str | None:
        funder = self.by_id("trainingFunders").get(funder_id or "")
        return _text(funder.get("name")) or None if funder else None

    def results(self, training_class: dict[str, Any]) -> list[tuple[dict[str, Any], dict[str, Any]]]:
        learners = [l for l in self("trainingLearners") if l.get("classId") == training_class["_id"]]
        submissions = [s for s in self("trainingSubmissions") if s.get("classId") == training_class["_id"]]
        groups = [g for g in self("trainingGroups") if g.get("classId") == training_class["_id"]]
        return [(learner, learner_result(training_class, learner, submissions, groups)) for learner in learners]


def _find_class(ws: _Workspace, args: dict[str, Any]) -> dict[str, Any]:
    classes = ws("trainingClasses")
    wanted = _text(args.get("classId"))
    if wanted:
        for training_class in classes:
            if training_class["_id"] == wanted:
                return training_class
        raise ActionError("I couldn't find that class. Use training_classes to list them.")
    if not classes:
        raise ActionError("There are no classes yet.")
    # No class named: the running one, else the latest that has started, else the next.
    started = [c for c in classes if class_phase(c) in ("running", "finished")]
    if started:
        return max(started, key=lambda c: (class_phase(c) == "running", _text(c.get("startDate"))))
    return min(classes, key=lambda c: _text(c.get("startDate")))


def _class_row(ws: _Workspace, training_class: dict[str, Any]) -> dict[str, Any]:
    learners = [l for l in ws("trainingLearners") if l.get("classId") == training_class["_id"]]
    to_mark = [s for s in ws("trainingSubmissions") if s.get("classId") == training_class["_id"] and s.get("status") == "submitted"]
    end = class_end(training_class)
    return {
        "classId": training_class["_id"],
        "course": _text(training_class.get("courseTitle")),
        "phase": class_phase(training_class),
        "startDate": _text(training_class.get("startDate")),
        "endDate": end.isoformat() if end else None,
        "days": training_class.get("dayCount"),
        "delivery": _delivery(training_class),
        "learners": len(learners),
        "testsToMark": len(to_mark),
        "passMarkPct": training_class.get("passMarkPct"),
        "reassessmentsAllowed": training_class.get("reassessmentsAllowed"),
        "groupAssignmentRequired": bool(training_class.get("groupAssignmentRequired")),
        "assessmentsOpen": training_class.get("testsOpen") or {},
        "funder": ws.funder_name(training_class.get("funderId")),
    }


# --------------------------------------------------------------------------- staff tools


def tool_training_classes(db: Any, actor: Actor, args: dict[str, Any]) -> dict[str, Any]:
    ws = _Workspace(db, _company(actor))
    phase = _norm(args.get("phase"))
    rows = [_class_row(ws, c) for c in ws("trainingClasses")]
    if phase in ("upcoming", "running", "finished"):
        rows = [row for row in rows if row["phase"] == phase]
    rows.sort(key=lambda row: row["startDate"], reverse=True)
    return {"classes": rows[:LIST_LIMIT], "total": len(rows)}


def tool_training_class_detail(db: Any, actor: Actor, args: dict[str, Any]) -> dict[str, Any]:
    ws = _Workspace(db, _company(actor))
    training_class = _find_class(ws, args)
    learners = []
    for learner, result in ws.results(training_class):
        id_copy = (learner.get("idDocument") or {}).get("status")
        learners.append({
            "name": _text(learner.get("name")),
            "organisation": _text(learner.get("organisation")),
            "daysPresent": _days_present(training_class, learner),
            "canSignIn": bool(learner.get("uid")),
            "idCopy": {"pending": "uploaded, to check", "verified": "verified", "queried": "queried"}.get(id_copy or "", "not uploaded"),
            "certificate": "issued" if learner.get("certificateId") else None,
            **result,
        })
    learners.sort(key=lambda row: row["name"])
    return {"class": _class_row(ws, training_class), "learners": learners}


def tool_find_learners(db: Any, actor: Actor, args: dict[str, Any]) -> dict[str, Any]:
    ws = _Workspace(db, _company(actor))
    needle = _norm(args.get("query"))
    if not needle:
        raise ActionError("Give part of a learner's name or their company.")
    classes = ws.by_id("trainingClasses")
    out = []
    for learner in ws("trainingLearners"):
        if needle not in _norm(learner.get("name")) and needle not in _norm(learner.get("organisation")):
            continue
        training_class = classes.get(_text(learner.get("classId")))
        result = {}
        if training_class:
            submissions = [s for s in ws("trainingSubmissions") if s.get("learnerId") == learner["_id"]]
            groups = [g for g in ws("trainingGroups") if g.get("classId") == training_class["_id"]]
            result = learner_result(training_class, learner, submissions, groups)
        out.append({
            "name": _text(learner.get("name")),
            "organisation": _text(learner.get("organisation")),
            "classId": learner.get("classId"),
            "class": ws.class_label(learner.get("classId")),
            "daysPresent": _days_present(training_class, learner) if training_class else None,
            "certificate": "issued" if learner.get("certificateId") else None,
            **result,
        })
        if len(out) >= LIST_LIMIT:
            break
    return {"learners": out}


def tool_training_to_do(db: Any, actor: Actor, args: dict[str, Any]) -> dict[str, Any]:
    ws = _Workspace(db, _company(actor))
    learners = ws.by_id("trainingLearners")
    name = lambda learner_id: _text((learners.get(learner_id) or {}).get("name")) or "a learner"
    to_mark = [
        {"learner": name(s.get("learnerId")), "class": ws.class_label(s.get("classId")),
         "assessment": "pre-assessment" if s.get("kind") == "pre" else "post-assessment", "attempt": s.get("attempt"), "handedIn": _when(s.get("submittedAt"))}
        for s in ws("trainingSubmissions") if s.get("status") == "submitted"
    ]
    id_copies = [
        {"learner": _text(l.get("name")), "class": ws.class_label(l.get("classId"))}
        for l in learners.values() if (l.get("idDocument") or {}).get("status") == "pending"
    ]
    groups_to_mark = []
    for training_class in ws("trainingClasses"):
        if not training_class.get("groupAssignmentRequired") or class_phase(training_class) == "upcoming":
            continue
        for group in ws("trainingGroups"):
            if group.get("classId") == training_class["_id"] and not group.get("markedAt"):
                groups_to_mark.append({"group": _text(group.get("name")), "class": ws.class_label(training_class["_id"])})
    not_invited = [
        {"learner": _text(l.get("name")), "class": ws.class_label(l.get("classId")), "hasEmail": bool(_text(l.get("email")))}
        for l in learners.values()
        if not l.get("uid") and class_phase(ws.by_id("trainingClasses").get(_text(l.get("classId")), {})) != "finished"
    ]
    return {
        "testsToMark": to_mark[:LIST_LIMIT],
        "idCopiesToCheck": id_copies[:LIST_LIMIT],
        "groupAssignmentsToMark": groups_to_mark[:LIST_LIMIT],
        "learnersNotYetInvited": not_invited[:LIST_LIMIT],
        "totals": {"testsToMark": len(to_mark), "idCopiesToCheck": len(id_copies), "groupAssignmentsToMark": len(groups_to_mark), "learnersNotYetInvited": len(not_invited)},
    }


def tool_results_by_organisation(db: Any, actor: Actor, args: dict[str, Any]) -> dict[str, Any]:
    ws = _Workspace(db, _company(actor))
    class_id = _text(args.get("classId"))
    needle = _norm(args.get("organisation"))
    classes = [c for c in ws("trainingClasses") if not class_id or c["_id"] == class_id]
    totals: dict[str, dict[str, Any]] = defaultdict(lambda: {"learners": 0, "passed": 0, "certificates": 0, "postScores": [], "daysPresent": 0, "daysPossible": 0})
    for training_class in classes:
        for learner, result in ws.results(training_class):
            organisation = _text(learner.get("organisation")) or "No company given"
            if needle and needle not in _norm(organisation):
                continue
            row = totals[organisation]
            row["learners"] += 1
            row["passed"] += result["status"] == "passed"
            row["certificates"] += bool(learner.get("certificateId"))
            if result["postScorePct"] is not None:
                row["postScores"].append(result["postScorePct"])
            present, possible = _days_present(training_class, learner).split(" of ")
            row["daysPresent"] += int(present)
            row["daysPossible"] += int(possible)
    out = []
    for organisation, row in sorted(totals.items()):
        scores = row.pop("postScores")
        present, possible = row.pop("daysPresent"), row.pop("daysPossible")
        out.append({
            "organisation": organisation, **row,
            "averagePostScorePct": round(sum(scores) / len(scores)) if scores else None,
            "attendancePct": round(100 * present / possible) if possible else None,
        })
    return {"scope": ws.class_label(class_id) if class_id else "all classes", "organisations": out}


def tool_training_certificates(db: Any, actor: Actor, args: dict[str, Any]) -> dict[str, Any]:
    ws = _Workspace(db, _company(actor))
    needle = _norm(args.get("query"))
    rows = [
        {"number": _text(c.get("certificateNumber")), "learner": _text(c.get("learnerName")), "organisation": _text(c.get("organisation")),
         "course": _text(c.get("courseTitle")), "trainingDates": _text(c.get("trainingDates")), "issuedOn": _text(c.get("issuedOn")),
         "status": _text(c.get("status")) or "valid"}
        for c in ws("trainingCertificates")
    ]
    if needle:
        rows = [r for r in rows if needle in _norm(" ".join([r["number"], r["learner"], r["organisation"], r["course"]]))]
    rows.sort(key=lambda r: r["issuedOn"], reverse=True)
    return {"certificates": rows[:LIST_LIMIT], "total": len(rows), "valid": sum(r["status"] == "valid" for r in rows)}


def tool_survey_results(db: Any, actor: Actor, args: dict[str, Any]) -> dict[str, Any]:
    ws = _Workspace(db, _company(actor))
    surveys = ws("trainingSurveys")
    responses = ws("trainingSurveyResponses")
    wanted = _text(args.get("surveyId"))
    if not wanted:
        return {"surveys": [
            {"surveyId": s["_id"], "title": _text(s.get("title")), "audience": s.get("audience"), "status": s.get("status"),
             "classes": [ws.class_label(c) for c in s.get("classIds") or []],
             "responses": sum(r.get("surveyId") == s["_id"] for r in responses)}
            for s in surveys
        ]}
    survey = next((s for s in surveys if s["_id"] == wanted), None)
    if not survey:
        raise ActionError("I couldn't find that survey. Call survey_results without a surveyId to list them.")
    answered = [r for r in responses if r.get("surveyId") == wanted]
    hide_names = bool(survey.get("hideNames"))
    questions = []
    for question in survey.get("questions") or []:
        qid, kind = question.get("id"), question.get("type")
        given = [r.get("answers", {}).get(qid) for r in answered]
        given = [g for g in given if g not in (None, "")]
        row: dict[str, Any] = {"question": _text(question.get("text")), "type": kind, "answers": len(given)}
        if kind == "rating":
            numbers = [g for g in given if isinstance(g, (int, float))]
            row["average"] = round(sum(numbers) / len(numbers), 1) if numbers else None
            row["outOf"] = 5
        elif kind in ("yesno", "choice"):
            counts: dict[str, int] = defaultdict(int)
            for g in given:
                counts[str(g)] += 1
            row["counts"] = dict(counts)
        else:
            row["comments"] = [
                {"text": str(g)[:400], **({} if hide_names else {"from": _text(r.get("name"))})}
                for r in answered for g in [r.get("answers", {}).get(qid)] if g not in (None, "")
            ][:20]
        questions.append(row)
    return {"survey": _text(survey.get("title")), "status": survey.get("status"), "responses": len(answered), "questions": questions}


def tool_client_companies(db: Any, actor: Actor, args: dict[str, Any]) -> dict[str, Any]:
    ws = _Workspace(db, _company(actor))
    metrics: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for m in ws("trainingOrgMetrics"):
        metrics[_text(m.get("organisationId"))].append(m)
    out = []
    for org in ws("trainingOrganisations"):
        name = _text(org.get("name"))
        people = [l for l in ws("trainingLearners") if l.get("organisationId") == org["_id"] or _norm(l.get("organisation")) == _norm(name)]
        latest = max(metrics.get(org["_id"], []), key=lambda m: _text(m.get("period")), default=None)
        details = org.get("details") or {}
        out.append({
            "name": name,
            "contactName": _text(org.get("contactName")) or None,
            "sector": details.get("sector"),
            "province": details.get("province"),
            "learnersTrained": len(people),
            "certificates": sum(bool(l.get("certificateId")) for l in people),
            "latestMonthlyFigures": {"period": latest.get("period"), "revenue": latest.get("revenue"), "employees": latest.get("employees")} if latest else None,
            "baseline": {"annualRevenue": details.get("baselineRevenue"), "employees": details.get("employees")} if details else None,
        })
    out.sort(key=lambda row: row["name"])
    return {"companies": out[:LIST_LIMIT], "total": len(out)}


def tool_training_funders(db: Any, actor: Actor, args: dict[str, Any]) -> dict[str, Any]:
    ws = _Workspace(db, _company(actor))
    out = []
    for funder in ws("trainingFunders"):
        fid = funder["_id"]
        classes = [c for c in ws("trainingClasses") if c.get("funderId") == fid]
        class_ids = {c["_id"] for c in classes}
        learners = [l for l in ws("trainingLearners") if l.get("classId") in class_ids or l.get("funderId") == fid]
        income = [r for r in ws("clientRevenue") if r.get("funderId") == fid or r.get("classId") in class_ids]
        out.append({
            "name": _text(funder.get("name")),
            "contactName": _text(funder.get("contactName")) or None,
            "classes": [ws.class_label(c["_id"]) for c in classes],
            "learners": len(learners),
            "esgReports": [_text(r.get("clientName")) for r in ws("esgReports") if r.get("funderId") == fid],
            "income": round(sum(float(r.get("amount") or 0) for r in income), 2),
        })
    return {"funders": out}


def tool_training_income(db: Any, actor: Actor, args: dict[str, Any]) -> dict[str, Any]:
    ws = _Workspace(db, _company(actor))
    start, end = _day(args.get("from")), _day(args.get("to"))
    rows = [r for r in ws("clientRevenue") if (not start or (_day(r.get("date")) or date.min) >= start) and (not end or (_day(r.get("date")) or date.max) <= end)]
    by = lambda key: {k: round(v, 2) for k, v in _sum_by(rows, key).items()}
    return {
        "period": {"from": start.isoformat() if start else "the first record", "to": end.isoformat() if end else "today"},
        "entries": len(rows),
        "total": round(sum(float(r.get("amount") or 0) for r in rows), 2),
        "byStatus": by("status"),
        "byService": by("service"),
        "byOrganisation": by("organisation"),
        "byMonth": {k: round(v, 2) for k, v in sorted(_sum_by(rows, lambda r: _text(r.get("date"))[:7]).items())},
        "currency": "ZAR unless the entry says otherwise",
    }


def _sum_by(rows: list[dict[str, Any]], key: Any) -> dict[str, float]:
    out: dict[str, float] = defaultdict(float)
    for row in rows:
        label = key(row) if callable(key) else _text(row.get(key))
        out[label or "not given"] += float(row.get("amount") or 0)
    return dict(out)


def tool_esg_reports(db: Any, actor: Actor, args: dict[str, Any]) -> dict[str, Any]:
    ws = _Workspace(db, _company(actor))
    needle = _norm(args.get("client"))
    out = []
    for report in ws("esgReports"):
        if needle and needle not in _norm(report.get("clientName")):
            continue
        indicators = report.get("indicators") or []
        missing = [i for i in indicators if not _text(i.get("current") if isinstance(i, dict) else "")]
        risks = report.get("risks") or []
        out.append({
            "client": _text(report.get("clientName")),
            "sector": report.get("sector"),
            "country": report.get("country"),
            "period": f"{_text(report.get('periodStart'))} to {_text(report.get('periodEnd'))}",
            "status": report.get("status"),
            "frameworks": report.get("frameworks") or [],
            "otherFrameworks": _text(report.get("otherFrameworks")) or None,
            "publicationDate": report.get("publicationDate"),
            "indicators": len(indicators),
            "indicatorsWithoutCurrentValue": [_text(i.get("name") or i.get("indicator")) for i in missing if isinstance(i, dict)][:20],
            "openRisks": sum(1 for r in risks if isinstance(r, dict) and _norm(r.get("status")) != "closed"),
            "funder": ws.funder_name(report.get("funderId")),
        })
    return {"reports": out}


# --------------------------------------------------------------------------- learner tool


def tool_my_training(db: Any, actor: Actor, args: dict[str, Any]) -> dict[str, Any]:
    ws = _Workspace(db, _company(actor))
    mine = [l for l in ws("trainingLearners") if l.get("uid") == actor.uid]
    classes = ws.by_id("trainingClasses")
    certificates = ws.by_id("trainingCertificates")
    out = []
    for learner in mine:
        training_class = classes.get(_text(learner.get("classId")))
        if not training_class:
            continue
        submissions = [s for s in ws("trainingSubmissions") if s.get("learnerId") == learner["_id"]]
        groups = [g for g in ws("trainingGroups") if g.get("classId") == training_class["_id"]]
        certificate = certificates.get(_text(learner.get("certificateId")))
        out.append({
            **{k: v for k, v in _class_row(ws, training_class).items() if k not in ("testsToMark", "learners", "funder", "classId")},
            "daysPresent": _days_present(training_class, learner),
            "idCopy": (learner.get("idDocument") or {}).get("status") or "not uploaded",
            "assessments": [
                {"assessment": "pre-assessment" if s.get("kind") == "pre" else "post-assessment", "attempt": s.get("attempt"),
                 "status": s.get("status"), **({"scorePct": s.get("scorePct")} if s.get("status") == "marked" else {})}
                for s in sorted(submissions, key=lambda s: (s.get("kind") != "pre", s.get("attempt") or 0))
            ],
            "result": learner_result(training_class, learner, submissions, groups)["status"],
            "certificate": {"number": certificate.get("certificateNumber"), "status": certificate.get("status")} if certificate else None,
        })
    return {"enrolments": out}


# --------------------------------------------------------------------------- catalogue


_STAFF = ("training_staff",)
_LEARNER = ("training_learner",)
STAFF_TOOLS = [
    Tool("training_classes", "read", "List the company's classes with dates, delivery, learner counts, tests to mark and pass rules (gives classId).", '{"phase"?: "upcoming"|"running"|"finished"}', _STAFF, run=tool_training_classes),
    Tool("training_class_detail", "read", "One class and every learner in it: company, attendance, pre and post scores, attempts, group assignment, result, ID copy and certificate. Without classId: the running class, else the latest.", '{"classId"?}', _STAFF, run=tool_training_class_detail),
    Tool("find_learners", "read", "Find learners by part of their name or their company, with their class and result.", '{"query"}', _STAFF, run=tool_find_learners),
    Tool("training_to_do", "read", "What needs the facilitator: assessments to mark, ID copies to check, group assignments to mark and learners not yet invited.", "{}", _STAFF, run=tool_training_to_do),
    Tool("results_by_organisation", "read", "Results per client company: learners, passed, certificates, average post score and attendance. Optionally one class or one company.", '{"classId"?, "organisation"?}', _STAFF, run=tool_results_by_organisation),
    Tool("training_certificates", "read", "Certificates issued, with number, learner, company, course, dates and status.", '{"query"?: "learner, company, course or number"}', _STAFF, run=tool_training_certificates),
    Tool("survey_results", "read", "Without surveyId: the surveys and their response counts. With surveyId: rating averages, counts and written comments per question.", '{"surveyId"?}', _STAFF, run=tool_survey_results),
    Tool("client_companies", "read", "The client companies: sector, contact person, learners trained, certificates, and their baseline and latest monthly revenue and staff.", "{}", _STAFF, run=tool_client_companies),
    Tool("training_funders", "read", "The funders: the classes, learners, ESG reports and income linked to each.", "{}", _STAFF, run=tool_training_funders),
    Tool("training_income", "read", "Income recorded: totals by status (paid or invoiced), service, client company and month.", '{"from"?: "YYYY-MM-DD", "to"?: "YYYY-MM-DD"}', _STAFF, run=tool_training_income),
    Tool("esg_reports", "read", "The ESG reports being prepared: client, period, status, frameworks, indicators still missing a value and open risks.", '{"client"?}', _STAFF, run=tool_esg_reports),
]
LEARNER_TOOLS = [
    Tool("my_training", "read", "The learner's own classes: dates, delivery, days present, their assessments' status and scores, their result and certificate.", "{}", _LEARNER, run=tool_my_training),
]


def training_tools_for(identity: Any) -> list[Tool]:
    """The tools of the person's role in a training company: staff, a learner, or none (funders, client companies)."""
    if getattr(identity, "is_service", False) or not getattr(identity, "company_code", None):
        return []
    role = getattr(identity, "role", None)
    if role in STAFF_ROLES:
        return list(STAFF_TOOLS)
    if role == "learner":
        return list(LEARNER_TOOLS)
    return []
