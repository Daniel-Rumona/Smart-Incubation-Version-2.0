from typing import Any
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel, Field


class ScanRequest(BaseModel):
    participantId: str | None = Field(default=None, max_length=200)
    programId: str | None = Field(default=None, max_length=200)
    updateDatabase: bool = True


def create_compliance_scan_router(db, authenticate, participants, documents, scan, persist):
    router = APIRouter()

    @router.post("/api/compliance/scan")
    def scan_compliance(payload: ScanRequest, authorization: str | None = Header(default=None)):
        identity = authenticate(authorization)
        if identity.is_service:
            raise HTTPException(403, "A signed-in staff account is required")
        snapshot = db.collection("users").document(identity.uid).get()
        profile = snapshot.to_dict() or {} if snapshot.exists else {}
        if identity.role not in {"systemadmin", "operations", "projectadmin"} and "manage_compliance" not in (profile.get("permissions") or []):
            raise HTTPException(403, "Compliance management permission is required")
        if identity.role != "systemadmin" and not identity.company_code:
            raise HTTPException(403, "Company scope is required")
        assigned = set(profile.get("assignedProgramIds") or [])
        results: list[dict[str, Any]] = []
        for participant in participants(payload.participantId, payload.programId):
            if identity.company_code and participant.get("companyCode") != identity.company_code:
                continue
            if assigned and participant.get("programId") not in assigned:
                continue
            files = documents(str(participant.get("participantId") or participant["id"]), participant.get("programId"))
            if not any(str(item.get("url") or (item.get("currentFile") or {}).get("url") or "").strip() for item in files):
                continue
            result = scan(participant)
            results.append(result)
        # Resolve the full scope before performing writes.
        if payload.updateDatabase:
            for result in results:
                persist(result)
        return {
            "updated": payload.updateDatabase and bool(results),
            "results": results,
            "totals": {
                "participants": len(results),
                "documents": sum(len(result["documents"]) for result in results),
                "missing": sum(result["summary"]["totalMissing"] for result in results),
                "pending": sum(result["summary"]["totalPending"] for result in results),
                "problem": sum(result["summary"]["totalProblem"] for result in results),
                "averageScore": round(sum(result["summary"]["score"] for result in results) / len(results)) if results else 0,
            },
        }

    return router
