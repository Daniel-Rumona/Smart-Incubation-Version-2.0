# 13. Awareness Training and ESG Reporting (client modules)

Built for one client: Tau Namagadi Sustainable Solutions, which runs ESG awareness trainings (in person or online) for staff of client organisations. It must never change anything for other companies.

## Isolation: how it stays off for everyone else

- **Client module switch:** `companies/{code}.awarenessTrainingEnabled === true`, set by a system admin on **Admin > Client modules** (`/admin/client-modules`). The switch is off unless set; unlike plan features (`config/entitlements.ts`), legacy companies do **not** get it. Definition: `src/config/clientModules.ts`.
- **Routes:** every training route carries `requiredSetting: 'awarenessTrainingEnabled'`. `ProtectedRoute` blocks the URL and `SystemLayout` drops it from the menu, quick links and search unless the company setting is true.
- **Data:** new collections only, every document carries `companyCode`, every query filters on it. `firestore.rules` (section "Awareness training") reads the same company switch before allowing anything.
- **Learner accounts:** the new role `learner` can only be created by `createPlatformUser` for a company with the module on (`functions/src/trainingLearners.ts`). An existing account is reused only if it is already a learner of the same company; staff and SME accounts are never taken over.
- **Home page (optional):** `companies/{code}.clientHomeModule = 'awarenessTraining'` (also on the Client modules page) makes Training the staff home and swaps the Agentic home for the training one. Their Workspace Home is `/training/home`, an overview of four figures (learners trained, pass rate, revenue this year, client organisations) and two charts (revenue and learners trained per month), taken from the funder summary so they match the funder report. Classes is its own top-bar link. The top bar is Home, Classes, Assessments, ESG reports and Revenue; phones show the first three after Home, and Revenue moves into the Menu. It also trims their menu and top bar to the module plus `keepPaths` (Programs, Applications) in `config/clientModules.ts`: SMEs, interventions, diagnostic plans, staff, risks, reports and KPIs leave it (as for Training SMEs, links to them still open). Without it, a company keeps its standard dashboard, menu and Agentic home.
- **Assistant:** `ai-backend/client_modules.py` gives a training-workspace persona only for companies with the module on, and never adds the shared cross-company collection snapshots to training pages.

## Who uses what

| Person | Role | Pages |
|---|---|---|
| Facilitator (the client) | `projectadmin` (or `operations`) in the client's company | `/training/home`, `/training/classes`, `/training/classes/:id`, `/training/assessments`, `/training/companies`, `/training/library` |
| Learner | `learner` | `/learner`, `/learner/tests/:submissionId` |
| A client company's director or coordinator | `clientorg` (`users.organisationId`, `users.orgRole` `director` or `coordinator`) | `/company` (home: people, booking, team), `/company/certificates`, `/company/assessments`, `/company/documents`, `/company/business`, `/company/esg`; no assistant, no Agentic home |
| Quantilytix | `systemadmin` | `/admin/client-modules` |

## Data model (`src/types/training.ts`)

| Collection | Holds | Who reads |
|---|---|---|
| `trainingClasses` | Course, in person (`venue`), online (`meetingUrl`; Zoom/Teams/Meet recognised by `utils/meetingLinks.ts`) or `hybrid` (both), dates, daily `hours` (`HH:mm`) with `dayHours` for days that differ, pass rule, `testsOpen`, `learnerUids` | Staff; learners in `learnerUids`; the company's client companies |
| `trainingLearners` | Learner, organisation (and `organisationId` once that company is registered), ID/passport number, account `uid`, attendance per day (in a hybrid class each mark says `in_person` or `online`), ID copy record, `bookedBy` when the client company booked them | Staff; the learner (own record); their client company |
| `trainingOrganisations` | The client companies: name, contact person and email, phone | Staff; the company's own people |
| `trainingLibrary` | Library items: file (under `training-library/{company}/{item}/`) or link, title, description, type, course (`''` = all), `audience` `shared` or `staff` | Staff; learners and client companies (shared items only) |
| `trainingLibraryTexts/{itemId}` | The text read out of PDF, Word and text files, for the assistant | **Staff only** (and the AI backend) |
| `trainingFunders` | The company's funders: name, contact person and email | Staff; a funder reads its own record |
| `trainingSettings/{company}` | Which details to ask of client companies (fields and documents) and of learners | Staff write; learners and client companies read |
| `trainingOrgMetrics/{organisationId}_{YYYY-MM}` | A client company's revenue and employees for a month | Staff; the company's own people (read and write) |
| `trainingAssessments` | Knowledge test questions, case brief, group rubric | Staff; learners of the company |
| `trainingAssessmentMemos/{assessmentId}` | Memo answers | **Staff only** |
| `trainingSubmissions/{learnerId}__{pre\|post}__{attempt}` | Test attempts, answers, marks | Staff; the learner (own) |
| `trainingGroups` | Group case assignment: members, rubric marks, who did not take part | Staff |

