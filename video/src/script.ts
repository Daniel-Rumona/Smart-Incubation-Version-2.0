// The narration, one entry per scene. generate-voiceover.ts turns each `narration` into
// public/voiceover/<id>.mp3, and the video sizes each scene to its audio.
// A `footage` scene plays the live recording public/recordings/<footage>.mp4 (record.mjs, shot of the same name),
// filmed signed in as `role` on the local demo data (npm run local with SEED_FOR_VIDEO=1: no real client appears).

export type Tone = 'info' | 'warn' | 'good' | 'accent'
export type Point = { label: string; detail: string; tone: Tone }

export type Scene = {
  id: string
  title: string
  narration: string
  /** Subtitles, when they should read differently from what is spoken (the voice says "J S E", the screen "JSE"). */
  subtitles?: string
  kind: 'title' | 'chapter' | 'points' | 'footage'
  /** Title and chapter cards: the small line above the heading, and the line under it. */
  eyebrow?: string
  subheading?: string
  /** Points cards. */
  points?: Point[]
  /** Footage: who is signed in, shown beside the title. */
  role?: string
  footage?: string
}

export const SCENES: Scene[] = [
  // ---- Opening ---------------------------------------------------------------------------------------------------
  {
    id: 'intro',
    kind: 'title',
    title: 'Smart Incubation',
    eyebrow: 'A walk through the platform',
    subheading: 'Incubation programmes and client services, in one place.',
    narration:
      'This is Smart Incubation. In the next few minutes we will walk through the whole platform, signed in as the people who use it every day, and show how the work is actually done.',
  },
  {
    id: 'workspaces',
    kind: 'points',
    title: 'Two workspaces, one add-on',
    points: [
      { label: 'Incubation', detail: 'Programmes for SMEs: applications, diagnostics, interventions, KPIs.', tone: 'info' },
      { label: 'Training', detail: 'Classes, assessments and certificates for client companies’ staff.', tone: 'good' },
      { label: 'ESG add-on', detail: 'Switched on in either workspace: sustainability reports, ready in Word.', tone: 'warn' },
    ],
    narration:
      'Every company on the platform gets a workspace that fits its work. An incubator runs programmes for small businesses. A service provider delivers paid work to client companies, such as training. And ESG reporting can be switched on as an add-on. Each company only sees the parts it uses.',
  },

  // ---- Incubation ------------------------------------------------------------------------------------------------
  {
    id: 'chapter-incubation',
    kind: 'chapter',
    title: 'Incubation programmes',
    eyebrow: 'Part one',
    subheading: 'From application to measurable impact.',
    narration: 'Part one: an incubation programme, from the first application to measurable impact.',
  },
  {
    id: 'ops-home',
    kind: 'footage',
    title: 'Start the day with what matters',
    role: 'Operations',
    footage: 'ops-home',
    narration:
      'The operations team signs in to an assistant that already knows the day: decisions waiting, interventions under way, and active SMEs. One click on Dashboard opens the full picture, with SME health, revenue and employees, compliance, and every intervention, assigned, completed or overdue.',
  },
  {
    id: 'applications',
    kind: 'footage',
    title: 'Applications, captured the same way',
    role: 'Operations',
    footage: 'applications',
    narration:
      'SMEs apply online. Every application arrives with the same structured details: the business, its owner, the programme, the sector and its documents. Here, two new applications are waiting. Operations opens one, reads it, checks the documents, and records the decision and the reason. Accepted SMEs move straight into the programme, and nothing is retyped from a spreadsheet.',
  },
  {
    id: 'diagnostic',
    kind: 'footage',
    title: 'A growth plan for every SME',
    role: 'Operations',
    footage: 'diagnostic',
    narration:
      'Before support begins, each SME gets a diagnostic growth plan. It records where the business stands, with a SWOT analysis, and links every weakness to an area of support. Operations and the SME both sign it off, so everyone starts from the same agreed baseline.',
  },
  {
    id: 'assign',
    kind: 'footage',
    title: 'Interventions, assigned from the plan',
    role: 'Operations',
    footage: 'assign',
    narration:
      'The plan becomes work. For each SME, operations can see which interventions are required, which are assigned, and how far along they are, and assigns each one to a consultant with a due date. Nothing on the plan is forgotten.',
  },
  {
    id: 'consultant',
    kind: 'footage',
    title: 'The consultant’s queue',
    role: 'Consultant',
    footage: 'consultant',
    narration:
      'Consultants see only their own work. They accept new assignments, update progress as they deliver, and attach evidence. An intervention cannot be marked complete without that evidence, and the SME confirms the outcome separately.',
  },
  {
    id: 'sme',
    kind: 'footage',
    title: 'The SME’s own view',
    role: 'SME owner',
    footage: 'sme',
    narration:
      'The SME owner has a workspace of their own. It shows what is waiting on them, the progress of their growth plan, who is helping with what, and the documents still needed for compliance. Reminders reach them in the app, by email and on WhatsApp, in local languages like Zulu.',
  },
  {
    id: 'monitoring',
    kind: 'footage',
    title: 'Delivery measured, not assumed',
    role: 'Operations',
    footage: 'monitoring',
    narration:
      'Back in operations, monitoring shows every intervention across the programme. When work is held up, it says why: waiting on the consultant, on delivery, or on the SME. Overdue work is flagged every day, so follow-ups happen before deadlines slip.',
  },
  {
    id: 'readiness',
    kind: 'footage',
    title: 'Readiness, scored by clear rules',
    role: 'Operations',
    footage: 'readiness',
    narration:
      'The control tower scores each SME for funding and market readiness against stated rules. It lists the top blockers across the portfolio, such as tax clearance or bank confirmation, and which SMEs need attention first.',
  },
  {
    id: 'impact',
    kind: 'footage',
    title: 'KPIs and impact, from real data',
    role: 'Operations',
    footage: 'impact',
    narration:
      'Programme KPIs fill themselves in from delivery data and are checked against the targets set in advance. Impact analysis compares revenue and jobs before and after support, and labels it honestly: a comparison, not proof of cause.',
  },
  {
    id: 'director',
    kind: 'footage',
    title: 'The director’s overview',
    role: 'Director',
    footage: 'director',
    narration:
      'Directors get the whole picture on one page: revenue growth, jobs created, completion and KPIs, with the items that need their attention spelled out, and a scorecard for every programme.',
  },
  {
    id: 'funder',
    kind: 'footage',
    title: 'Funders see what they fund',
    role: 'Funder',
    footage: 'funder',
    narration:
      'Funders sign in too, and see only the programmes they fund: the SMEs supported, delivery, revenue and jobs since joining, by sector, and each business’s performance. No spreadsheets to send at the end of the quarter.',
  },

  // ---- Training --------------------------------------------------------------------------------------------------
  {
    id: 'chapter-training',
    kind: 'chapter',
    title: 'Training for client companies',
    eyebrow: 'Part two',
    subheading: 'Classes, assessments and certificates.',
    narration: 'Part two: a training provider, running classes for the staff of its client companies.',
  },
  {
    id: 'classes',
    kind: 'footage',
    title: 'Set up a class in a minute',
    role: 'Trainer',
    footage: 'classes',
    narration:
      'A training workspace opens on its classes: what is running today, what is coming up, and how many learners and client companies are involved. To create a class, the trainer fills in the course, whether it is held in person, online, or both, the venue or the meeting link, the days and the hours. Zoom, Teams and Google Meet links are recognised, and learners join from their own page.',
  },
  {
    id: 'learners',
    kind: 'footage',
    title: 'Learners from the attendance sheet',
    role: 'Trainer',
    footage: 'learners',
    narration:
      'Learners do not have to be typed in one by one. The trainer imports the attendance sheet straight from Excel. The platform finds the names, companies and emails, flags anything missing or doubled, and adds them to the class, grouped by company.',
  },
  {
    id: 'assessments',
    kind: 'footage',
    title: 'Assessments, straight from Word',
    role: 'Trainer',
    footage: 'assessments',
    narration:
      'Assessments can be written in the platform or imported from an existing Word document. Lettered options become multiple choice questions, the memo sets the correct answers, and written questions stay written. The trainer checks the result and saves it.',
  },
  {
    id: 'learner-test',
    kind: 'footage',
    title: 'The learner writes the assessment',
    role: 'Learner',
    footage: 'learner-test',
    narration:
      'Each learner has a simple page of their own: the class days, the course materials, and their assessments. Sipho starts his pre-assessment. He picks his answers, writes the one written answer, and every answer saves as he goes. When he hands in, the multiple choice questions are marked at once.',
  },
  {
    id: 'marking',
    kind: 'footage',
    title: 'Marking, and the register',
    role: 'Trainer',
    footage: 'marking',
    narration:
      'Back in the class, the trainer keeps the daily attendance register, one day at a time. Then the trainer opens Sipho’s assessment. The multiple choice is already marked, so only what needs a person is left: the written answer, shown right next to the memo. Once the marks are saved, the result is on his page straight away.',
  },
  {
    id: 'certificate',
    kind: 'footage',
    title: 'Certificates anyone can check',
    role: 'Learner',
    footage: 'certificate',
    narration:
      'Learners who pass get their certificate automatically, in the training company’s own colours and logo. Each certificate carries a QR code, and anyone who scans it lands on a public page that confirms it is genuine.',
  },
  {
    id: 'company',
    kind: 'footage',
    title: 'Client companies sign in too',
    role: 'Client company',
    footage: 'company',
    narration:
      'The client company has its own view. It books its people into classes, follows their attendance and results, downloads their certificates, keeps its documents and business figures up to date, and reads its own ESG report.',
  },
  {
    id: 'library',
    kind: 'footage',
    title: 'A library and surveys',
    role: 'Trainer',
    footage: 'library',
    narration:
      'Course documents live in one library. Upload them once, choose who sees each one, and the assistant can answer questions from them. Surveys ask learners how a class went, or ask client companies what they need next.',
  },

  // ---- ESG ---------------------------------------------------------------------------------------------------------
  {
    id: 'chapter-esg',
    kind: 'chapter',
    title: 'ESG reporting',
    eyebrow: 'Part three',
    subheading: 'From the client’s figures to a finished report.',
    narration: 'Part three: ESG reporting, switched on as an add-on for providers who write sustainability reports.',
  },
  {
    id: 'esg-report',
    kind: 'footage',
    title: 'The right standards for each client',
    role: 'Trainer · ESG',
    footage: 'esg-report',
    narration:
      'Each report follows the standards that fit the client. A South African mine follows GRI, with the mining sector standard, J S E guidance and King Four. A retailer in Türkiye follows GRI with the Turkish standards. The client’s figures go in with a baseline, the current value and a target, or come straight from the ESG toolkit spreadsheet.',
    subtitles:
      'Each report follows the standards that fit the client. A South African mine follows GRI, with the mining sector standard, JSE guidance and King IV. A retailer in Türkiye follows GRI with the Turkish standards. The client’s figures go in with a baseline, the current value and a target, or come straight from the ESG toolkit spreadsheet.',
  },
  {
    id: 'esg-footprint',
    kind: 'footage',
    title: 'Carbon footprint to Word report',
    role: 'Trainer · ESG',
    footage: 'esg-footprint',
    narration:
      'The carbon footprint is worked out for scope one, two and three, with the right electricity grid factor for the client’s country, and a note on carbon tax. Each section can be drafted with AI from the figures, then edited. One click downloads the finished Word report, with the GRI content index.',
  },
  {
    id: 'revenue',
    kind: 'footage',
    title: 'Revenue and the funder report',
    role: 'Trainer · Funder',
    footage: 'revenue',
    narration:
      'The provider records its income from training and reports, paid or outstanding. Its funders get a report of their own: revenue, learners trained, pass rates, women, men and youth, with totals only and no learner’s personal information.',
  },

  // ---- Platform ----------------------------------------------------------------------------------------------------
  {
    id: 'admin',
    kind: 'footage',
    title: 'One setting per client',
    role: 'Platform admin',
    footage: 'admin',
    narration:
      'Setting up a new client takes one choice. The platform team picks its workspace type, incubation or training, and switches on ESG reporting if it is needed. The client then lands in the right place, and each company’s records stay its own.',
  },
  {
    id: 'close',
    kind: 'title',
    title: 'Smart Incubation',
    eyebrow: 'Smart Incubation',
    subheading: 'Programmes, training and ESG reporting, measured in one place.',
    narration:
      'Smart Incubation. Incubation programmes, training and ESG reporting, measured in one place. Start with one programme or one class, and see the results in your own data.',
  },
]
