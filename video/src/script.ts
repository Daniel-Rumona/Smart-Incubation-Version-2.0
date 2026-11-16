// The narration, one entry per scene. generate-voiceover.ts turns each `narration` into
// public/voiceover/<id>.mp3, and the video sizes each scene to its audio.
// `footage` names the live recording in public/recordings/<footage>.mp4, when the scene has one.

export type Scene = {
  id: string
  title: string
  narration: string
  footage?: string
}

export const SCENES: Scene[] = [
  {
    id: 'intro',
    title: 'Smart Incubation',
    narration:
      'This is Smart Incubation: one platform to run your incubation programme, from application to impact. And it measures every step, the way a good study would.',
  },
  {
    id: 'method',
    title: 'The method, built in',
    narration:
      'Every SME goes through the same steps. Each one is recorded and given a baseline. Every piece of support is tracked. And every outcome is verified, and compared.',
  },
  {
    id: 'applications',
    title: 'Structured records from day one',
    footage: 'applications',
    narration:
      'It starts with applications. The queue shows how many applications are pending, accepted and rejected. Open one, and every applicant is captured in the same structured fields: programme, province, B-BBEE level and gender. The decision and the documents sit alongside, and stay on file, so you can compare cohorts and report on them later, without rebuilding spreadsheets.',
  },
  {
    id: 'diagnostic',
    title: 'A baseline for every SME',
    footage: 'diagnostic',
    narration:
      'Before any support begins, each SME gets a Diagnostic Growth Plan. It records where the business stands, with a SWOT analysis, and links every weakness to an area of support. Further down, each SWOT item shows whether it is being addressed, and every intervention shows its progress, and whether its outcome was achieved. Operations and the SME both sign the plan, so the baseline is agreed.',
  },
  {
    id: 'monitoring',
    title: 'Delivery measured, not assumed',
    footage: 'monitoring',
    narration:
      'As facilitators deliver support, every intervention is tracked. The status mix shows where all the work stands across the programme. When work stalls, the system says why: waiting on the facilitator to accept, on delivery, or on the SME. Overdue work is flagged daily, in the app, by email and on WhatsApp, and the assignments list lets your team act on each item.',
  },
  {
    id: 'verified',
    title: 'Outcomes verified from three sources',
    narration:
      'An outcome only counts when it is verified. Evidence must be attached before an intervention is complete. Then the facilitator and the SME each report the outcome separately, without seeing each other’s answer. Anything not yet achieved is checked again after thirty days.',
  },
  {
    id: 'readiness',
    title: 'Readiness scored by explicit rules',
    footage: 'readiness',
    narration:
      'The Control Tower scores each SME for funding and market readiness, against stated rules. Ready means every required gate is met, and a score of seventy-five or more. Here, Amanzi Trading is almost ready: its financial management, revenue trend and track record are met, but its tax clearance, company registration and bank confirmation are still missing. You see exactly what is missing, and which SMEs need attention first.',
  },
  {
    id: 'kpis',
    title: 'Targets set in advance',
    footage: 'kpis',
    narration:
      'Programme KPIs fill themselves in from delivery data, and are checked against targets you set in advance. Each one shows whether it is met, behind or off track, and how it has moved since last quarter. A single sentence at the top names the KPIs that need attention first. And the programmes view compares each programme against its own targets.',
  },
  {
    id: 'impact',
    title: 'Before and after, and a comparison group',
    footage: 'impact',
    narration:
      'Impact analysis tracks the portfolio’s revenue month by month. It compares each SME’s revenue in the six months before support with the six months after, and compares supported SMEs with those not yet supported. Outcomes are broken down by area of support, so you can see which kinds of help are working. And it labels all of this as a comparison, not proof of cause.',
  },
  {
    id: 'honest',
    title: 'Honest about its own data',
    narration:
      'That honesty runs through the whole system. A facilitator’s answer is recorded as an observation, not as proof. So your reports never claim more than your data can show.',
  },
  {
    id: 'close',
    title: 'Support you can measure',
    narration:
      'Smart Incubation. Support you can measure. Run one cohort on it, and see the results in your own data.',
  },
]
