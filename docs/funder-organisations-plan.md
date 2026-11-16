# Funder organisations: build plan

Status: plan only, nothing built. Mockups agreed 2026-11-14.

## Why

Today a funder account belongs to one company (`users.companyCode`) and sees that company's programmes (`users.assignedProgramIds`; empty means all). The invite paths refuse an email that already has an account, so a funder that funds projects at two implementors needs two logins and never sees a combined view.

## What was decided

- A **funder organisation** is a platform-level record, not owned by any one implementor.
- An implementor links one of its programmes to a funder organisation. The link goes live only when **both sides agree**: the implementor requests it and the funder accepts it.
- If the funder isn't on the platform, the implementor **invites** it (organisation name, contact name, work email). A lookalike name shows a warning that offers the existing organisation instead.
- A **system admin confirms** each new funder organisation, or merges it into an existing one. Unconfirmed organisations aren't offered to other implementors in search. The invited contact can sign in and see the pending link meanwhile, but no programme data shows until the organisation is confirmed and the link accepted.
- Funders see processed data only, as now. No SME contact details.

## Data model

All three are written only by Cloud Functions. Clients read, never write.

**`funderOrganisations/{orgId}`**
- `name`, `nameKey` (lowercased, punctuation and words like "the", "fund", "foundation", "trust" stripped, for the lookalike check), `type` (foundation, government, corporate, development finance, other)
- `status`: `invited` | `confirmed` | `merged`; `mergedInto` when merged
- `createdByCompany`, `createdBy`, `confirmedBy`, `confirmedAt`, timestamps

**`funderLinks/{programId}_{orgId}`**
- `programId`, `programName` (copy), `companyCode`, `companyName` (copy), `funderOrgId`
- `status`: `pending` | `active` | `declined` | `removed`
- `requestedBy`, `requestedAt`, `respondedBy`, `respondedAt`, `removedBy`, `removedAt`

**`users/{uid}` for an organisation funder**
- `role: 'funder'`, `funderOrgId`, **no `companyCode`**
- `funderProgramIds`: active-link programme IDs. `funderCompanyCodes`: their companies. Both are copies kept by the server so the rules can check them without a `get()` per document.

A funder with `companyCode` and no `funderOrgId` is a **legacy funder** and keeps working exactly as today until migrated (see Phase 5).

## Firestore rules (highest risk)

Rules are deployed straight from the repo, so this phase gets the most care.

1. Add the new helpers next to the existing funder helpers at `firestore.rules:212-233`:
   - `isOrgFunder()`: role `funder` and a non-empty `funderOrgId`
   - `orgFunderCanRead(data)`: `isOrgFunder()` and `data.programId in funderProgramIds` and `data.companyCode in funderCompanyCodes`
   - No "empty list means all" for organisation funders. Empty means nothing.
