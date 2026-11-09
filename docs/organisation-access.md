# Organisation access and registration notifications

New incubation operators choose **Request organisation access** during Welcome. Their request is stored at `organisationAccessRequests/{uid}` and their account remains a starter account until a System Admin approves it under **Organisation requests** (`/admin/organisation-requests`). Pending and rejected applicants see `/organisation-access` instead of the workspace. Approval grants the Director role and enables the existing organisation setup and consent flow.

Existing directors and admin-provisioned directors retain access. The company-setup backend no longer promotes self-registered SMEs or consultants to Director. Clients cannot write request decisions or change `organisationAccessStatus` on their profiles.

Notifications go to **daniel@quantilytix.co.za**, through the existing `mail` queue:

- Organisation requests: immediately after submission, once per applicant.
- Independent SME and freelance consultant registrations: once onboarding has established their final role and entry path. Incomplete registrations do not generate an email.
- SMEs joining through a validated programme link: no registration email. `joinProgramAsSme` records the protected `registrationProgramLink` field after validating the programme and organisation.
- Organisation staff: one first-staff milestone per organisation; no individual registration emails. The organisation owner is not counted as its first staff member. Already staffed organisations are baselined silently.

Notification records and their deterministic mail documents are written atomically. Persistent records in `registrationNotifications` and `organisationMilestones` prevent duplicate queue entries when Firestore events retry or arrive concurrently. These collections are backend-only. Delivery uses the existing email worker and its delivery logging.

## Validation

```powershell
npm --prefix functions run build
node --test functions/tests/organisationAccess.test.cjs functions/tests/organisationGate.test.cjs
npx tsc -b --pretty false
npx vite build
```

Load the repository's `firestore.rules` into a local Firestore emulator using project `demo-organisation-access`, then run the rules tests:

```powershell
$env:FIRESTORE_EMULATOR_HOST = '127.0.0.1:8189'
node --test functions/tests/firestoreOrganisationAccess.test.mjs
```

The rules tests reject non-local emulator hosts and never use the production project.

## Release dependencies

Deploy the rules and backend before publishing the frontend. Backend changes include `completeDirectorCompanySetup`, `joinProgramAsSme`, `createPlatformUser`, `createManagedUser`, `createParticipantAccount`, and `updatePlatformUser`, plus the new `submitOrganisationAccessRequest`, `decideOrganisationAccessRequest`, and `notifyNewRegistration` functions. `sendQueuedMail` must be configured and deployed for delivery. No migration of existing organisations is required.

This feature does not send an approval email to the applicant; the applicant's status page updates live and offers **Continue setup** after approval.
