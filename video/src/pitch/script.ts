// The pitch: a film of about 5 minutes for prospective clients and funders. It runs problem → solution → key
// features → outcome, and touches each feature in one beat instead of walking through its screens (that is the
// walkthrough's job: src/script.ts).
// Narration: node generate-voiceover.ts --pitch → public/voiceover/pitch/<id>.mp3 (a chapter card has none).
// Footage: the recordings (public/recordings/<name>.mp4, from record.mjs), cut into clips here and always shown whole.

export type Section = 'platform' | 'incubation' | 'training' | 'esg'

/** A piece of a recording: seconds `from` to `to`, shown whole. */
export type Clip = { src: string; from: number; to: number }

/** A file or habit the problem scenes show as clutter: a coloured badge, a name, and what is wrong with it. */
export type Fragment = { badge: string; color: string; title: string; note: string }

export type PitchScene = {
  id: string
  narration: string
} & (
  | { kind: 'hook'; lines: [string, string] }
  | { kind: 'problem'; step: number; headline: string; motif: 'scattered' | 'weeks' | 'paper' }
  | { kind: 'reveal'; headline: string; tagline: string }
  | { kind: 'workspaces'; headline: string }
  | { kind: 'chapter'; section: Section; headline: string; line: string }
  | { kind: 'feature'; section: Section; headline: string; bullets: string[]; clips: Clip[] }
  | { kind: 'notifications'; headline: string; clips: Clip[] }
  | { kind: 'outcomes'; lead: string; lines: string[] }
  | { kind: 'close'; headline: string; tagline: string; action: string }
)

export const SECTION_LABELS: Record<Section, string> = {
  platform: 'Every workspace',
  incubation: 'Incubation',
  training: 'Training',
  esg: 'ESG reporting add-on',
}

export const SCATTERED: Fragment[] = [
  { badge: 'XLS', color: '#16a34a', title: 'applications_FINAL_v3.xlsx', note: 'Which version is current?' },
  { badge: 'WA', color: '#22c55e', title: 'Cohort 3 updates', note: '214 unread messages' },
  { badge: '@', color: '#3b82f6', title: 'RE: RE: FW: Q3 numbers', note: 'Attachment missing' },
  { badge: 'PDF', color: '#ef4444', title: 'Growth plan (signed scan).pdf', note: 'Saved on someone’s laptop' },
  { badge: 'XLS', color: '#16a34a', title: 'consultant_hours_Oct.xlsx', note: 'Not submitted yet' },
  { badge: 'DOC', color: '#2563eb', title: 'Funder report draft 7.docx', note: 'Due on Friday' },
]

export const PAPER: string[] = ['Paper registers', 'Tests marked one by one', 'Certificates typed by hand', 'Results sent by email']

