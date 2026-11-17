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
const BOOKS = '#be185d'
const ESG = '#d97706'

export const PITCH: PitchScene[] = [
  // ---- The problem (dark) ----------------------------------------------------------------------------------------
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
      'Today, the work is scattered. Applications sit in spreadsheets, updates in WhatsApp groups, and evidence in email threads. Nobody can see, at a glance, which businesses are growing and which are stuck.',
  },
  {
    id: 'weeks',
    kind: 'problem',
    step: 2,
    headline: 'Proving impact takes weeks.',
    motif: 'weeks',
    narration:
      'Then a funder, or the B-BBEE verification, asks for results. Someone spends weeks pulling a report together by hand. The support was real, but the proof is thin.',
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

  // ---- The solution (light from here on) ---------------------------------------------------------------------------
  {
    id: 'reveal',
    kind: 'reveal',
    headline: 'Smart Incubation',
    tagline: 'Run the programme. Prove the impact.',
    narration:
      'Smart Incubation brings all of it into one platform, run by an AI agent that does the admin, so the evidence builds up while the work gets done.',
  },

  // ---- The platform at work: full screen, narrated --------------------------------------------------------------------
  // Clip times are seconds in public/recordings/<src>.mp4 (record.mjs). Each clip is shown whole, never cropped.
  {
    id: 'nav',
    kind: 'screen',
    tag: 'Getting around',
    color: AGENT,
    headline: 'Everything one click away',
    clips: [{ src: 'nav', from: 0.5, to: 28 }],
    narration:
      'Everything sits behind one simple bar along the top: the agent, the dashboard, the businesses, their support and the reports. The rest is one click away, and each person sees only what their role allows.',
  },
  {
    id: 'agent-home',
    kind: 'screen',
    tag: 'The agent',
    color: AGENT,
    headline: 'An agent that knows the day',
    clips: [{ src: 'ops-home', from: 0.5, to: 8.5 }],
    narration: 'Each day starts with the agent. It already knows what is waiting: decisions to make, support running late, and the businesses that need a nudge.',
  },
  {
    id: 'agent-assign',
    kind: 'screen',
    tag: 'The agent',
    color: AGENT,
    headline: 'Ask, and it sets it up',
    clips: [{ src: 'agent-assign', from: 1, to: 27.5 }],
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
    clips: [{ src: 'agent-watch', from: 1, to: 23.5 }],
    narration: 'Watchers keep an eye on things for you. Type: tell me when any business has an overdue intervention, and the agent sets up the watch.',
  },
  {
    id: 'agent-chaser',
    kind: 'screen',
    tag: 'The agent',
    color: AGENT,
    headline: 'A chaser that follows through',
    captionsAt: 'top',
    clips: [{ src: 'agent-chaser', from: 8, to: 19.5 }, { src: 'agent-chaser', from: 68, to: 81 }],
    narration: "And chasers follow work to the finish. Ask it to get a business's open interventions done by month end, and it plans the reminders and sends them itself.",
  },
  {
    id: 'delivery',
    kind: 'screen',
    tag: 'Support',
    color: INCUBATION,
    headline: 'Delivery you can prove',
    clips: [{ src: 'monitoring', from: 0.5, to: 10 }, { src: 'consultant', from: 0.5, to: 13 }],
    narration:
      'Every piece of support is tracked. Consultants attach evidence before anything is marked complete, and the system explains exactly why work is held up.',
  },
  {
    id: 'twin',
    kind: 'screen',
    tag: 'Digital twin',
    color: TWIN,
    headline: 'A living model of every business',
    clips: [{ src: 'twin', from: 0.5, to: 32 }],
    narration:
      'Then, the digital twin. Every business gets a living model: six months of history played back, and six months projected ahead. Red weeks show risk before it happens. Ask the twin for the fastest way to funding readiness, and it switches on the moves that get there, and shows how much sooner.',
  },
  {
    id: 'sme',
    kind: 'screen',
    tag: 'For business owners',
    color: SME,
    headline: 'Owners see their own progress',
    // Growth plan, compliance, interventions (the page loads between them are cut).
    clips: [{ src: 'sme', from: 0.5, to: 10.8 }, { src: 'sme', from: 12.4, to: 22.5 }],
    narration:
      'Business owners get a simple workspace of their own, on a phone or a laptop: what is waiting on them, their growth plan, and the documents still needed.',
  },
  {
    id: 'lms',
    kind: 'screen',
    tag: 'For business owners',
    color: SME,
    headline: 'Learning, with AI built in',
    clips: [{ src: 'lms', from: 0.5, to: 12 }, { src: 'lms', from: 19, to: 23 }, { src: 'lms', from: 35, to: 42.3 }],
    narration:
      'Learning is built in. Courses sit beside the support, and when an owner is stuck on a lesson, they ask the AI in their own words, and get an answer about their own business. The same platform trains their staff too, with certificates anyone can verify.',
  },
  {
    id: 'whatsapp',
    kind: 'whatsapp',
    headline: 'The agent, on WhatsApp',
    narration:
      'And the agent lives on WhatsApp. An owner asks what is still outstanding, and gets an answer in seconds. A programme manager on the road types: book a session with Bophelo Organics on Thursday at ten. One tap and a PIN to confirm, and it is in the calendar.',
  },
  {
    id: 'qx',
    kind: 'screen',
    tag: 'Qx-Core integration',
    color: BOOKS,
    headline: 'Books kept in Qx-Core',
    clips: [{ src: 'qx', from: 0.5, to: 20.5 }, { src: 'qx', from: 25, to: 37 }],
    narration:
      'For the numbers, Smart Incubation works with Qx-Core, our own financial system. Owners keep their books there just by chatting: sales, invoices and bank statements. And where an owner cannot, the implementor keeps the books on their behalf.',
  },
  {
    id: 'dataflow',
    kind: 'dataflow',
    headline: 'From the books to the report',
    narration:
      'Those books feed Smart Incubation every day. Revenue, costs and cash flow arrive without anyone typing them in, so readiness and impact are measured from real transactions, not survey forms. And at the end of the chain, they become the ESG report.',
  },
  {
    id: 'impact',
    kind: 'screen',
    tag: 'Impact',
    color: INCUBATION,
    headline: 'Readiness and impact, from real data',
    clips: [{ src: 'readiness', from: 0.5, to: 10 }, { src: 'impact', from: 6, to: 16 }],
    narration: 'Readiness for funding is scored against clear rules, and impact is measured before and after support: revenue, jobs and growth.',
  },
  {
    id: 'funder-impact',
    kind: 'screen',
    tag: 'For funders',
    color: INCUBATION,
    headline: 'Funders see what they fund',
    clips: [{ src: 'funder-impact', from: 0.5, to: 19.2 }],
    narration:
      'Funders and ESD sponsors sign in to see exactly what they fund: money committed, cost per job created, who owns the businesses supported, and implementors compared side by side.',
  },
  {
    id: 'esg',
    kind: 'screen',
    tag: 'ESG reporting',
    color: ESG,
    headline: 'ESG reports, drafted for you',
    clips: [{ src: 'esg-report', from: 9.5, to: 16 }, { src: 'esg-footprint', from: 3, to: 9.5 }, { src: 'esg-footprint', from: 18, to: 25.5 }],
    narration:
      'Finally, the ESG report. Figures from the books and the programme become a carbon footprint and a sustainability report, drafted with AI against the right standards and ready to share.',
  },

  // ---- The outcome -------------------------------------------------------------------------------------------------
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