| `trainingCertificates` | Full certificate as issued (names, course, dates, logo, signature, number, status) | Staff; the learner (own) |
| `certificateVerifications/{certificateId}` | Only what is printed: name, course, dates, provider, number, status | **Anyone with the id** (get only, never list) |
| `trainingCertificateCounters/{company}_{year}` | Next certificate number | Staff |
| `esgReports` | One client's ESG report: client, sector, country, period, publication date, claim, frameworks, the four registers (data, risks, stakeholders, actions), the written sections, the carbon footprint (`footprint`: sources with monthly usage, factor and factor source; carbon tax payer; allowances) and approval / assurance (`src/types/esg.ts`) | ESG staff (module `esgReporting` on) |
| `clientRevenue` | The company's own income: date, client organisation, training / ESG reporting / other, linked class or report, amount, invoiced or paid (`src/types/clientRevenue.ts`) | Staff of a company with either module on; **never the funder** |
| `trainingSurveys` | A survey: title, description, learners (chosen classes) or client companies, hide names, draft / open / closed, questions (rating, choice, yes / no, written) (`src/types/trainingSurveys.ts`) | Staff (module on); its audience once open or closed |
| `trainingSurveyResponses` | One person's answers to a survey (`{surveyId}__{uid}`): class or organisation, name (unless hidden), answers | Staff; the person themselves |

Each assessment is **used as** a pre-assessment, a post-assessment or both (`use`). A class has its post-assessment (`assessmentId`, which also holds the group rubric) and, when it differs, its own pre-assessment (`preAssessmentId`); every attempt records the assessment it was written on, and marking uses that assessment's memo. Older assessments count as both.

The app says "assessment" throughout: the pre-assessment (diagnostic, not counted) and the post-assessment (counted); the code keeps its old names (`kind: 'pre' | 'post'`, `testsOpen`). A class is "Upcoming", "Day 2 of 3" while it runs (filter: "Ongoing") and "Finished" once the last day's end time has passed.

Pass rule (`utils/trainingResults.ts`): best marked post-test ≥ the class pass mark, plus taking part in a marked group when the class requires it. Attendance is recorded, never required. Reassessments: up to `reassessmentsAllowed` further post-test attempts while below the pass mark.

## Learners from Excel

- **Import from Excel** (class > Learners) reads an `.xlsx` workbook or a CSV (`utils/learnerSpreadsheet.ts`, no extra library: the workbook is read with PizZip like the Word import). It finds the sheet and header row that look most like a learner list, so the facilitator's own toolkit register (sheet "Attendance": Learner name, Organisation, Day 1, ...) works as it is; Email, ID or passport and Phone columns are taken when present. A template with those columns can be downloaded from the same window (ID and phone columns formatted as text so Excel keeps leading zeros).
- The preview marks each row: ready, no email (added, cannot be invited yet), already in the class, twice in the file, email not valid or no organisation (an "Organisation for rows without one" box fills those). A learner matches on email, or on name and organisation, in the window and in `addTrainingLearners` (one batch, at most 500 rows), so importing the same sheet twice adds nobody twice.
- Email and ID number are optional on learners now (a register has neither): the learner shows "Details to complete", Invite is replaced by "No email" until the email is added, and Invite all skips them.

## Courses without group work

- An assessment's group case and rubric are optional. A class's "Group assignment needed to pass" switch follows its assessment: on by default when the assessment has a rubric, off and locked when it has none (learners then pass on the post-test alone).
- The Group assignment tab and the results' group column show only when the class needs group work, its assessment has a rubric, or groups already exist.

## Certificates

- **Issued automatically** the moment a learner meets the pass rule (the class page issues it in a transaction, so two facilitators with the class open cannot issue two). Numbered per company per year: `TNS-2026-0001`.
- **Printed:** "Certificate of Completion", learner and organisation, course, training dates and delivery, the non-credit-bearing statement from the client's own material, the company logo, the issuing facilitator's saved signature and name, the number, issue date and a QR code to `/verify/{certificateId}`.
- **PDF:** drawn on a canvas and saved as a one-page A4 landscape PDF by `utils/certificatePdf.ts` (no PDF library). Logo and signature are fetched like the agreement documents' images, so they need the bucket CORS setting below; without it the certificate is produced without them.
- **Reissue / cancel:** never deleted. Reissuing cancels the old one (its verification page says so) and issues a new number; used after correcting a learner's details.
- **Partner logo (e.g. GRI):** printed only when `companies/{code}.trainingCertificatePartnerLogoUrl` is set. Leave it unset until the body has given written permission to use its logo.
- **Verification page:** `/verify/:certificateId`, public, no sign-in. Shows valid / cancelled / not found and the printed details only.

