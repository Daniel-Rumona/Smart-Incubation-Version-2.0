// The pitch: a film of 5 to 7 minutes for ESD programmes, implementors and their funders. It runs problem → solution
// → the platform at work (the app fills the screen, and the AI narrates) → outcome. Training is mentioned along the
// way rather than given a part of its own.
// Narration: node generate-voiceover.ts --pitch → public/voiceover/pitch/<id>.mp3 (a chapter card has none).
// Footage: the recordings (public/recordings/<name>.mp4, from record.mjs), cut into clips here and always shown whole.

export type Section = 'platform' | 'incubation' | 'training' | 'esg'

/** A piece of a recording: seconds `from` to `to`, shown whole. `zoom` eases in on a point (`x`, `y` as shares of
 * the screen) up to `scale`, for small things such as a typed prompt. */
export type Clip = { src: string; from: number; to: number; zoom?: { x: number; y: number; scale: number } }

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
  // The app filling the screen, narrated by the AI: a tag and headline, subtitles, and the narrator's orb.
  // `captionsAt: 'top'` keeps the subtitles off the app's own input box at the bottom.
  | { kind: 'screen'; tag: string; color: string; headline: string; clips: Clip[]; captionsAt?: 'top' | 'bottom' }
  | { kind: 'whatsapp'; headline: string }
  | { kind: 'dataflow'; headline: string }
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

export const PAPER: string[] = ['Revenue from a survey', 'Jobs from memory', 'A shoebox of slips', 'Books months behind']

// Colours for the screen scenes' tags.
const AGENT = '#7c3aed'
const INCUBATION = '#2563eb'
const TWIN = '#0ea5e9'
const SME = '#059669'
const TRAINING = '#10b981'
const BOOKS = '#be185d'
const ESG = '#d97706'