2. Wherever `funderCanRead` / `funderProgramAllows` are used, allow `orgFunderCanRead` too: the five places at lines 615, 653, 888-895, 1592 and 1697.
3. Add rules for `funderOrganisations` (signed-in users may read confirmed ones for search; members read their own; system admins read all) and `funderLinks` (the implementor's staff read their company's links; funder members read their organisation's links; system admins read all). No client writes.
4. **Empty-company audit.** Organisation funders have no `companyCode`, so `myCompany()` is `''`. Any rule shaped like `resource.data.get('companyCode','') == myCompany()` would match documents with no company. Go through every such comparison and require `myCompany() != ''`, or confirm the rule already excludes the `funder` role.
5. Compile with a dry run, then add emulator rules tests next to `functions/tests/firestoreOrganisationAccess.test.mjs`. Cover: an organisation funder reads linked programme data at two companies; is denied unlinked programmes, pending links and declined links; is denied after a link is removed; and is denied documents with no company. Also confirm legacy funders behave exactly as before.

## Cloud Functions

Put the pure logic (name key, lookalike match, link state changes, who may do what) in `functions/src/funderOrganisations.ts` with node tests, following `trainingOrganisations.ts`. The callables in `functions/src/index.ts`:

| Function | Who | Does |
|---|---|---|
| `searchFunderOrganisations` | implementor staff | confirmed organisations matching a name, plus lookalikes |
| `requestFunderLink` | director or project admin of the programme's company | creates a pending link, emails the organisation's members |
| `inviteFunderOrganisation` | same | creates an `invited` organisation, its first funder user (set-password link, same pattern as `inviteTrainingFunder`) and a pending link; queues a "needs confirming" email to system admins |
| `respondToFunderLink` | funder organisation member | accept or decline; accepting needs the organisation to be `confirmed` |
| `removeFunderLink` | either side | sets `removed` |
| `confirmFunderOrganisation` | system admin | `invited` to `confirmed`, emails the contact |
| `mergeFunderOrganisation` | system admin | moves members and links to the target organisation, marks the source `merged` |
| `resendFunderInvite`, `changeFunderInviteEmail` | the implementor that invited | while the contact hasn't signed in |

One helper, `syncFunderAccess(orgId)`, rebuilds `funderProgramIds` / `funderCompanyCodes` on every member of the organisation. Every function that changes a link, membership or merge calls it, as does an `onDocumentDeleted` trigger on `programs`. This is the only thing that grants an organisation funder access.

The existing-email rule stays: an account that already belongs to another role or organisation can't be pulled into a funder organisation.

## Data loading

- Refactor `getScopedDocs` and `listDirectorPortfolio` (`src/services/directorPortfolioService.ts:110-164`) to take a scope list, `{ companyCode, programIds }[]`, instead of reading `user.companyCode`. Legacy users get one entry built from their account, so nothing changes for them.
- An organisation funder's scope comes from their readable active `funderLinks`, grouped by company. Each company is queried separately with `companyCode ==` plus `programId in` (30 IDs per query, as now), and every row is tagged with its implementor.
- `loadFunderData` (`src/services/funderService.ts:135`) uses the scope list. Per-company extras such as `listKpis(companyCode)` are fetched once per implementor and shown under it, not added together.
- Check `firestore.indexes.json` covers `companyCode + programId` on each queried collection. The legacy path already uses them, so most should exist.

## Frontend

**Funder side**
- `/funder` dashboard: implementor filter pills, combined totals, a "Your projects" table and pending-link cards (Accept / Not our project), as mocked up.
- `/funder/portfolio`, `/funder/sectors`, `/funder/analytics`, `/funder/calendar`: the same implementor filter, with "All" by default.
- A waiting screen for a funder whose organisation isn't confirmed yet: "Your organisation is being confirmed", showing pending links but no data.

**Implementor side**
- "Funders of this programme" modal opened from the programme (a centred modal, per the modals-not-drawers rule): linked funders with Active / Pending / Invited status, search, "Request link", and "Invite a new funder" with the lookalike warning, resend and change email.
- Manage team: the "Funder" role option points to this modal for new funders. Legacy funders stay editable.

**System admin**
- `/admin/funder-organisations`: an "Awaiting confirmation" queue (confirm or merge) and a list of all organisations with team counts and linked projects. Add a link from the system admin navigation.

**Everywhere:** new strings go through `t()` with isiZulu catalogue entries. Routes for organisation funders must not assume `companyCode` (check `roleRouting.ts`, `workspacePath.ts`, `WelcomePage.tsx` and the programme switcher).

## Other pieces

- **AI backend:** `funder` already has no agent permissions (`set()`). Check that agent endpoints refuse an account with no `companyCode` instead of failing on it.
- **Email:** invite, link request, link accepted or declined, organisation confirmed. All go through the `mail` collection with deterministic document IDs so retries don't send twice.
- **Agentic home and dashboards** that list role homes (`AgenticHomePage.tsx`): confirm organisation funders land on `/funder`.

## Phases

1. **Model, functions and rules.** The pure-logic module with tests, the callables, `syncFunderAccess`, the rules changes, the empty-company audit and the emulator tests. Deploy rules and functions, which is safe because no client uses them yet.
2. **Data loading refactor.** The scope list, with legacy funders checked unchanged in a signed-in browser.
3. **Implementor modal and system admin page.** Inviting, requesting, confirming and merging, end to end with a test organisation.
4. **Funder dashboard across implementors.** Filter pills, accept cards, the waiting screen and the four sub-pages.
5. **Migrating legacy funders.** A system admin action, "Convert to funder organisation": creates or picks an organisation, creates **active** links for the funder's current programmes (they already use them, so acceptance is implied), moves the user over and clears `companyCode`. A funder linked to "all programmes" gets links to the programmes that exist on the day of migration.
6. **Training funders (later).** `trainingFunders.funderOrgId`, so the training funder report (`clientFunderSummary.ts`) can also combine across implementors.

## Validation

```powershell
npm --prefix functions run build
node --test functions/tests/funderOrganisations.test.cjs
npx tsc -b --pretty false
npx vite build
```

Rules: dry-run compile, then the emulator tests against a `demo-` project only. Release order: rules and functions first, then hosting.

## Answered questions (2026-11-14)

1. **Colleagues:** any member of a confirmed funder organisation can invite colleagues (`inviteFunderOrgColleague`).
2. **Removal:** the implementor that asked for the link is emailed when the funder removes it.
3. **Expiry:** link requests unanswered after 30 days (`LINK_REQUEST_DAYS`) become `expired`, a daily job (`expireFunderLinkRequests`) emails the implementor, and they can ask again.
4. **KPI targets:** shown separately per implementor, never added across implementors. Within one implementor, a funder organisation viewing all its programmes there sees: one programme's own target; for counts and amounts, the programme targets added up when every programme has one; for rates, days and ratings, the company's target; otherwise no target (`funderKpiTarget` in `funderService.ts`).

**Implementor filter:** a second dropdown next to the programme selector, shown only to funder organisation members, with "All implementors" first. Choosing one narrows the programme list to that implementor's programmes. This replaces the pills in the mockup.

## Progress

- **Phase 1 (written, not deployed, emulator tests not run):** `functions/src/funderOrganisations.ts`, the callables in `functions/src/index.ts`, rules, `functions/tests/funderOrganisations.test.cjs` (passes) and `functions/tests/firestoreFunderOrganisations.test.mjs` (needs Java 21+ for the emulator).
- **Phase 2 (written):** `src/services/funderScopeService.ts` (`loadDataScope`, `getDocsInScope`); `listDirectorPortfolio`, `loadFunderData` and the sectors page take the scope; `listWorkspacePrograms` returns an organisation funder's linked programmes with their company; the signed-in identity carries `funderOrgId`, `funderProgramIds` and `funderCompanyCodes`, live. Still company-only: `getFunderComplianceSummary` (Analytics compliance card) and the agent chat history, which keys on `companyCode`.
- **Phase 3 (written, not tried signed in):** `src/components/funders/ProgrammeFundersModal.tsx` (opened from the Funders icon on Programs for project admins, and from a programme's detail on Programme performance for directors), `src/pages/admin/FunderOrganisationsPage.tsx` at `/admin/funder-organisations` (confirm, merge, all organisations), `src/services/funderOrganisationsService.ts`, isiZulu in `src/config/i18n/zu/funderOrganisations.ts`. Links now carry `funderOrgStatus` and the invited contact (`funderOrgContactEmail`), because implementors can't read the organisation record. Not built yet: a system admin adding an organisation directly, without an implementor's invite.
- **Phase 4 (written, not tried signed in):** implementor dropdown next to the programme selector (`useActiveImplementor`, `SystemLayout.tsx`; only for funder organisations with two or more implementors) that narrows the programme list and every funder page (dashboard, portfolio, sectors, analytics, calendar); `FunderOrgPanel` on `/funder` (the "being confirmed" notice, link requests with Accept / Not our project, Programmes you fund with remove, Invite a colleague); Analytics KPIs grouped by implementor; `getFunderComplianceSummary` now works for funder organisations and takes the implementor. The Agentic home still loads all implementors.
- **Deployed 2026-11-14:** rules; the 13 funder functions; `createPlatformUser` and `updatePlatformUser` (every new funder needs a funder organisation, old-style funders keep working until converted); `createFunderOrg` and `convertCompanyFunder`.
- **Phase 5 (written and deployed, not tried signed in):** the Users page no longer offers "one company only": a funder always picks a funder organisation, and an old-style funder being edited shows a convert notice. On Funder organisations: "Add funder organisation" (confirmed at once) and a "Funders to convert" table, shown only while old-style funders exist. Converting makes the programmes they see today accepted links (all of the company's programmes on the day, when they had none picked), clears their company code and keeps the old values in `users.convertedFromCompany`. Training-module funders (`users.funderId`) aren't touched. Once none are left, the company-funder path can come out of the rules, `funderScopeService` and `funderCompliance`.
- **Funder Impact page (2026-11-15, written, not tried signed in):** `/funder/impact` (`src/pages/funder/FunderImpactPage.tsx`, data in `src/services/funderImpactService.ts`): funding committed, SMEs supported, jobs created and sustained, average revenue growth per SME, beneficiary profile (black-, black women-, women- and youth-owned at 51% or more, from applications), support delivered (interventions by area, hours of held appointments), and implementors or programmes compared with cost per job. Funding is a new rand amount on each link (`funderLinks.fundingAmount`), set by either side through `setFunderOrgLinkFunding` (deployed) from the programme funders modal or "Programmes you fund". Not covered: training beneficiaries, profit (SMEs don't report it), export to Word.