## ESG reporting (client module `esgReporting`)

- **The report page**: the header says which standards it follows (with **Change**), and four tabs: **1. Figures** (what is measured, unit, baseline, current, target; **More detail** shows the toolkit's other columns: period, owner, evidence, quality check, GRI disclosure), **2. Carbon footprint** (below), **3. Written report** (sections written, things to check, the ten sections in a list that opens, AI drafts, the Word report) and **More** (the full standards and why, risks, stakeholders, actions and the GRI content index, each marked optional). The reports list shows the same measure as the report page, **Sections written** ("3/10"), so the two never disagree.
- **Matched to her example reports** (November 2026: she sent Anglo American Platinum's and Sasol's 2023 sustainability reports as the layout she wants, plus her carbon footprint workbook and her "Sustainability / Carbon Tax" deck; her Eskom 2025 PDF arrived damaged). Her reports carry Scope 1, 2 and 3; the platform now does too, without the errors in her own material (her workbook is a Canadian template with Alberta's 0.88 t/MWh grid factor; her deck applied the carbon tax rate to total emissions).
- **Carbon footprint** (`src/config/esgEmissions.ts`, `components/esg/EsgFootprintPanel.tsx`, saved as `esgReports.footprint`):
  - Sources month by month over the reporting period's twelve months. Scope 1: company vehicles (diesel, petrol), generators, LPG (kg or litres), natural gas (GJ), coal, paraffin. Scope 2: grid electricity. Scope 3: grid losses, commuting fuel, car km, flights under / over 3 700 km. Any other source with its own unit and factor.
  - Each line stores its factor (kg CO2e per unit) **and its source text**, copied when the line is added, so a report stays as calculated when factors are updated. Factors can be edited.
  - Electricity: DFFE's national generation grid emission factor (the one DFFE gives for Scope 2), for the period's data year or the latest published: 2021 0.985, 2022 0.931, 2023 0.906, 2024 0.960 t/MWh (Gazette 55353, 11 Sep 2026). Grid losses: transmission + distribution factors. Türkiye: the Ministry of Energy's consumption point factor (ETKB-EVÇED-FRM-042, 2023 data, published 26 Dec 2025): 0.469 t/MWh for consumers on the distribution grid, 0.436 for sites fed from the transmission grid; it already includes grid losses, so the grid-losses line is not offered. United Kingdom: DESNZ 2025 (0.177, losses 0.01853). Other countries: the grid factor is left blank for the country's own factor (flagged until entered). Add a country by adding rows to `GRID_FACTORS` in `config/esgEmissions.ts`.
  - Fuels, cars and flights: UK DESNZ greenhouse gas conversion factors 2025 (100% mineral diesel 2.66155 and petrol 2.33984 kg/litre, LPG, natural gas, coal, burning oil; flights with radiative forcing), read from DESNZ's own flat file.
  - Saving puts each recorded scope's total in the figures as GRI 305-1/2/3 (updating the client's own Scope line if it has one, keeping its name, baseline and target), so the content index, the checks and the AI draft all use them.
  - **Import carbon footprint workbook** reads her calculator (blocks headed Month / Usage on any sheet): usage comes across by month name into the period; her factors are replaced by the current ones (the import lists each change); blocks it has no factor for become custom lines.
  - **Carbon tax** (South African clients only): "Does the client pay carbon tax directly?" No / Yes / Not sure. Only companies running activities listed in the Carbon Tax Act above the thresholds pay it, only on Scope 1. If yes: Scope 1 from the ticked fuels (coal, gas, LPG, paraffin; petrol and diesel are taxed at the pump), each month at its calendar year's rate (R144 2022, R159 2023, R190 2024, R236 2025, R308 2026; later years use the latest announced rate and say so), less the allowances claimed (60% basic, at most 95%). Always shown as an estimate: the SARS return decides.
- **Approval and assurance** (Report details): who approved the report, their role and the date (GRI 2-14), and how the figures were checked: not independently, internally, or independent limited / reasonable assurance and by whom (GRI 2-5). A Final report without an approval is flagged.

A second client module (`companies/{code}.esgReportingEnabled`, switched on beside training on Admin > Client modules). Pages: **ESG reports** (`/esg/reports`) and one report (`/esg/reports/:id`, tabs Standards, Data, Risks, Stakeholders, Actions, Report).

- **Standards chosen for her** (`src/config/esgStandards.ts`):
  - GRI Universal Standards always.
  - The GRI Sector Standard from the client's sector: GRI 11 oil and gas, 12 coal, 13 agriculture/aquaculture/fishing, 14 mining. Other sectors have none, and the page says so.
  - The Topic Standards behind the data: each indicator links to a GRI disclosure, suggested from its name.
  - National and regional frameworks suggested from the client's country:
    - Türkiye: TSRS 1 and 2.
    - South Africa: JSE Sustainability and Climate Disclosure Guidance; King IV, or King V for financial years starting from 1 January 2026.
    - EU: ESRS.
    - IFRS S1/S2 can be added for any country, and other rules as free text.
  - GRI Standards apply by the report's **publication date**:
    - Reports published from 2026 use GRI 101 instead of GRI 304.
    - Reports published from 2027 use GRI 102 and GRI 103 instead of GRI 305 (plus 201-2) and GRI 302.
  - Effective dates were checked in November 2026. The ESRS entry says to check its status, because the EU simplification is still settling.
- **Only references** (numbers and short titles) are stored, never GRI's text. Before charging for reports built on this, check **GRI's Licensed Software & Tools Program**.
- **Registers** follow her ESG toolkit workbook column for column. **Import ESG toolkit** reads its four sheets (ESG Data Register, ESG Risk Register, Stakeholder Map, 90 Day Action Plan) from her own file (`utils/esgToolkitImport.ts`), adding to or replacing the registers.
- **Checks** (`utils/esgReportChecks.ts`):
  - missing period, values, units, evidence or GRI links
  - more than 50% change from the baseline
  - risks without controls or scores
  - no stakeholders
  - the GRI 2 disclosures an "in accordance with" claim needs
  - a completeness %
- **Written sections**: ten sections (About, Message from leadership, Strategy, Material topics, Environmental, Climate change and energy, Social, Governance, Stakeholder engagement, Targets and next steps). Each can be written by hand or drafted with **AI**: `POST /api/esg/draft` in `ai-backend/esg_report_agent.py`.
  - The backend reads the saved report itself, for the caller's own company only, staff only, module on.
  - The model is told to use only that data, including the footprint totals by scope and source (as the report writes them, "2 311.63"). It states the carbon tax position but is never given a tax amount.
  - Every figure in a draft is checked against the data, and those not found are shown as "Not in the data" until edited.
  - A one-section draft takes about two minutes on the current Gemini model.
- **GRI content index** is built from the links and sections (plus 2-5 always, 2-14 once approved, and 305-1/2/3 at Climate change and energy). The statement of use reads "with reference to" (default) or "in accordance with".
- **Word report** (`utils/esgReportDocx.ts`, the `docx` library), set out like her example reports: cover with the provider's logo; contents; About this report with the reporting basis (standards, statement of use, GHG method, assurance); **Performance at a glance** (the footprint, and up to six headline figures per pillar with the change on the baseline); the leadership message and written sections; **Climate change and energy** (emissions by scope with shares, by source with activity and factor, the carbon tax position or estimate, the method and every factor's source); **Approval and assurance**; then landscape **Performance data** tables per pillar (baseline, current, target, change, evidence, GRI), the registers, the footprint's monthly activity data, the GRI content index and abbreviations. A DRAFT mark appears until the status is Final. The client company's ESG report page downloads the same document.

