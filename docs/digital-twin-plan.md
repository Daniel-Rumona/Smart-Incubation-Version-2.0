# Digital twin: design for approval

Status: proposal, 17 November 2026. Nothing is built yet. Approve or change this page first; the build follows it.

## What it is

A **digital twin** is a living copy of one business, built only from records the platform already holds. It
shows where the business stands today, how it got there, and where it is heading if nothing changes. Staff can
then try moves (support, training, a document renewed) and see what each would change before acting.

There is **one twin per business, on both sides of the platform**:

- an **incubation SME** (a programme participant), and
- a **training client company** (an organisation whose staff we train, often with ESG reporting).

## What we take from Lepharo, and where we go further

Lepharo already has two twins (a delivery-process twin and an SME twin; see
`Lepharo-Smart-Incubation-Version-2.0/docs/digital-twins/README.md`). We adopt its principles and go further.
Its code is not copied: the two codebases differ in layout and data model.

| Adopt from Lepharo | Go further |
| --- | --- |
| One pure set of rules works out every number, used by both the screen and a nightly job, so they never disagree | Six layers, not two: adds **skills** (training, LMS) and **sustainability** (ESG) |
| A daily saved record per business, never edited afterwards | **Ask the twin**: describe a move in words and the AI sets it up, replays the future and explains it |
| An outlook "if nothing changes", 20 and 40 days ahead, with the reason for each change | **Training and courses as moves** next to interventions, linking incubation and training |
| A time machine: play history and the days ahead | **A date to aim for**: "funding-ready by 12 March if nothing changes" |
| Peer comparison only in groups of 3 or more, so no business is identifiable | **Live pulse**: each new record (books, check-back, class attended) visibly flows in |
| Every number shows its source and how fresh it is | **Portfolio skyline**: the whole programme as a city of businesses, for directors and funders |

## The six layers and where each comes from

| Layer | Incubation SME | Training client company |
| --- | --- | --- |
| **Growth** | `monthlyPerformance/{participantId}/history` and `participants.revenueHistory` / `headcountHistory`; later the books system (see QxCore below) | `trainingOrgMetrics` (revenue, employees), `details.baselineRevenue` |
| **Support** | `diagnosticPlans` (plan items), `applications.swotItems`, `assignedInterventions` (status, progress, due date, evidence `progressSteps`, outcomes) | Classes booked and attended (`trainingClasses`, `trainingLearners.attendance`) |
| **Skills** | LMS: `courseAssignments`, `courseProgress` (completion, quiz score) | `trainingSubmissions` (pre and post scores), `trainingCertificates`, pass results |
| **Compliance** | `complianceDocuments` (status, expiry) | `trainingOrganisations.documents` (present or missing; no expiry is stored yet) |
| **Sustainability** | ESG scorecard worked out from existing data (`esgScorecardService`) | `esgReports` (carbon footprint scopes 1 to 3, indicators, actions) |
| **Readiness** | Funding and market readiness (`assessReadiness` in `src/utils/readiness.ts`: gates, score, band, next steps) | Same rules, where the inputs exist |
| **Engagement** (shared) | Check-backs (`smeCheckback`), accepted and confirmed work, last contact | Attendance, surveys answered |

The twin also gives a **needs attention** level with reasons (from the same signals as today's risk rule in
`functions/src/agentWatches.ts`), so the twin, watches and chasers agree.

## How it works

1. **Rules:** one pure module, `twinRules.ts`, turns a business's records into its twin. It is imported by the web app
   and by Cloud Functions, so the screen and the saved record always agree. It is fully unit-tested on the demo data.
2. **Daily record:** a nightly job saves `digitalTwins/{businessKey}` (today) and `.../days/{YYYY-MM-DD}` (history,
   never edited). **This should start as soon as possible:** readiness, risk and impact are recalculated on every
   view and never saved today, so every day without a snapshot is history we can never get back.
3. **Earlier history** is rebuilt where the records allow: monthly revenue, attendance days, evidence dates and
   outcome history. Anything that cannot be rebuilt shows as unknown, never as zero.
4. **Outlook and moves:** the rules project the days ahead as things stand, then again with each available move
   (an intervention brought forward, a course or class, a document renewed) and rank the moves by effect.
5. **Ask the twin:** the AI backend turns a sentence into those same moves. It cannot invent numbers: every figure
   comes from the rules.

## Who sees what

- **Programme staff** (operations, director) see the twins in their own workspace.
- **Funders** see the twins of the businesses they fund, through the portfolio skyline. Each business stays visible
  only to the funders of its programme.
- **An SME or client company** may later see a simplified twin of itself. That is not part of the first version.
- **Platform staff** (Quantilytix) see counts only, never a client's business figures, as with the rest of the platform.
- **Peer comparisons** are shown only for groups of 3 or more.

## Build order

1. **Rules and daily record:** the six layers, needs attention, readiness and outlook, with tests. Start the
   nightly snapshot as soon as it passes.
2. **The twin screen:** the time machine (history and the days ahead), the layers and the live pulse.
3. **Moves and Ask the twin:** ranked moves including training and courses, plus the AI.
4. **Portfolio skyline:** directors and funders.
5. **Film it** for the pitch video, together with the other changes on Daniel's list.

## Questions for Daniel

1. **QxCore:** is it QuantNow (which Lepharo already syncs into `participantMonthlyMetrics`), or a new system? Is the
   integration live? The growth layer and the pitch should describe it exactly as it is.
2. **One business on both sides:** a business can be an incubation SME and also send staff to training. Nothing links
   the two records today. Should we add an optional link (for example `linkedParticipantId` on
   `trainingOrganisations`) so its twin shows both? It is cheap now and hard to retrofit later.
3. **Readiness targets:** the "funding-ready by" date uses the current readiness rules (ready at 75 or above). Are
   those the right thresholds for clients?
4. **SME view:** should SMEs see their own twin in the first version, or later?
