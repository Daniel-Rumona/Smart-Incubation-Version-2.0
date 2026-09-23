# Firestore Migration Scripts

See `FIELD_MIGRATIONS.md` for the running registry of legacy-field -> canonical-field drift
found across the app, what's been fixed, and what's still pending. Check it before adding a
runtime fallback (`a.new || a.old`) for a field that looks renamed — the fix is almost always to
pick one field and migrate the data, not to keep both alive forever.

## Agent registry seed

Use `seed-agent-catalogue.cjs` to seed/update the `agents` collection (business-plan, strategic-plan, pitch-coach) used by the Firestore Agent Registry.

```bash
node scripts/seed-agent-catalogue.cjs --service-account ./new-service-account.json
```

Writes are merges, so re-running it is safe. See `firestore.rules` (project root) for the security rules this collection needs before going live — that file is currently incomplete and must be merged with your real rules before deploying.

## Demo/seed data for a user's "Assigned to me" page

Use `seed-assigned-interventions.cjs` to create N fake SME `participants` plus one
`assignedIntervention` per SME, assigned to a given user, so their "Assigned to me" page
(`AllocatedInterventionsPage`) has something to show. Dry run by default; every created document
is tagged with a `seedTag` and a manifest is written to `scripts/seed-output-<timestamp>.json` so
the batch can be undone.

```bash
node scripts/seed-assigned-interventions.cjs --service-account ./scripts/new-service-account.json --email user@example.com --count 20 --apply

# undo
node scripts/seed-assigned-interventions.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-<timestamp>.json --apply
```

## Demo/seed appointments for those dummy SMEs

Use `seed-appointments.cjs` to add `appointments` for a previous `seed-assigned-interventions.cjs`
run, so the Operations Reports "Appointments" tab and the intervention appointment calendar have
something to show. Reads the `seedTag` printed by that earlier run, creates 1-3 appointments per
assignment (a mix of already-"held"/completed ones with attendance captured, and still-"planned"
upcoming pending/accepted ones). Dry run by default; tagged and undoable the same way.

```bash
node scripts/seed-appointments.cjs --service-account ./scripts/new-service-account.json --seed-tag demo-assigned-<timestamp> --apply

# undo
node scripts/seed-appointments.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-appointments-<timestamp>.json --apply
```

## Backfilling history for those dummy SMEs (2025 onward)

Use `seed-historical-activity.cjs` to add more `assignedInterventions` + `appointments` for the
same dummy SMEs, dated across Jan 2025 - Jun 2026, so report trend charts have more than a
couple of months to show over a wider/custom date range. Reads participants by `seedTag`, adds
2-4 historical assignments per participant (mostly completed, some overdue/in-progress) plus one
appointment per assignment around the same date. Dry run by default; tagged and undoable.

```bash
node scripts/seed-historical-activity.cjs --service-account ./scripts/new-service-account.json --email user@example.com --seed-tag demo-assigned-<timestamp> --apply

# undo
node scripts/seed-historical-activity.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-historical-<timestamp>.json --apply
```

## Demo/seed applications for those dummy SMEs

Use `seed-applications.cjs` to backfill `applications` documents for the same dummy SMEs. They
were seeded straight into `participants` with no corresponding application, so Operations/Project
Admin Reports (acceptance rate, applicant demographic charts, intake trend) showed zero data for
this cohort. Reads participants by `seedTag`, creates one accepted application per participant
reusing their real businessName/email/phone/sector/stage/province/beeLevel/programId, plus
generated demographic fields (gender, age, hub, city, disability/education/employment/marital
status, location type, ownership percentages) so those charts have real data. Skips participants
that already have one from a previous run. Dry run by default; tagged and undoable.

```bash
node scripts/seed-applications.cjs --service-account ./scripts/new-service-account.json --seed-tag demo-assigned-<timestamp> --apply

# undo
node scripts/seed-applications.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-applications-<timestamp>.json --apply
```

## Demo revenue/employee trends for those dummy SMEs