## Client companies (`clientorg`)

- **Companies** (`/training/companies`): every company Keletso trains. Names on learners that are not registered yet are listed too, with **Register**. Registering (or renaming) a company links the learners who carry its name (`organisationId`); learners added or imported later are linked by name as they are saved (`trainingService.ts`).
- **Access:** Keletso gives each company its **director** (`inviteTrainingOrganisationMember`, `functions/src/trainingOrganisations.ts`); the director adds **coordinators**. Nobody else can give these roles, a coordinator cannot add anyone, and an email that already has another kind of account is refused (it is never taken over). The account's company and role (`organisationId`, `orgRole`) can only be set by that function: firestore.rules refuses a self-edit of either.
- **What the company sees** (`/company`): its own people in every class with dates and hours, days attended and certificate (number and status through the public verification record), the classes it can book, the shared library and, for the director, its team. It books people into a class (details only; Keletso still invites them) and can withdraw a booking until they are invited. It never sees other companies' people, assessments, marks, ID copies, ESG reports, revenue or the facilitator's accounts, and has no assistant (the assistant's default context is not company-scoped).
- **The company's pages:** **Certificates** (its people's certificates: download and verification; certificates carry `organisationId`, set when issued and when the company is registered), **Assessments** (each person's pre- and post-assessment scores, what is waiting to be marked and who can write now, from the callable `getOrganisationTrainingResults`, `functions/src/organisationResults.ts`: scores only, never questions, answers or memo), **Documents** (its own company documents and the course materials shared with it), **Business metrics** (its details, and revenue and employees month by month against its yearly baseline) and **ESG report** (its reports once **In review** or **Final**, never a draft, read-only with the Word report; `esgReports.organisationId` is set from the client name).
- **The funder report** adds the businesses' revenue now (their monthly figures of the last 12 months as a yearly rate) against their combined baseline.
- **In the class**, learners are shown per company (a section each, and a chip per company to show one at a time) on Learners, Attendance and Results.

## Business details and documents

- **What to ask** (Companies > **Details to ask for**, `trainingSettings/{company}`): Keletso picks from what Smartinc already asks of SMEs (`src/config/trainingDetails.ts`): company details (registration number, sector, B-BBEE level, ownership, address, province, employees, baseline revenue, ...), company documents (the compliance catalogue: CIPC registration, B-BBEE certificate, tax compliance, ...) and learner details (gender, date of birth, population group, disability, education, job title). A short list is asked until she chooses.
- **After the invite**, a company's director (or coordinator) sees the details step before anything else on `/company`; they can save and finish later, and the page opens once the details are sent. Afterwards a card and a reminder show what is still missing. Keletso sees and corrects the details and documents in the company's drawer.
- **Learner details** are asked when Keletso adds a learner, when a company books one, and on the learner's page (**Your details**) while any is missing.
- **Rules:** a company's own people may change only `details`, `documents` and `detailsSubmittedAt` on its record, with known field names only; a learner only their own `details`, known fields only; a booking may carry known details only. Documents sit under `training-org-documents/{company}/{organisation}/` (PDF, JPG, PNG; 10 MB), readable by the company's people and the training company's staff.

## Funders: each sees only what it funded

- Keletso adds each funder on **Funder report > Funders** and gives its contact a sign-in (`inviteTrainingFunder`: role `funder` with `users.funderId`, which only that function sets; a self-edit of it is refused).
- **Funded by** is set on a class (its learners count for that funder), on a learner (a different funder from the class's), on an ESG report and on an income entry (otherwise income follows its class or report).
- `getClientFunderSummary` (`functions/src/clientFunderSummary.ts`, `fundedBy`) filters everything to the caller's funder: one funder never sees another's learners, revenue, reports or companies, and a funder account without a funder record sees nothing. Staff see the whole company, or **as a funder sees it** to check.
- The report adds the people trained (women and men, youth under 35, disability: as given, or read from a valid South African ID number) and the businesses served (baseline revenue, employees, B-BBEE levels, from their details). When nobody's age is known, the youth figure shows a dash rather than 0.
- A new class copies the latest class's course set-up (course, hours, assessments, pass mark) but, like the venue and link, never its funder: a class only counts for a funder when Keletso picks one.

## Library

- **Documents, not typed notes** (`/training/library`): **Upload documents** takes one or many files at once (PDF, Word, PowerPoint, Excel, text, pictures; 25 MB each). Each document's title, type, course and who sees it are filled in from its file name and can be changed before uploading (`utils/trainingLibraryGuess.ts`); nothing has to be typed. Saving uploads them one by one with progress, and failed files can be retried.
- **Guessing from the file name:** facilitator, memo and marking files are references for her team only; templates, toolkits, forms and registers are templates; manuals, slides, modules and learner material are course material; other guides are shared references; everything else is reading. Her course is chosen when she has only one.
- **Links** (a website, a video) are a secondary option. Descriptions are no longer typed; ones saved earlier still show.
- Who sees it: **Learners and client companies** or **Only my team**. Learners see the shared items for their course under **Course materials** on their training page; client companies see every shared item on their page. Files are opened through the storage rules, never by a shareable link.
- **Q** reads the text of PDF, Word and text files (extracted in the browser on upload, `trainingLibraryTexts`). `library_context` in `ai-backend/client_modules.py` adds the catalogue and the passages that share the most words with the question; learners and client companies only ever get shared items, and the persona says never to use it to help a learner answer an assessment.
- **Local data** seeds her own training pack (Learner Manual, Facilitator Guide, Assessments and Memorandum, ESG Implementation Toolkit) when `ESG_AWARENESS_TRAINING_MATERIAL.zip` is in the repo root; the Word files' text is what Q reads.

## Surveys

- **Surveys** (`/training/surveys`, in her top bar after Assessments; `types/trainingSurveys.ts`, `services/trainingSurveysService.ts`, `utils/trainingSurveyResults.ts`). Kept apart from the incubator surveys (`formTemplates`), which go to a programme's SMEs and which any signed-in user can read.
- **Ready-made:** her training pack's **participant feedback form** (three 1 to 5 ratings: objectives clear, examples relevant, can name three ESG actions; most useful activity; suggested improvement, optional), a **client company satisfaction** questionnaire, or a blank survey. A new feedback form is set for the class running or just finished.
- **Questions:** rating 1 to 5, one of several choices, yes or no, or a written answer; each required or optional, in any order. A survey is a **draft** (only she sees it) until she opens it; she can close it and open it again. Changing questions after answers came in shows a warning.
- **Who answers:** learners of the chosen classes (or every class) on their training page and at `/learner/surveys/:id`; or every registered client company, on its company home and its **Surveys** page (`/company/surveys`). Each person answers once (`trainingSurveyResponses/{surveyId}__{uid}`) and can change the answers while the survey is open. **Hide names** shows the answers without names (they are still one per person).
- **Answers:** how many answered (and of how many learners), the average rating overall and per question with the 1 to 5 spread, counts for choices and yes / no, the written answers with who wrote them, and **Download answers (Excel)** (CSV, one row per person). Q sees the summary on the survey page.
- **Rules** (`firestore.rules`): staff of the company with training on build and read everything; an open or closed survey is read only by its audience in the same company (learners, or client companies); an answer is written only by that person, while the survey is open, for a class they are in (learners) or their own organisation (client companies), with no other fields. Checked with real sign-ins: 34 checks.

## Revenue and the funder report

- **Revenue** (Training > Revenue, `/training/revenue`): staff record each invoice (date, client, training / ESG reporting / other, optional class or report, amount, invoiced or paid). The page shows this month, the last 12 months, paid and outstanding, and a chart by month and service.
- **Funder**: Keletso gives her funder a sign-in from **Funder report > Funder access**. This uses `createPlatformUser` with role `funder`, which project admins may already create in their own company. The funder lands on `/training/funder` and has nothing else: no Agentic home, and every other page is refused.
- **What the funder sees** comes from the callable `getClientFunderSummary` (`functions/src/clientFunderSummary.ts`), **totals only**:
  - revenue by month and service, paid and outstanding
  - classes run, learners trained and certified, and the pass rate
  - ESG reports, and their countries and sectors
  - client organisations with their counts
- **What the funder never sees**: no learner names, ID numbers or contact details. The funder cannot read the underlying records at all (firestore.rules); staff see the same report to check what is shared.

## Deployment checklist (nothing here has been deployed)

1. **Firestore rules:** `firestore.rules` (deployed from the repo).
2. **Cloud Functions:** `createPlatformUser` change, `functions/src/trainingLearners.ts`, and the new callables `getClientFunderSummary` (`functions/src/clientFunderSummary.ts`) `inviteTrainingOrganisationMember` and `inviteTrainingFunder` (`functions/src/trainingOrganisations.ts`), and `getOrganisationTrainingResults` (`functions/src/organisationResults.ts`).
3. **AI backend:** `ai-backend/client_modules.py` (persona and library), `ai-backend/esg_report_agent.py` (router registered in `app.py`) and the `/api/agent` change in `app.py`.
4. **Storage rules (manual merge):** the repo holds no storage rules; the live ones are in the Firebase Console. **Merge** this block into them - do not deploy it as a file on its own, it would replace the rules for every other path. It was tested on the emulators.

```
match /training-id-documents/{companyCode}/{learnerId}/{fileName} {
  function isTrainingStaff() {
    let profile = firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data;
    return request.auth != null
      && profile.get('role', '') in ['projectadmin', 'operations']
      && profile.get('companyCode', '') == companyCode;
  }
  function isTheLearner() {
    let learner = firestore.get(/databases/(default)/documents/trainingLearners/$(learnerId)).data;
    return request.auth != null
      && learner.get('uid', '') == request.auth.uid
      && learner.get('companyCode', '') == companyCode;
  }
  function isIdFile() {
    return request.resource.size <= 10 * 1024 * 1024
      && request.resource.contentType.matches('application/pdf|image/(jpeg|png|webp)');
  }
  allow read, delete: if isTrainingStaff() || isTheLearner();
  allow create: if (isTrainingStaff() || isTheLearner()) && isIdFile();
  allow update: if false;
}

match /training-library/{companyCode}/{itemId}/{fileName} {
  function profile() {
    return firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data;
  }
  function isTrainingStaff() {
    return request.auth != null
      && profile().get('role', '') in ['projectadmin', 'operations']
      && profile().get('companyCode', '') == companyCode;
  }
  function isSharedWithMe() {
    let item = firestore.get(/databases/(default)/documents/trainingLibrary/$(itemId)).data;
    return request.auth != null
      && profile().get('role', '') in ['learner', 'clientorg']
      && profile().get('companyCode', '') == companyCode
      && item.get('companyCode', '') == companyCode
      && item.get('audience', '') == 'shared';
  }
  allow read: if isTrainingStaff() || isSharedWithMe();
  allow create: if isTrainingStaff() && request.resource.size <= 25 * 1024 * 1024;
  allow delete: if isTrainingStaff();
  allow update: if false;
}
```

```
match /training-org-documents/{companyCode}/{organisationId}/{fileName} {
  function profile() {
    return firestore.get(/databases/(default)/documents/users/$(request.auth.uid)).data;
  }
  function mayUse() {
    return request.auth != null
      && profile().get('companyCode', '') == companyCode
      && (profile().get('role', '') in ['projectadmin', 'operations']
        || (profile().get('role', '') == 'clientorg' && profile().get('organisationId', '') == organisationId));
  }
  allow read, delete: if mayUse();
  allow create: if mayUse()
    && request.resource.size <= 10 * 1024 * 1024
    && request.resource.contentType.matches('application/pdf|image/(jpeg|png)');
  allow update: if false;
}
```

   If the live rules have a catch-all `match /{folder}/{allPaths=**}` open to signed-in users, exclude `training-library` and `training-org-documents` from it as well as `training-id-documents` (see `emulators/storage.rules`).

5. **Bucket CORS:** ID copies are opened with `getBlob` (never a shareable download link), and certificates fetch the logo and signature to draw them; both need the bucket to allow `GET` from the app's origins: `gsutil cors set cors.json gs://<bucket>` with the production and local origins.

## Testing locally (Firebase emulators)

Everything runs on this PC against the emulators of the `demo-smartinc` project; nothing reaches the real Firebase project.

```
npm run emulators                     # terminal 1: Auth, Firestore, Storage, Functions (+ UI on http://127.0.0.1:4000), then seeds them
npm run dev:emulators                 # terminal 2: the app on http://localhost:5173, pointed at the emulators
npm run agent:emulators               # terminal 3 (optional): the AI backend (Q) on http://127.0.0.1:8000
npm run emulators:save -- <name>      # keep what is there now (emulator-data/<name>); start from it: npm run emulators -- --data <name>
npm run emulators:seed -- --reset     # any time: back to the seeded state
```

- **Files:** `firebase.emulators.json` (separate from `firebase.json`, so `firebase deploy` never picks up the emulator storage rules), `emulators/storage.rules` (the training block above plus open-for-signed-in elsewhere, local only), `.env.emulators` (demo values, not secrets), `scripts/emulators.mjs`, `scripts/seed-emulators.mjs` (+ `scripts/seed-emulators-incubators.mjs` for the ordinary companies), `ai-backend/run_emulators.py`, `emulators/seed-assets/` (the client's logo and a test signature).
- **Switch:** `src/config/firebase.ts` connects to the emulators only when `VITE_USE_FIREBASE_EMULATORS=true` (set only in `.env.emulators`); a production build drops that code.
- **CLI:** the scripts run Firebase CLI 14.27.0 through `npx`: the Functions emulator needs a CLI that knows the Node 24 runtime, and 15.x needs Java 21 (this machine has 17).
- **Data** starts from the seed every time the emulators start, unless saved data is named: `npm run emulators:save -- <name>` (while running) writes the database, sign-ins and files to `emulator-data/<name>` (git-ignored), and `npm run emulators -- --data <name>` starts from it with no seeding. Nothing is saved on exit: the CLI's export moves a temporary folder into place while the emulators still hold its files, which fails on Windows, so `scripts/emulators-save.mjs` has each emulator write straight into the final folder in the CLI's format. Checked by loading a save into a second emulator set: every record, sign-in, password and file came back. Class dates are saved as they are, so `npm run walkthrough` (the prepared data, `emulator-data/keletso-walkthrough-final`) first runs `scripts/emulators-today.mjs`: every TNS class, certificate (with its public record and printed training dates) and income date moves by the same number of days, so the class that was running when the data was saved runs today again. `npm run walkthrough:today` does the same on running emulators; it does nothing when the dates are already current.
- **Reloads:** in emulator mode Firestore uses long polling. With its default streams, a few quick page reloads used up the browser's six HTTP/1.1 connections to the emulator and left the next page loading for about 30 s (production Firestore uses HTTP/2, so it is not affected). A client company's Documents page can still wait about 25 s for the emulator's Listen handshake on its second full reload; clicking through the top bar (no reload) opens every company page in under a second.
- **Sign-ins** (password `Password@1` for all):
  - Platform: `admin@smartinc.test` (system admin).
  - Tau Namagadi (training module on): `keletso@taunamagadi.co.za` (facilitator); learners `lerato@`, `thabo@`, `pule@kgalagadi-mining.test`, `ayse@anatolia-retail.test`, `sipho@marula-logistics.test`; Kgalagadi Mining's director `director@kgalagadi-mining.test` and coordinator `hr@kgalagadi-mining.test`; a second funder, Mining Skills Fund, `funder@miningskills.test` (`scripts/seed-emulators-companies.mjs`: two registered companies, Kgalagadi's details and two documents sent, Anatolia Retail left unregistered, a booking made by the company, three library items, class hours, a hybrid class with its own pre-assessment, two funders each with their own classes, report and income).
  - Demo Incubator (premium, Agentic home; training off): `director@`, `projectadmin@`, `operations@`, `consultant@`, `consultant2@`, `reception@` (role admin), `funder@`, `sme@demo-incubator.test`. Two programmes, six SMEs, two pending applications (`scripts/seed-emulators-incubators.mjs`).
  - Ubuntu Growth Hub (standard plan, no Agentic; training off): `director@`, `operations@`, `consultant@`, `sme@ubuntu-growth.test`. One programme, three SMEs, one pending application.
- **Seeded classes:** one running today (in person, pre-assessment open, one assessment to mark, one ID copy to check, Naledi Khumalo still to be invited), one online via Zoom in two weeks, one finished a month ago (Pule passed with certificate `TNS-<year>-0001`, Zanele not passed, Emre may be reassessed). The sample assessment is short; import the real one with **Import from Word**. Keletso asks learners for gender, date of birth, disability and job title, and most seeded learners have them, so the funder report's women, men and youth figures are filled.
- **Emails** are not sent locally (the Functions emulator has no SMTP settings; the mail record is marked failed). After an invite, the Learners tab shows the set-password link on screen in emulator mode only; it is also in the Emulator UI under Firestore > `mail`. To send real email locally, put `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `MAIL_FROM` in `functions/.env.local` (git-ignored) and restart the emulators.
- **Assistant (Q):** `ai-backend/run_emulators.py` starts the AI backend against the emulators with anonymous credentials (app.py skips its own Firebase set-up when an app already exists, so no service account is needed). It reads `GEMINI_API_KEY` from `ai-backend/.env.local` (git-ignored; a real key, so Q's replies come from Gemini). Its Python packages are those in `ai-backend/requirements.txt`.

## Onboarding the client

1. Admin > Client modules: switch **Awareness training** on for the company; set **Home page** to Awareness training.
2. Admin > Users: create the facilitator as `projectadmin` in that company; untick features she does not use (interventions, diagnostic plans).
3. The facilitator uploads the company logo and her signature (first-login wizard / profile).
4. Training > Assessments: **Import from Word** reads numbered questions, the numbered memo and the rubric table; check, then save.
5. Classes: create a class (in person, online or both, with its daily hours), add learners or let client companies book them, **Invite** them (they get an email to set a password), and open the pre-assessment / post-assessment from the class's Assessments tab when the class is ready.
6. Companies: register each client company and give its director access; the director adds coordinators.
7. Library: add the material she teaches from, and share what learners and companies should read.

## Still to build

- Shorter application form for companies applying to her listed programme.
- isiZulu text for the training pages (navigation labels are translated).
- Her own report templates and certificate templates: the email titled "ESG report, certificate templates" carried only the three published reports, no templates, and her Eskom 2025 PDF was damaged. Ask her to resend.
- Update the emission factors each year: DFFE publishes the grid factors (the 2025 data year next) and DESNZ its conversion factors each June (`config/esgEmissions.ts`).
- GRI's Licensed Software & Tools Program: confirm before charging for GRI-based reports.
- PDF of the ESG report (Word only for now; the funder report prints to PDF from the browser).
