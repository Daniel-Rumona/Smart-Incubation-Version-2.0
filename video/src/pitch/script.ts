// The pitch: a short film (about 4 minutes) for prospective clients and funders. It runs problem → solution → key
// features → outcome, and touches each feature in one beat instead of walking through its screens (that is the
// walkthrough's job: src/script.ts).
// Narration: node generate-voiceover.ts --pitch → public/voiceover/pitch/<id>.mp3. Footage: the walkthrough's
// recordings (public/recordings/<name>.mp4), cut into short clips here, so there is nothing new to film.

export type Section = 'platform' | 'incubation' | 'training' | 'esg'

/** A piece of a recording: seconds `from`–`to`, optionally zoomed on a point (x, y as 0–1 of the frame) at `zoom`. */
export type Clip = { src: string; from: number; to: number; focus?: [x: number, y: number, zoom: number] }

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
  | { kind: 'feature'; section: Section; headline: string; bullets: string[]; clips: Clip[] }
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
  {
    id: 'assistant',
    kind: 'feature',
    section: 'platform',
    headline: 'An assistant that knows the day',
    bullets: ['Decisions waiting', 'Work running late', 'Who needs a nudge'],
    clips: [
      { src: 'ops-home', from: 0.5, to: 10, focus: [0.5, 0.74, 1.9] },
      { src: 'ops-home', from: 12, to: 18 },
    ],
    narration:
      'Every day starts with an assistant that already knows what needs attention: decisions waiting, work running late, and the businesses that need a nudge.',
  },
  {
    id: 'plan',
    kind: 'feature',
    section: 'incubation',
    headline: 'A growth plan for every business',
    bullets: ['Weaknesses linked to support', 'Signed off by both sides', 'One agreed starting point'],
    clips: [
      { src: 'diagnostic', from: 0.5, to: 6.5, focus: [0.5, 0.3, 1.5] },
      { src: 'diagnostic', from: 8.5, to: 15, focus: [0.5, 0.62, 1.45] },
    ],
    narration:
      'Each business starts with a diagnostic growth plan. Its weaknesses are linked to the support it will get, and both sides sign it off, so success is defined up front.',
  },
  {
    id: 'delivery',
    kind: 'feature',
    section: 'incubation',
    headline: 'Delivery you can see',
    bullets: ['Evidence before anything is complete', 'Hold-ups explained', 'WhatsApp reminders, in English or isiZulu'],
    clips: [
      { src: 'monitoring', from: 0.5, to: 9, focus: [0.5, 0.5, 1.2] },
      { src: 'sme', from: 6, to: 10.5, focus: [0.5, 0.42, 1.3] },
    ],
    narration:
      'From there, every intervention is tracked. Consultants attach evidence, the system says exactly why work is held up, and business owners get reminders on WhatsApp, in English or isiZulu.',
  },
  {
    id: 'impact',
    kind: 'feature',
    section: 'incubation',
    headline: 'Readiness and impact, from real data',
    bullets: ['Funding readiness by clear rules', 'Revenue and jobs, before and after', 'Supported against not yet supported'],
    clips: [
      { src: 'readiness', from: 0.5, to: 10, focus: [0.33, 0.55, 1.55] },
      { src: 'impact', from: 9, to: 15.5, focus: [0.5, 0.5, 1.15] },
    ],
    narration:
      'Readiness for funding is scored against clear rules, and impact is measured from real delivery data: revenue and jobs, before and after support.',
  },
  {
    id: 'funders',
    kind: 'feature',
    section: 'incubation',
    headline: 'Funders see what they fund',
    bullets: ['Every programme on one page', 'Live, not at quarter end', 'Only what each funder funds'],
    clips: [
      { src: 'director', from: 0.5, to: 6, focus: [0.5, 0.3, 1.4] },
      { src: 'funder', from: 0.5, to: 10, focus: [0.5, 0.4, 1.25] },
    ],
    narration:
      'Directors see every programme on one page. Funders sign in to see exactly what they fund, at any time, without waiting for the quarter to end.',
  },
  {
    id: 'classes',
    kind: 'feature',
    section: 'training',
    headline: 'A class set up in a minute',
    bullets: ['In person, online, or both', 'Learners straight from Excel', 'Grouped by client company'],
    clips: [
      { src: 'classes', from: 8.5, to: 22, focus: [0.5, 0.5, 1.45] },
      { src: 'learners', from: 3.5, to: 12, focus: [0.5, 0.5, 1.6] },
    ],
    narration:
      'For training providers, a class is set up in a minute, and learners come straight in from the attendance sheet in Excel.',
  },
  {
    id: 'tests',
    kind: 'feature',
    section: 'training',
    headline: 'Tests that mark themselves',
    bullets: ['Imported from Word', 'Written online', 'Multiple choice marked on hand-in'],
    clips: [
      { src: 'assessments', from: 7.5, to: 15, focus: [0.8, 0.42, 1.8] },
      { src: 'marking', from: 13.5, to: 23, focus: [0.83, 0.5, 1.75] },
    ],
    narration:
      'Tests can be imported from Word. Learners write them online, multiple choice is marked the moment they hand in, and the trainer only marks what needs a person.',
  },
  {
    id: 'certificates',
    kind: 'feature',
    section: 'training',
    headline: 'Certificates anyone can check',
    bullets: ['Issued automatically', 'In the provider’s own colours', 'A QR code that proves it is genuine'],
    clips: [
      { src: 'certificate', from: 5, to: 10, focus: [0.5, 0.48, 2.2] },
      { src: 'company', from: 0.5, to: 6.5, focus: [0.5, 0.4, 1.3] },
    ],
    narration:
      'Certificates are issued automatically, in the provider’s own colours, with a QR code anyone can scan to check they are genuine. Client companies follow their own people’s results.',
  },
  {
    id: 'esg',
    kind: 'feature',
    section: 'esg',
    headline: 'ESG reports, drafted for you',
    bullets: ['Carbon footprint, scopes 1 to 3', 'The right standards for each client', 'Drafted with AI, finished in Word'],
    clips: [
      { src: 'esg-report', from: 10.5, to: 17, focus: [0.4, 0.55, 1.45] },
      { src: 'esg-footprint', from: 19.5, to: 25.4, focus: [0.5, 0.45, 1.3] },
    ],
    narration:
      'With the ESG add-on, the client’s figures become a carbon footprint and a sustainability report, drafted with AI against the right standards, and downloaded in Word.',
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
