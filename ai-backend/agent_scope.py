"""What records the page assistant (/api/agent) may see, for the signed-in person.

The backend reads Firestore with the Admin SDK, which ignores the security rules, so the assistant's record snapshot
has to be scoped here, from the verified identity (never from the page context the browser sends):

* company staff see their own company's records only;
* an SME (or anyone else) sees only records that are theirs, plus their company's programmes and the programmes open
  to outside SMEs;
* the platform admin (systemadmin) sees records across companies, as the rules allow them to;
* the service secret (backend plumbing) sees nothing.

This mirrors firestore.rules, narrowed to the person's own company even where the rules are wider.
"""

from __future__ import annotations

from typing import Any, Callable, Iterable

COMPANY_STAFF_ROLES = {"director", "projectadmin", "projectmanager", "operations", "consultant", "admin"}
INTAKE_STAFF_ROLES = {"director", "projectadmin", "projectmanager", "operations", "admin"}
PLATFORM_ADMIN = "systemadmin"

# Owner fields per collection (what the rules' isOwn... checks compare against the uid or email).
OWN_UID_FIELDS = {
    "participants": ("uid", "userId", "participantId", "ownerUid"),
    "applications": ("participantId", "uid", "userId"),
}
OWN_EMAIL_FIELDS = {
    "participants": ("email",),
    "applications": ("email",),
    "smeIntakeSubmissions": ("contactEmail", "createdByEmail"),
}


def _field(identity: Any, name: str) -> str:
    return str(getattr(identity, name, "") or "").strip()


def _dedupe(snapshots: Iterable[Any], limit: int) -> list[Any]:
    seen, out = set(), []
    for snap in snapshots:
        if snap.id in seen:
            continue
        seen.add(snap.id)
        out.append(snap)
        if len(out) >= limit:
            break
    return out


def scoped_documents(db: Any, identity: Any, collection: str, limit: int) -> list[Any]:
    """The documents of `collection` this person may have in the assistant's context (at most `limit`)."""
    if identity is None or getattr(identity, "is_service", False):
        return []
    role = _field(identity, "role")
    company = _field(identity, "company_code")
    uid = _field(identity, "uid")
    raw_email = _field(identity, "email")
    emails = {raw_email, raw_email.lower()} - {""}  # stored emails are not always lower case
    ref = db.collection(collection)

    def where(field: str, value: Any) -> list[Any]:
        return list(ref.where(field, "==", value).limit(limit).stream())

    if role == PLATFORM_ADMIN:
        return list(ref.limit(limit).stream())

    if role in COMPANY_STAFF_ROLES:
        if not company:
            return []
        if collection in ("smeIntakeSubmissions", "smeIntakeAnalyses") and role not in INTAKE_STAFF_ROLES:
            return []
        return where("companyCode", company)

    # SMEs, applicants and anyone else: their own records only.
    if collection == "programs":
        found = where("companyCode", company) if company else []
        return _dedupe([*found, *where("openToExternalSmes", True)], limit)
    if collection == "users":
        if not uid:
            return []
        snap = ref.document(uid).get()
        return [snap] if snap.exists else []
    found: list[Any] = []
    if uid and collection == "participants":
        snap = ref.document(uid).get()
        if snap.exists:
            found.append(snap)
    for field in OWN_UID_FIELDS.get(collection, ()):
        if uid:
            found.extend(where(field, uid))
    for field in OWN_EMAIL_FIELDS.get(collection, ()):
        for email in emails:
            found.extend(where(field, email))
    return _dedupe(found, limit)


def scoped_snapshot(
    db: Any, identity: Any, collections: Iterable[str], limit: int, compact: Callable[[Any], dict[str, Any]],
) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for name in collections:
        try:
            out[name] = [compact(snap) for snap in scoped_documents(db, identity, name, limit)]
        except Exception:
            # Never pass raw error text (it can name indexes or projects) to the model.
            out[name] = {"error": "unavailable"}
    return out
