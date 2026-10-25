"""Company plan / premium features for the Python backend.

Mirrors src/config/entitlements.ts and functions/src/entitlements.ts: keep the three in step.

`companies/{code}.subscription = {"tier": "basic" | "standard" | "premium", "addOns": [...]}` is written only by a
platform admin. A company with no subscription field keeps every feature (plans never switch off an existing
customer), and an identity with no company (platform staff, the trusted service) is never restricted.

What each tier includes is edited on the admin Company plans page and stored in `systemSettings/plans` as
`{"tiers": {"basic": {"features": [...]}, ...}}`. Without it (or for a tier it doesn't list) TIER_FEATURES apply.
"""

from __future__ import annotations

import time
from typing import Any, Callable

TIER_FEATURES: dict[str, set[str]] = {
    "basic": set(),
    "standard": {"whatsappComms"},
    "premium": {"whatsappComms", "agenticSupport"},
}
FEATURE_KEYS = ("whatsappComms", "agenticSupport")

NOT_IN_PLAN = "This feature is not included in your organisation's plan."

# Plan contents change rarely, so one read serves a minute.
_TIER_CACHE_SECONDS = 60
_tier_cache: dict[str, Any] = {}


def normalize_tier_features(raw: Any) -> dict[str, set[str]]:
    tiers = raw.get("tiers") if isinstance(raw, dict) else None
    result: dict[str, set[str]] = {}
    for tier, default in TIER_FEATURES.items():
        features = (tiers or {}).get(tier, {}).get("features") if isinstance((tiers or {}).get(tier), dict) else None
        result[tier] = {item for item in features if item in FEATURE_KEYS} if isinstance(features, list) else set(default)
    return result


def load_tier_features(db: Any) -> dict[str, set[str]]:
    cached = _tier_cache.get("value")
    if cached is not None and time.monotonic() - _tier_cache.get("at", 0) < _TIER_CACHE_SECONDS:
        return cached
    try:
        snapshot = db.collection("systemSettings").document("plans").get()
        value = normalize_tier_features(snapshot.to_dict() if snapshot.exists else None)
    except Exception as error:  # noqa: BLE001
        print("Plan contents lookup failed; using defaults", type(error).__name__, flush=True)
        return cached if cached is not None else TIER_FEATURES
    _tier_cache.update(at=time.monotonic(), value=value)
    return value


def resolve_features(subscription: Any, tier_features: dict[str, set[str]] | None = None) -> dict[str, bool]:
    tiers = tier_features or TIER_FEATURES
    tier = subscription.get("tier") if isinstance(subscription, dict) else None
    if tier not in tiers:
        return {key: True for key in FEATURE_KEYS}
    included = set(tiers[tier])
    add_ons = subscription.get("addOns") if isinstance(subscription, dict) else None
    if isinstance(add_ons, list):
        included |= {item for item in add_ons if item in FEATURE_KEYS}
    return {key: key in included for key in FEATURE_KEYS}


def company_has_feature(db: Any, company_code: str | None, feature: str) -> bool:
    """Fails open on a read error so an outage never locks a customer out."""
    code = str(company_code or "").strip()
    if not code:
        return True
    try:
        snapshot = db.collection("companies").document(code).get()
        data = snapshot.to_dict() if snapshot.exists else None
        return resolve_features((data or {}).get("subscription"), load_tier_features(db))[feature]
    except Exception as error:  # noqa: BLE001
        print("Entitlement lookup failed; allowing", type(error).__name__, flush=True)
        return True


def identity_has_feature(db: Any, identity: Any, feature: str) -> bool:
    if getattr(identity, "is_service", False):
        return True
    return company_has_feature(db, getattr(identity, "company_code", None), feature)


def create_feature_authenticator(
    db: Any,
    authenticate: Callable[[str | None], Any],
    feature: str,
) -> Callable[[str | None], Any]:
    """Authenticate like `authenticate`, then refuse (403) when the caller's company plan lacks `feature`."""

    def authenticate_with_feature(authorization: str | None) -> Any:
        identity = authenticate(authorization)
        if not identity_has_feature(db, identity, feature):
            from fastapi import HTTPException  # imported here so the pure helpers above work without FastAPI

            raise HTTPException(status_code=403, detail=NOT_IN_PLAN)
        return identity

    return authenticate_with_feature