Use `seed-sme-metrics.cjs` to backfill `revenue`/`employeeCount` plus 21 months (Jan 2025 -
current month) of `revenueHistory.monthly` / `headcountHistory.monthly` on the same dummy SMEs, so
the Operations "SME Impact" card and the SME Metrics page have real current-vs-previous-period
deltas and trend charts instead of zeros. Alternates each participant between a growing and a
declining trend (with natural month-to-month noise, not a straight line) so roughly half the SMEs
show impact growth and half show decline. This updates the existing `participants` documents in
place - it does not create any new documents. Dry run by default; undo clears just the fields this
script set.

```bash
node scripts/seed-sme-metrics.cjs --service-account ./scripts/new-service-account.json --seed-tag demo-assigned-<timestamp> --apply

# undo
node scripts/seed-sme-metrics.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-sme-metrics-<timestamp>.json --apply
```

## Linking dummy participants to their application (gender/demographics fix)

`seed-assigned-interventions.cjs` created the dummy participants with `applicationId: null`
(there was no application yet at that point), and `seed-applications.cjs` later created a
matching application for each one but never linked it back. Every page that shows an SME's gender
or other demographics falls back from the participant doc to its linked application doc via
`participant.applicationId` (`ParticipantsPage`, `SmeMetricsPage`'s merge, etc.) - with that link
null, the fallback never resolves, so gender reads blank everywhere even though the application
has it.

Use `link-participant-applications.cjs` to fix this: sets each participant's `applicationId` to
its matching application's id, and also copies `gender` directly onto the participant. Updates
existing `participants` documents in place - creates nothing new. Dry run by default; undo
restores each participant's previous `applicationId`/`gender`.

```bash
node scripts/link-participant-applications.cjs --service-account ./scripts/new-service-account.json --seed-tag demo-assigned-<timestamp> --apply

# undo
node scripts/link-participant-applications.cjs --service-account ./scripts/new-service-account.json --undo ./scripts/seed-output-participant-links-<timestamp>.json --apply
```

## `assignedInterventions.businessName` backfill

Use `migrate-assigned-interventions-business-name.cjs` to backfill `businessName` on
`assignedInterventions` documents that only have the legacy `beneficiaryName` field. Additive
only (doesn't touch `beneficiaryName`), safe to re-run. See `FIELD_MIGRATIONS.md`.

```bash
node scripts/migrate-assigned-interventions-business-name.cjs --service-account ./scripts/new-service-account.json --apply
```

## Smart schema cleanup

Use `migrate-firestore-collections.cjs` to migrate data from the legacy Firestore database into the new standardized collection structure.

Dry run first:

```bash
node scripts/migrate-firestore-collections.cjs --old ./old-service-account.json --new ./new-service-account.json
```

Write to the new database:

```bash
node scripts/migrate-firestore-collections.cjs --old ./old-service-account.json --new ./new-service-account.json --write
```

Overwrite/merge existing target documents:

```bash
node scripts/migrate-firestore-collections.cjs --old ./old-service-account.json --new ./new-service-account.json --write --overwrite
```

Run selected collections only:

```bash
node scripts/migrate-firestore-collections.cjs --old ./old-service-account.json --new ./new-service-account.json --only applications,participants,interventions --write
```

Skip selected collections:

```bash
node scripts/migrate-firestore-collections.cjs --old ./old-service-account.json --new ./new-service-account.json --skip usageSessions,usagePageViews --write
```

## Core schema decisions

- `beneficiaryName` is standardized to `businessName`.
- `participantName` remains the person/contact name.
- `participants` is the accepted/incubatee participant record.
- `applicantProfiles` stores applicant personal/contact details.
- `businessProfiles` stores the business/incubatee organization details.
- `interventions` migrates to `interventionDefinitions`.
- `interventionsDatabase` migrates to `interventionCompletions`.
- `assignedInterventions` remains active/in-progress assignment data.
- `participantComplianceTimeline` migrates to `complianceDocuments`.
- `indicativeCalender` migrates to the corrected `indicativeCalendar`.
- `programExpenses` migrates under each program as `programs/{programId}/expenses/{expenseId}`.

The migration writes only the normalized destination fields. It does not write `_legacy` audit payloads.

## Canonical Firestore collections

New pages and services should use the collections below. Do not introduce legacy aliases such as `beneficiaryName`, `interventionsDatabase`, or `participantComplianceTimeline`.

### `users`

Platform/auth user profile.

```ts
uid
email
name
displayName
phone
role
status
companyCode
departmentId
branchId
assignedProgramIds
permissions
avatarUrl
avatarPath
signatureURL
mustChangePassword
passwordChangedAt
firstLoginComplete
createdAt
createdBy
updatedAt
updatedBy
```

### `companies`

Tenant/company workspace settings. Logos belong here, not in a standalone `logos` collection.

```ts
companyCode
name
legalName
logoUrl
primaryColor
secondaryColor
address
contact
director
signatureURL
popia
modules
status
createdAt
updatedAt
updatedBy
```

### `branches`

Company branch/location records.

```ts
name
code
companyCode
location
contact
capacity
status
isActive
createdAt
createdBy
updatedAt
```

### `departments`

Support areas or departments.

```ts
name
departmentName
code
description
companyCode
manager
contactEmail
status
isActive
createdAt
createdBy
updatedAt
```

### `programs`

Incubation programmes/cohorts. Use this collection, not `incubationPrograms`.

```ts
name
title
description
companyCode
status
startDate
endDate
registrationLink
assignedAdmin
onboardingQuestions
eligibilityCriteria
complianceSummary
cohortYear
createdAt
createdBy
updatedAt
updatedBy
```

### `programs/{programId}/expenses`

Program-specific expenses. Do not use a top-level `programExpenses` collection for new writes.

```ts
programId
companyCode
amount
category
type
description
date
createdAt
createdBy
updatedAt
updatedBy
```

### `applicantProfiles`

Applicant personal/contact details before acceptance.

```ts
uid
participantName
email
phone
gender
idNumber
age
ageGroup
province
city
createdAt
updatedAt
```

### `businessProfiles`

Business/incubatee organization details. Use `businessName` only.

```ts
ownerUid
applicantProfileId
businessName
participantName
email
phone
sector
natureOfBusiness
stage
beeLevel
registrationNumber
dateOfRegistration
yearsOfTrading
developmentType
ownership
businessAddress
province
city
postalCode
hub
websiteUrl
socialMedia
swot
companyCode
programId
createdAt
updatedAt
```

### `applications`

Programme application submissions and review decisions.

```ts
uid
userId
applicantProfileId
businessProfileId
participantId
businessName
participantName
email
phone
gender
sector
stage
province
hub
programId
programName
companyCode
departmentId
status
applicationStatus
acceptedAt
reviewedAt
reviewedBy
requiredInterventions
complianceDocuments
swot
removedFromProgram
removedAt
removedReason
removedBy
aiEvaluation
aiScore
aiRecommendation
aiJustification
motivation
challenges
growthPlanDocUrl
submittedAt
createdAt
createdBy
updatedAt
updatedBy
```

### `participants`

Accepted incubatees only.

```ts
uid
applicationId
applicantProfileId
businessProfileId
programId
companyCode
departmentId
businessName
participantName
email
phone
sector
stage
province
beeLevel
status
acceptedAt
acceptedBy
exitReason
createdAt
updatedAt
```

### `complianceDocuments`

Participant compliance document records.

```ts
participantId
applicationId
programId
companyCode
departmentId
key
type
documentName
currentStatus
verificationStatus
verificationComment
issueDate
expiryDate
notes
fileName
url
storagePath
createdAt
createdBy
updatedAt
updatedBy
verifiedAt
verifiedBy
```

### `programComplianceRequirements`

Programme document/compliance requirements.

```ts
companyCode
programId
name
normalizedName
description
category
requirementType
isRequired
allowedFormats
maxSizeMB
version
isActive
isCustom
templateSource
createdAt
createdBy
updatedAt
```

### `interventionDefinitions`

Master list of interventions that can be offered.

```ts
interventionTitle
title
subtitle
areaOfSupport
department
departmentId
description
type
targetType
targetValue
targetMetric
isCompulsory
isRecurring
status
companyCode
createdAt
createdBy
updatedAt
updatedBy
```

### `assignedInterventions`

Active/in-progress intervention assignments.

```ts
companyCode
groupId
participantId
businessName
interventionDefinitionId
interventionId
interventionTitle
subtitle
type
implementationDate
dueDate
isRecurring
assigneeType
assigneeUid
assigneeId
assigneeName
assigneeEmail
status
assigneeStatus
participantStatus
completionStatus
assigneeCompletionStatus
participantCompletionStatus
participantAcceptedAt
completionConfirmedAt
completedAt
createdAt
createdBy
updatedAt
updatedBy
timeSpent
progress
notes
feedback
targetType
targetValue
targetMetric
areaOfSupport
overdueReason
overdueReasonBy
overdueReasonAt
resources
reassignmentHistory
snapshot
```

### `interventionCompletions`

Completed intervention history only.

```ts
assignedInterventionId
participantId
programId
companyCode
departmentId
interventionDefinitionId
interventionId
interventionTitle
areaOfSupport
department
method
interventionDate
completedAt
status
feedback
rating
comments
mov
snapshot
createdAt
createdBy
updatedAt
updatedBy
```

### `diagnosticPlans`

Diagnostic/growth plan records.

```ts
participantId
applicationId
programId
companyCode
status
confirmed
confirmedBy
confirmedMeta
confirmedAt
swot
interventions
createdAt
createdBy
updatedAt
updatedBy
```

### `interventionRequests`

Intervention requests submitted by participants.

```ts
participantId
programId
companyCode
departmentId
areaOfSupport
interventionTitle
reason
status
requestedAt
reviewedAt
reviewedBy
assignedInterventionId
createdAt
updatedAt
```

### `formTemplates`

Reusable survey/assessment templates.

```ts
title
description
fields
status
kind
companyCode
settings
createdBy
createdAt
updatedAt
```

### `formAssignments`

Assigned survey/assessment work.

```ts
templateId
templateTitle
applicationId
participantId
recipientEmail
recipientName
companyCode
status
assignedAt
assignedBy
createdAt
updatedAt
```

### `formRequests`

Form request attempts for a participant.

```ts
templateId
formId
participantId
participantName
participantEmail
companyCode
status
attemptCount
createdAt
updatedAt
```

### `formResponses`

Submitted form answers/results.

```ts
templateId
formId
requestId
formTitle
kind
companyCode
participantId
submittedBy
submittedAt
status
answers
completion
timing
score
grade
createdAt
updatedAt
```

### `notifications`

User/role notifications. Avoid migrating or writing notifications for users who do not exist in the new database.

```ts
to
userId
participantId
title
message
type
read
readBy
companyCode
metadata
createdAt
updatedAt
```

### Operational support collections

These collections remain top-level operational records:

```txt
appointments
assignees
consultants
courses
enrollments
events
expenseTypes
groupAssignments
indicativeCalendar
inquiries
invoices
leaveRequests
operationsStaff
resourceAllocations
resourceRequests
resources
smeIntakeSubmissions
successStories
supportPrograms
systemSettingsChangeRequests
taskReminders
tasks
emailTemplates
usageSessions
usagePageViews
```

### Field naming rules

- Use `businessName` for the SME/business/incubatee entity.
- Use `participantName` for the person/contact.
- Use `participantStatus`, not `beneficiaryStatus` or `incubateeStatus`.
- Use `participantCompletionStatus`, not `beneficiaryCompletionStatus` or `incubateeCompletionStatus`.
- Use `interventionDefinitions` for the catalog and `interventionCompletions` for completed work.
- Use `complianceDocuments`, not `participantComplianceTimeline`.
- Use `programs`, not `incubationPrograms`.