export const PITCH: PitchScene[] = [
  // ---- The problem (dark) ----------------------------------------------------------------------------------------
  {
    id: 'hook',
    kind: 'hook',
    lines: ['Every programme promises impact.', 'Few can prove it.'],
    narration: 'Every support programme promises impact. Very few can prove it.',
  },
  {
    id: 'scattered',
    kind: 'problem',
    step: 1,
    headline: 'The work is scattered.',
    motif: 'scattered',
    narration:
      'Today, the work is scattered. Applications sit in spreadsheets, updates in WhatsApp groups, and evidence in email threads. Nobody can see, at a glance, which businesses are moving and which are stuck.',
  },
  {
    id: 'weeks',
    kind: 'problem',
    step: 2,
    headline: 'Proving impact takes weeks.',
    motif: 'weeks',
    narration:
      'Then a funder asks what changed. Someone spends weeks pulling a report together by hand, from numbers nobody can check. The support was real, but the proof is thin.',
  },
  {
    id: 'paper',
    kind: 'problem',
    step: 3,
    headline: 'Training still runs on paper.',
    motif: 'paper',
    narration:
      'Training providers have the same problem: paper registers, tests marked one by one, and certificates typed up at the end of every course.',
  },

  // ---- The solution (light from here on) ---------------------------------------------------------------------------
  {
    id: 'reveal',
    kind: 'reveal',
    headline: 'Smart Incubation',
    tagline: 'Run the programme. Prove the impact.',
    narration:
      'Smart Incubation brings all of it into one platform. The work gets done there, and the evidence builds up as it happens.',
  },
  {
    id: 'workspaces',
    kind: 'workspaces',
    headline: 'Two workspaces. One add-on.',
    narration:
      'It comes as two workspaces. Incubation, for programmes that grow small businesses. And Training, for providers who teach their clients’ staff. ESG reporting is an add-on that plugs into either.',
  },

  // ---- Key features ------------------------------------------------------------------------------------------------
  // Clip times are seconds in public/recordings/<src>.mp4 (record.mjs). Each clip is shown whole, never cropped.
  {
    id: 'assistant',
    kind: 'feature',
    section: 'platform',
    headline: 'An assistant that knows the day',
    bullets: ['Decisions waiting', 'Work running late', 'Who needs a nudge'],
    clips: [{ src: 'ops-home', from: 0.5, to: 8.5 }, { src: 'ops-home', from: 10.8, to: 20 }],
    narration:
      'Every day starts with an assistant that already knows what needs attention: decisions waiting, work running late, and the businesses that need a nudge.',
  },
  { id: 'chapter-incubation', kind: 'chapter', section: 'incubation', headline: 'Incubation', line: 'For programmes that grow small businesses', narration: '' },
  {
    id: 'applications',
    kind: 'feature',
    section: 'incubation',
    headline: 'Every application, in one place',
    bullets: ['Applied for online', 'The same structured details', 'Every decision on record'],
    clips: [{ src: 'applications', from: 1, to: 6 }, { src: 'applications', from: 8.5, to: 21 }],
    narration:
      'It starts with applications. Every business applies online, in the same structured way, and every decision is recorded with its reason, so selection is fair and easy to report on.',
  },
  {
    id: 'plan',
    kind: 'feature',
    section: 'incubation',
    headline: 'A growth plan for every business',
    bullets: ['Weaknesses linked to support', 'Signed off by both sides', 'One agreed starting point'],
    clips: [{ src: 'diagnostic', from: 0.5, to: 8 }, { src: 'diagnostic', from: 8, to: 16 }],
    narration:
      'Each business then gets a diagnostic growth plan. Its weaknesses are linked to the support it will get, and both sides sign it off, so success is defined up front.',
  },
  {
    id: 'delivery',
    kind: 'feature',
    section: 'incubation',
    headline: 'Delivery you can see',
    bullets: ['Evidence before anything is complete', 'Hold-ups explained', 'Overdue work flagged daily'],
    clips: [{ src: 'monitoring', from: 0.5, to: 10 }, { src: 'consultant', from: 0.5, to: 13 }],
    narration:
      'From there, every intervention is tracked. Consultants attach evidence before anything is marked complete, and the system says exactly why work is held up.',
  },
  {
    id: 'notifications',
    kind: 'notifications',
    headline: 'Reminders that reach people',
    // The bell's list, then the notification centre (the page load between them is cut).
    clips: [{ src: 'bell', from: 2.5, to: 8.2 }, { src: 'bell', from: 9.9, to: 14.5 }],
    narration:
      'And nobody has to chase. Reminders reach people where they already are: in the app, by email, and on WhatsApp, where a business owner can answer with a single tap. The platform also works in local languages like Zulu.',
  },
  {
    id: 'sme',
    kind: 'feature',
    section: 'incubation',
    headline: 'Business owners see their own progress',
    bullets: ['What is waiting on them', 'Who is helping with what', 'Documents still needed'],
    // Growth plan, compliance, interventions (the page loads between them are cut).
    clips: [{ src: 'sme', from: 5.8, to: 10.8 }, { src: 'sme', from: 12.4, to: 15.2 }, { src: 'sme', from: 17.6, to: 22.5 }],
    narration:
      'Business owners get a workspace of their own: what is waiting on them, how their plan is going, who is helping with what, and which documents are still needed.',
  },
  {
    id: 'impact',
    kind: 'feature',
    section: 'incubation',
    headline: 'Readiness and impact, from real data',
    bullets: ['Funding readiness by clear rules', 'Revenue and jobs, before and after', 'Supported against not yet supported'],
    clips: [{ src: 'readiness', from: 0.5, to: 10 }, { src: 'impact', from: 6, to: 16 }],
    narration:
      'Readiness for funding is scored against clear rules, and impact is measured from real delivery data: revenue and jobs, before and after support.',
  },
  {
    id: 'director',
    kind: 'feature',
    section: 'incubation',
    headline: 'Every programme on one page',
    bullets: ['Growth, jobs and completion', 'What needs attention, spelled out', 'A scorecard per programme'],
    clips: [{ src: 'director', from: 0.5, to: 12 }],
    narration: 'Directors see every programme on one page, with the items that need their attention spelled out.',
  },
  {
    id: 'funders',
    kind: 'feature',
    section: 'incubation',
    headline: 'Funders see what they fund',
    bullets: ['Their own portfolio only', 'Progress and revenue per business', 'Live, not at quarter end'],
    clips: [{ src: 'funder', from: 0.5, to: 9.5 }, { src: 'funder-portfolio', from: 4, to: 12.5 }],
    narration:
      'Funders sign in to see exactly what they fund: every business in their portfolio, its progress and its revenue, at any time, without waiting for the quarter to end.',
  },
  {
    id: 'funder-impact',
    kind: 'feature',
    section: 'incubation',
    headline: 'Impact across everything they fund',
    bullets: ['Funding committed and cost per job', 'Who owns the businesses supported', 'Implementors compared side by side'],
    clips: [{ src: 'funder-impact', from: 0.5, to: 19.2 }],
    narration:
      'Across every programme they fund, the impact view brings it together: the money committed, the cost per job created, who owns the businesses supported, and the support delivered, with implementors compared side by side.',
  },
  { id: 'chapter-training', kind: 'chapter', section: 'training', headline: 'Training', line: 'For providers who train their clients’ staff', narration: '' },
  {
    id: 'classes',
    kind: 'feature',
    section: 'training',
    headline: 'A class set up in a minute',
    bullets: ['In person, online, or both', 'Learners straight from Excel', 'Grouped by client company'],
    clips: [{ src: 'classes', from: 6, to: 22 }, { src: 'learners', from: 3, to: 12 }],
    narration:
      'For training providers, a class is set up in a minute, and learners come straight in from the attendance sheet in Excel.',
  },
  {
    id: 'learner',
    kind: 'feature',
    section: 'training',
    headline: 'A simple page for every learner',
    bullets: ['Class days and materials', 'Tests written online', 'Results as soon as they are marked'],
    clips: [{ src: 'learner-test', from: 0.5, to: 21.5 }],
    narration:
      'Every learner has a simple page of their own, with their class days, course materials and tests, written online from wherever they are.',
  },
  {
    id: 'tests',
    kind: 'feature',
    section: 'training',
    headline: 'Tests that mark themselves',
    bullets: ['Imported from Word', 'Multiple choice marked on hand-in', 'Only written answers left to mark'],
    clips: [{ src: 'assessments', from: 6, to: 16 }, { src: 'marking', from: 13, to: 24 }],
    narration:
      'Tests can be imported from Word. Learners write them online, multiple choice is marked the moment they hand in, and the trainer only marks what needs a person.',
  },
  {
    id: 'certificates',
    kind: 'feature',
    section: 'training',
    headline: 'Certificates anyone can check',
    bullets: ['Issued automatically', 'In the provider’s own colours', 'A QR code that proves it is genuine'],
    clips: [{ src: 'certificate', from: 0.5, to: 11 }],
    narration:
      'Learners who pass get their certificate automatically, in the provider’s own colours, with a QR code anyone can scan to check it is genuine.',
  },
  {
    id: 'company',
    kind: 'feature',
    section: 'training',
    headline: 'Client companies sign in too',
    bullets: ['Book their people into classes', 'Follow attendance and results', 'Download certificates and reports'],
    clips: [{ src: 'company', from: 0.5, to: 7 }, { src: 'company', from: 11, to: 15.5 }],
    narration:
      'Client companies sign in too. They book their people into classes, follow attendance and results, and download their certificates and their own ESG report.',
  },
  {
    id: 'library',
    kind: 'feature',
    section: 'training',
    headline: 'A library and surveys',
    bullets: ['Course documents in one place', 'Choose who sees each one', 'Surveys for learners and clients'],
    clips: [{ src: 'library', from: 0.5, to: 6.5 }, { src: 'library', from: 7.2, to: 16 }],
    narration:
      'Course documents live in one library, and surveys ask learners how a class went, or ask client companies what they need next.',
  },
  {
    id: 'revenue',
    kind: 'feature',
    section: 'training',
    headline: 'Income, and a report for funders',
    bullets: ['Income from training and reports', 'Paid or outstanding', 'Totals only, no personal details'],
    // The funder report takes a while to load in the recording; the clip starts once it has.
    clips: [{ src: 'revenue', from: 0.5, to: 6 }, { src: 'revenue', from: 24.5, to: 35.5 }],
    narration:
      'Providers keep track of their income, and their own funders get a report of the work: learners trained, pass rates and who was reached, with totals only and no personal details.',
  },
  { id: 'chapter-esg', kind: 'chapter', section: 'esg', headline: 'ESG reporting', line: 'An add-on for either workspace', narration: '' },
  {
    id: 'esg',
    kind: 'feature',
    section: 'esg',
    headline: 'ESG reports, drafted for you',
    bullets: ['Carbon footprint, scopes 1 to 3', 'The right standards for each client', 'Drafted with AI, finished in Word'],
    clips: [{ src: 'esg-report', from: 9.5, to: 16 }, { src: 'esg-footprint', from: 3, to: 9.5 }, { src: 'esg-footprint', from: 18, to: 25.5 }],
    narration:
      'With the ESG add-on, the client’s figures become a carbon footprint and a sustainability report, drafted with AI against the right standards, and downloaded in Word.',
  },

  {
    id: 'admin',
    kind: 'feature',
    section: 'platform',
    headline: 'A new client in one step',
    bullets: ['Incubation or Training workspace', 'ESG switched on when needed', 'Each client’s records kept apart'],
    clips: [{ src: 'admin', from: 0.5, to: 19 }],
    narration:
      'And setting up a new client takes one step: choose the workspace, switch on ESG reporting if it is needed, and each client’s records stay their own.',
  },

  // ---- The outcome -------------------------------------------------------------------------------------------------
  {
    id: 'outcomes',
    kind: 'outcomes',
    lead: 'For incubators, training providers and their funders',
    lines: ['Less admin.', 'Proof, not promises.', 'Reports in minutes, not weeks.'],
    narration:
      'For incubators, training providers and their funders, the result is the same: less admin, proof instead of promises, and reports in minutes rather than weeks.',
  },
  {
    id: 'close',
    kind: 'close',
    headline: 'Smart Incubation',
    tagline: 'Run the programme. Prove the impact.',
    action: 'Book a demo',
    narration: 'Smart Incubation. Run the programme. Prove the impact. Book a demo, and see it working with your own data.',
  },
]