// The film runs: the problem → the reveal → Incubation (sign in, the agent, then the workspace in order) → Training →
// both digital twins → reminders and WhatsApp → Qx-Core and the ESG report → the outcome. Every product scene is the app, full screen, narrated.
// Clip times are seconds in public/recordings/<src>.mp4 (record.mjs). Each clip is shown whole, never cropped.
export const PITCH: PitchScene[] = [
  {
    id: 'hook',
    kind: 'hook',
    lines: ['Billions go into small businesses.', 'Few can prove what changed.'],
    narration: 'Every year, enterprise and supplier development puts billions into small businesses. Very few programmes can prove what it changed.',
  },
  {
    id: 'scattered',
    kind: 'problem',
    step: 1,
    headline: 'The work is scattered.',
    motif: 'scattered',
    narration:
      'Today, the work is scattered: applications in spreadsheets, updates in WhatsApp groups, evidence in email threads. Nobody can see which businesses are growing and which are stuck.',
  },
  {
    id: 'weeks',
    kind: 'problem',
    step: 2,
    headline: 'Proving impact takes weeks.',
    motif: 'weeks',
    narration:
      'Then a funder asks for results. Someone spends weeks pulling a report together by hand. The support was real, but the proof is thin.',
  },
  {
    id: 'paper',
    kind: 'problem',
    step: 3,
    headline: 'The numbers are guesswork.',
    motif: 'paper',
    narration:
      'And the numbers behind it are guesswork: revenue typed into a survey once a quarter, jobs counted from memory, and books kept months behind.',
  },
  {
    id: 'reveal',
    kind: 'reveal',
    headline: 'Smart Incubation',
    tagline: 'Run the programme. Prove the impact.',
    narration:
      'Smart Incubation brings all of it into one platform, run by an AI agent that does the admin, so the evidence builds up while the work gets done.',
  },
  {
    id: 'workspaces',
    kind: 'workspaces',
    headline: 'Two workspaces. One add-on.',
    narration:
      'It comes as two workspaces: Incubation, for programmes that grow small businesses, and Training, for providers who train their staff and clients. ESG reporting is an add-on for either.',
  },
  { id: 'chapter-incubation', kind: 'chapter', section: 'incubation', headline: 'Incubation', line: 'For programmes that grow small businesses', narration: '' },
  {
    id: 'agent-home',
    kind: 'screen',
    tag: 'The agent',
    color: AGENT,
    headline: 'An agent that knows the day',
    clips: [{ src: 'p-signin', from: 4, to: 12 }, { src: 'p-signin', from: 34, to: 45 }],
    narration: 'Staff sign in, and the day starts with the agent. It already knows what is waiting: decisions to make, support running late, and the businesses that need a nudge.',
  },
  {
    id: 'agent-assign',
    kind: 'screen',
    tag: 'The agent',
    color: AGENT,
    headline: 'Ask, and it sets it up',
    clips: [{ src: 'p-agent-assign', from: 3, to: 13 }, { src: 'p-agent-assign', from: 15, to: 23 }, { src: 'p-agent-assign', from: 31, to: 41 }],
    narration:
      'Ask it to set something up, and it does the work. Here, a programme manager assigns support to Bophelo Organics. The agent prepares everything, and nothing is saved until a person confirms.',
  },
  {
    id: 'agent-watch',
    kind: 'screen',
    tag: 'The agent',
    color: AGENT,
    headline: 'A watcher that never sleeps',
    captionsAt: 'top',
    clips: [{ src: 'p-agent-watch', from: 8, to: 13 }, { src: 'p-agent-watch', from: 38, to: 45 }, { src: 'p-agent-watch', from: 49, to: 56 }],
    narration: 'Watchers keep an eye on things for you. Type: tell me when any business has an overdue intervention, and the agent sets up the watch.',
  },
  {
    id: 'agent-chaser',
    kind: 'screen',
    tag: 'The agent',
    color: AGENT,
    headline: 'A chaser that follows through',
    captionsAt: 'top',
    clips: [{ src: 'p-agent-chaser', from: 4, to: 11 }, { src: 'p-agent-chaser', from: 24, to: 31 }, { src: 'p-agent-chaser', from: 34, to: 42 }],
    narration: "And chasers follow work to the finish. Ask it to get a business's open interventions done by month end, and it plans the reminders and sends them itself.",
  },
  {
    id: 'nav',
    kind: 'screen',
    tag: 'Getting around',
    color: INCUBATION,
    headline: 'Everything one click away',
    clips: [{ src: 'p-nav', from: 9, to: 26 }, { src: 'p-nav', from: 29.5, to: 37 }],
    narration:
      'Everything sits behind one simple bar along the top: the agent, the dashboard, the businesses, their support and the reports. The rest is one click away, and each person sees only what their role allows.',
  },
  {
    id: 'applications',
    kind: 'screen',
    tag: 'Incubation',
    color: INCUBATION,
    headline: 'Every application, in one place',
    clips: [{ src: 'p-applications', from: 0.5, to: 3.5 }, { src: 'p-applications', from: 6.5, to: 29 }],
    narration:
      'It starts with applications. Every business applies online, in the same structured way, and every decision is recorded with its reason, so selection is fair and easy to report on.',
  },
  {
    id: 'plan',
    kind: 'screen',
    tag: 'Incubation',
    color: INCUBATION,
    headline: 'A growth plan for every business',
    clips: [{ src: 'p-diagnostic', from: 0.5, to: 5.5 }, { src: 'p-diagnostic', from: 7, to: 13 }, { src: 'p-diagnostic', from: 17, to: 25 }],
    narration:
      'Each business then gets a diagnostic growth plan. Its weaknesses are linked to the support it will get, and both sides sign it off, so success is defined up front.',
  },
  {
    id: 'delivery',
    kind: 'screen',
    tag: 'Incubation',
    color: INCUBATION,
    headline: 'Delivery you can prove',
    clips: [{ src: 'p-monitoring', from: 0.5, to: 3.5 }, { src: 'p-monitoring', from: 10, to: 18 }, { src: 'p-consultant', from: 4, to: 9 }, { src: 'p-consultant', from: 21, to: 31 }],
    narration:
      'Every piece of support is tracked: the programme team sees what is held up, and why. Consultants sign in to their own list of work, and attach evidence before anything is marked complete.',
  },
  {
    id: 'sme',
    kind: 'screen',
    tag: 'For business owners',
    color: SME,
    headline: 'Owners see their own progress',
    // Growth plan, compliance, interventions (the page loads between them are cut).
    clips: [{ src: 'p-sme', from: 3, to: 9 }, { src: 'p-sme', from: 15.5, to: 18 }, { src: 'p-sme', from: 23.5, to: 27 }, { src: 'p-sme', from: 30.5, to: 44 }],
    narration:
      'Business owners sign in to a simple workspace of their own, on a phone or a laptop: what is waiting on them, their growth plan and its sign-off, the documents still needed, and the support they are getting.',
  },
  {
    id: 'lms',
    kind: 'screen',
    tag: 'For business owners',
    color: SME,
    headline: 'Learning, with AI built in',
    clips: [{ src: 'p-lms', from: 1, to: 10 }, { src: 'p-lms', from: 12, to: 15 }, { src: 'p-lms', from: 20, to: 22 }, { src: 'p-lms', from: 30.5, to: 32 }, { src: 'p-lms', from: 37, to: 43 }],
    narration:
      'Learning is built in. Courses sit beside the support, and when an owner is stuck on a lesson, they ask the AI in their own words, and get an answer about their own business.',
  },
  {
    id: 'impact',
    kind: 'screen',
    tag: 'Impact',
    color: INCUBATION,
    headline: 'Readiness and impact, from real data',
    clips: [{ src: 'p-readiness', from: 0.5, to: 4 }, { src: 'p-readiness', from: 9, to: 12.5 }, { src: 'p-readiness', from: 17, to: 25.5 }, { src: 'p-impact', from: 1, to: 4 }, { src: 'p-impact', from: 6, to: 10 }],
    narration: 'Readiness for funding is scored against clear rules, so the team knows which businesses are almost ready, and what holds the rest back. And impact is measured before and after support: revenue, jobs and growth.',
  },
  {
    id: 'director',
    kind: 'screen',
    tag: 'For directors',
    color: INCUBATION,
    headline: 'Every programme on one page',
    clips: [{ src: 'p-director', from: 1.5, to: 6 }, { src: 'p-director', from: 12.5, to: 14 }, { src: 'p-director', from: 17, to: 28 }],
    narration: 'Directors sign in to see every programme on one page: growth, jobs and completion, a scorecard per programme, and the items that need their attention spelled out.',
  },
  {
    id: 'funders',
    kind: 'screen',
    tag: 'For funders',
    color: INCUBATION,
    headline: 'Funders see what they fund',
    clips: [{ src: 'p-funder', from: 1, to: 6 }, { src: 'p-funder', from: 9.5, to: 12 }, { src: 'p-funder', from: 13, to: 24 }, { src: 'p-funder-portfolio', from: 2, to: 6 }, { src: 'p-funder-portfolio', from: 10, to: 16 }],
    narration:
      'Funders sign in too, and see exactly what they fund: portfolio revenue, delivery and jobs on their own dashboard, and every business in their portfolio, with its progress and growth, at any time, without waiting for the quarter to end.',
  },
  {
    id: 'funder-sectors',
    kind: 'screen',
    tag: 'For funders',
    color: INCUBATION,
    headline: 'Sectors and trends',
    clips: [{ src: 'p-funder-sectors', from: 1, to: 7 }, { src: 'p-funder-sectors', from: 8, to: 15 }, { src: 'p-funder-sectors', from: 17.5, to: 28 }],
    narration: 'They can compare sectors side by side: revenue by sector, and the support completed month by month. And the analytics show delivery on time, the progress of each business, and how support turns into growth.',
  },
  {
    id: 'funder-impact',
    kind: 'screen',
    tag: 'For funders',
    color: INCUBATION,
    headline: 'Impact across everything they fund',
    clips: [{ src: 'p-funder-impact', from: 1, to: 4 }, { src: 'p-funder-impact', from: 7, to: 24.8 }],
    narration:
      'Across every programme they fund, the impact view brings it together: the money committed, the cost per job created, who owns the businesses supported, and the support delivered, with implementors compared side by side.',
  },
  { id: 'chapter-training', kind: 'chapter', section: 'training', headline: 'Training', line: 'For providers who train staff and clients', narration: '' },
  {
    id: 'classes',
    kind: 'screen',
    tag: 'Training',
    color: TRAINING,
    headline: 'A class set up in a minute',
    clips: [{ src: 'p-classes', from: 2, to: 7 }, { src: 'p-classes', from: 18, to: 24 }, { src: 'p-classes', from: 28, to: 33 }, { src: 'p-classes', from: 44, to: 50 }, { src: 'p-learners', from: 2.5, to: 12 }],
    narration: 'Training providers sign in to their own workspace. A class is set up in a minute: in person, online or both, with its venue, link and dates. Then learners come straight in from the attendance sheet in Excel.',
  },
  {
    id: 'learner',
    kind: 'screen',
    tag: 'Training',
    color: TRAINING,
    headline: 'A simple page for every learner',
    clips: [{ src: 'p-learner-test', from: 2, to: 6.5 }, { src: 'p-learner-test', from: 9, to: 13 }, { src: 'p-learner-test', from: 21, to: 29 }, { src: 'p-learner-test', from: 39.5, to: 45 }],
    narration: 'Learners sign in, even on a phone, to a simple page of their own: class days, course materials and tests, written online from wherever they are and handed in with a tap.',
  },
  {
    id: 'tests',
    kind: 'screen',
    tag: 'Training',
    color: TRAINING,
    headline: 'Tests that mark themselves',
    clips: [{ src: 'p-assessments', from: 1.5, to: 4 }, { src: 'p-assessments', from: 9.5, to: 14 }, { src: 'p-assessments', from: 24.5, to: 27 }, { src: 'p-marking', from: 3.5, to: 6.5 }, { src: 'p-marking', from: 10, to: 13 }, { src: 'p-marking', from: 15, to: 18.5 }, { src: 'p-marking', from: 22, to: 26.5 }],
    narration:
      'Tests are imported straight from Word. Attendance is taken on the class page, multiple choice is marked the moment a learner hands in, and the trainer only marks the written answers.',
  },
  {
    id: 'certificates',
    kind: 'screen',
    tag: 'Training',
    color: TRAINING,
    headline: 'Certificates anyone can check',
    clips: [{ src: 'p-certificate', from: 1.5, to: 7 }, { src: 'p-certificate', from: 14, to: 16 }, { src: 'p-certificate', from: 17, to: 21 }, { src: 'p-certificate', from: 24.5, to: 31 }],
    narration: 'Learners who pass get their certificate automatically, in the provider’s own colours, with a QR code anyone can scan to check it is genuine.',
  },
  {
    id: 'company',
    kind: 'screen',
    tag: 'Training',
    color: TRAINING,
    headline: 'Client companies sign in too',
    clips: [{ src: 'p-company', from: 1.5, to: 6.5 }, { src: 'p-company', from: 10, to: 16 }, { src: 'p-company', from: 17.5, to: 21 }, { src: 'p-company', from: 22, to: 24.5 }, { src: 'p-company', from: 26.5, to: 28.8 }],
    narration:
      'Client companies sign in too. They book their people into classes, follow attendance and results, and download their certificates and their own ESG report.',
  },
  {
    id: 'revenue',
    kind: 'screen',
    tag: 'Training',
    color: TRAINING,
    headline: 'Income, and a report for funders',
    // The funder report takes a while to load in the recording; the clip starts once it has.
    clips: [{ src: 'p-revenue', from: 0.5, to: 4 }, { src: 'p-revenue', from: 6, to: 11 }, { src: 'p-revenue', from: 13.5, to: 16.5 }, { src: 'p-revenue', from: 21, to: 24 }, { src: 'p-revenue', from: 29.5, to: 32 }],
    narration:
      'Providers keep track of their income, and their own funders get a report of the work: learners trained, pass rates and who was reached, with totals only and no personal details.',
  },
  { id: 'chapter-twins', kind: 'chapter', section: 'platform', headline: 'Digital twins', line: 'A living model of every business and every client', narration: '' },
  {
    id: 'twin',
    kind: 'screen',
    tag: 'Digital twin · Incubation',
    color: TWIN,
    headline: 'A living model of every business',
    clips: [{ src: 'p-twin', from: 1, to: 4 }, { src: 'p-twin', from: 5.5, to: 15 }, { src: 'p-twin', from: 30, to: 34 }, { src: 'p-twin', from: 35, to: 47 }],
    narration:
      'Every business gets a digital twin: six months of history played back, and six months projected ahead. Red weeks show risk before it happens. Ask the twin for the fastest way to funding readiness, and it switches on the moves that get there.',
  },
  {
    id: 'training-twin',
    kind: 'screen',
    tag: 'Digital twin · Training',
    color: TWIN,
    headline: 'A twin for every client company',
    clips: [{ src: 'p-training-twin', from: 1, to: 5 }, { src: 'p-training-twin', from: 7, to: 13 }, { src: 'p-training-twin', from: 15.5, to: 23 }, { src: 'p-training-twin', from: 27, to: 33 }],
    narration:
      'Training providers get one for every client company: its people trained, pass rate, documents and ESG standing, played forward. Ask what puts the client in good standing soonest, and the twin shows the way.',
  },
  {
    id: 'notifications',
    kind: 'notifications',
    headline: 'Reminders that reach people',
    // The bell's list, then the notification centre (the page load between them is cut).
    clips: [{ src: 'p-bell', from: 2.5, to: 8 }, { src: 'p-bell', from: 11.5, to: 15.5 }],
    narration:
      'And nobody has to chase. Reminders reach people in the app, by email and on WhatsApp, where an owner answers with a single tap, even in Zulu.',
  },
  {
    id: 'whatsapp',
    kind: 'whatsapp',
    headline: 'The agent, on WhatsApp',
    narration:
      'And the agent lives on WhatsApp. An owner asks what is still outstanding, and gets an answer in seconds. A programme manager types: book a session with Bophelo Organics on Thursday at ten, confirms with a tap and a PIN, and it is booked.',
  },
  { id: 'chapter-books', kind: 'chapter', section: 'esg', headline: 'Qx-Core and ESG', line: 'From the books to the report', narration: '' },
  {
    id: 'qx',
    kind: 'screen',
    tag: 'Qx-Core integration',
    color: BOOKS,
    headline: 'Books kept in Qx-Core',
    clips: [{ src: 'qx', from: 0.5, to: 14 }, { src: 'qx', from: 25, to: 35 }],
    narration:
      'For the numbers, Smart Incubation works with Qx-Core, our own financial system. Owners keep their books there just by chatting, and where an owner cannot, the implementor keeps them on their behalf.',
  },
  {
    id: 'dataflow',
    kind: 'dataflow',
    headline: 'From the books to the report',
    narration:
      'Those books feed Smart Incubation every day. Revenue, costs and cash flow arrive without anyone typing them in, so impact is measured from real transactions, not survey forms, all the way to the ESG report.',
  },
  {
    id: 'esg',
    kind: 'screen',
    tag: 'ESG reporting',
    color: ESG,
    headline: 'ESG reports, drafted for you',
    clips: [{ src: 'p-esg-report', from: 1, to: 4.5 }, { src: 'p-esg-report', from: 13, to: 16 }, { src: 'p-esg-report', from: 18.5, to: 21.5 }, { src: 'p-esg-footprint', from: 2.5, to: 6 }, { src: 'p-esg-footprint', from: 13.5, to: 16 }, { src: 'p-esg-footprint', from: 18, to: 24.5 }],
    narration:
      'Finally, the ESG report. Figures from the books and the programme become a carbon footprint and a sustainability report, drafted with AI against the right standards and ready to share.',
  },
  {
    id: 'outcomes',
    kind: 'outcomes',
    lead: 'For ESD programmes, implementors and their funders',
    lines: ['Less admin.', 'Proof, not promises.', 'Reports in minutes, not weeks.'],
    narration:
      'For ESD programmes, implementors and their funders, the result is the same: less admin, proof instead of promises, and reports in minutes rather than weeks.',
  },
  {
    id: 'close',
    kind: 'close',
    headline: 'Smart Incubation',
    tagline: 'Run the programme. Prove the impact.',
    action: 'Book a demo',
    narration: 'Smart Incubation. Run the programme. Prove the impact. Book a demo today.',
  },
]
