# Field migrations registry

Tracks every place the Firestore schema has drifted — a field renamed in some places but not
others — so cleanup has a checklist instead of relying on tribal knowledge or runtime fallback
chains.

**Why this exists instead of just adding `a.new || a.old`:** a fallback chain hides drift instead
of fixing it. It silently keeps working forever, so nobody notices when a third name shows up, and
new code just copies whichever branch happens to be first — which is exactly how a two-name drift
becomes a four-name drift. **Read code should read exactly one field, the canonical one.** If a
document might still only have the old field, write a migration script that backfills the
canonical field on existing documents (see the `scripts/migrate-*.cjs` pattern below), don't add a
runtime fallback to paper over it.

See `scripts/README.md` for the canonical Firestore collection/field reference these migrations
move things toward.

## `assignedInterventions`

| Legacy field | Canonical field | Status | Notes |
|---|---|---|---|
| `beneficiaryName` | `businessName` | **Fixed 2026-09-16** | Both write sites (`InterventionsAssignmentsPage.tsx`, `IncubateeRoadmapPage.tsx`) now write `businessName`. All read sites (`AllocatedInterventionsPage.tsx`, `assignedInterventionsService.ts`, `ConsultantWorkspaceUtils.ts`, `InterventionAppointmentsPage.tsx`) now read only `businessName`, no fallback. Existing documents backfilled via `scripts/migrate-assigned-interventions-business-name.cjs`. `beneficiaryName` stays on the `AssignedInterventionLike` type (marked `@deprecated`) purely so any code still holding an old document shape type-checks — don't write it from new code. |
| `snapshot.businessName` / `snapshot.programName` / `snapshot.interventionTitle` | *(removed)* | **Fixed 2026-09-16** | Never written by any `assignedInterventions` write path — only `interventionCompletions` writes a `snapshot`, a different collection. All `assignment.snapshot?.*` reads against `assignedInterventions` were dead code; removed. |

## Known drift not yet cleaned up

These still read from multiple field names or multiple collections. Left alone in the 2026-09-16
pass because they're either a genuine cross-collection join (not a simple rename) or touch more
surface than that pass covered — not because they're fine to leave forever.

| Location | Pattern | Why it's pending |
|---|---|---|
| `InterventionsMonitoringPage.tsx`, participant name resolution | `firstText(assignment.businessName, assignmentRecord.participantName, ..., participant?.businessName, ..., application?.businessName, application?.participantName, 'Unassigned SME')` | Deliberately joins `assignedInterventions` + `participants` + `applications` as a resilience measure, not just an old/new field rename on one collection. Needs its own pass to decide which collection should actually be authoritative before trimming. |
| `InterventionsAssignmentsPage.tsx`, participant loading (~line 243) | `application.beneficiaryName \|\| profile.beneficiaryName \|\| profile.businessName \|\| 'SME'` | Reads from `applications` / `businessProfiles`, not `assignedInterventions` — a separate migration from the one covered here. Those collections' canonical fields are already documented in `scripts/README.md`. |
| `directorPortfolioService.ts`, `projectAdminWorkspaceService.ts`, `SmeMetricsPage.tsx` | `programName: ... \|\| 'Unassigned'` | Looks like a legitimate "no program assigned yet" default rather than field-name drift — listed here so a future pass can confirm that (or fix it, if it turns out to be drift too). |

## How to add to this list

When you find a runtime fallback chain like `a.new || a.old || a.reallyOld` reading the same
concept from a document, that's drift:

1. Decide which name is canonical — prefer whatever `scripts/README.md`'s "Canonical Firestore
   collections" section already documents; if the field isn't documented there yet, add it.
2. Fix every write site to write only the canonical name.
3. Fix every read site to read only the canonical name, no fallback.
4. Write a one-off `scripts/migrate-*.cjs` (dry-run by default, `--apply` to write) that backfills
   the canonical field on existing documents from the legacy one. Don't delete the legacy field —
   additive-only backfills are safe to re-run and safe to leave in place.
5. Run it, then add a row to this file recording what changed, when, and which files were touched.
