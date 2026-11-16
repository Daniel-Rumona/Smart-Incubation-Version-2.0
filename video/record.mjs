// Records live footage of the app for the walkthrough video, one shot per footage scene in src/script.ts.
//
// It films the local test setup, never a live project, so only demo data appears on camera:
//   1. In the repo root:  $env:SEED_FOR_VIDEO = '1'; npm run local
//      (or, with it already running:  $env:SEED_FOR_VIDEO = '1'; node scripts/seed-emulators.mjs --reset)
//      The switch gives the training provider a fictional name, trainer and logo.
//   2. In video/:         node record.mjs               records every shot to public/recordings/<shot>.mp4
//                         node record.mjs marking admin  records just those shots
// Shots change the data as they go (a class is created, a learner hands in, the trainer marks), so reseed before
// recording them all again. Each shot signs in as its own demo account, off camera.
//
// Frames come from Chrome's screencast (sharp JPEGs, timestamped) rather than Playwright's built-in recorder,
// whose low bitrate blurs small UI text; they are stitched to 30 fps with the ffmpeg bundled in Remotion.
// Each shot is held until its narration (public/voiceover/<shot>.mp3) has finished, so footage and voice match.
import { chromium } from 'playwright'
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const APP = process.env.APP_URL || 'http://localhost:5173'
// The emulators' shared test password (scripts/seed-emulators.mjs); it works nowhere else.
const PASSWORD = process.env.RECORD_PASSWORD || 'Password@1'
// Raw frames live outside the repo: the app's Vite dev server watches the whole repo.
const SCRATCH = path.join(process.env.LOCALAPPDATA || path.resolve('..', '..'), 'smart-incubation-video')
const OUT = path.resolve('public/recordings')
const WORK = path.join(SCRATCH, 'frames')
const ASSETS = path.resolve('assets')
const SIZE = { width: 1920, height: 1080 }
const FFMPEG = path.resolve('node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe')
const THEME = process.env.THEME || 'dark'
// Footage runs this long past the narration, so the last action lands before the scene fades.
const HOLD_AFTER_SPEECH_S = 1.2

const ACCOUNTS = {
  operations: 'operations@demo-incubator.test',
  consultant: 'consultant@demo-incubator.test',
  sme: 'sme@demo-incubator.test',
  director: 'director@demo-incubator.test',
  funder: 'funder@demo-incubator.test',
  trainer: 'trainer@demo-sustainability.test',
  learner: 'sipho@marula-logistics.test',
  certified: 'pule@kgalagadi-mining.test',
  clientCompany: 'director@kgalagadi-mining.test',
  admin: 'admin@smartinc.test',
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// A visible cursor and click ripple; headless Chrome draws no pointer of its own.
const CURSOR_SCRIPT = `
  window.addEventListener('DOMContentLoaded', () => {
    const cursor = document.createElement('div')
    cursor.id = '__demo_cursor'
    cursor.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24"><path d="M4 2l16 9.5-7 1.6-3.6 6.9z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>'
    Object.assign(cursor.style, { position: 'fixed', left: '-40px', top: '-40px', zIndex: 2147483647, pointerEvents: 'none', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.45))' })
    document.body.appendChild(cursor)
    addEventListener('mousemove', (e) => { cursor.style.left = e.clientX - 4 + 'px'; cursor.style.top = e.clientY - 2 + 'px' }, true)
    addEventListener('mousedown', (e) => {
      const ring = document.createElement('div')
      Object.assign(ring.style, { position: 'fixed', left: e.clientX - 18 + 'px', top: e.clientY - 18 + 'px', width: '36px', height: '36px', borderRadius: '50%', border: '3px solid #8b5cf6', zIndex: 2147483646, pointerEvents: 'none', transition: 'transform .45s ease, opacity .45s ease' })
      document.body.appendChild(ring)
      requestAnimationFrame(() => { ring.style.transform = 'scale(1.8)'; ring.style.opacity = '0' })
      setTimeout(() => ring.remove(), 500)
    }, true)
  })
`

// Length of a shot's narration, in seconds (0 before the voiceover exists).
const speechSeconds = (name) => {
  const file = path.resolve(`public/voiceover/${name}.mp3`)
  if (!existsSync(file)) return 0
  const { stderr } = spawnSync(FFMPEG, ['-hide_banner', '-i', file], { encoding: 'utf8' })
  const match = stderr.match(/Duration: (\d+):(\d+):([\d.]+)/)
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) : 0
}

// ---------------------------------------------------------------------------------------------------------------
// Helpers used by the shots. Each step logs and carries on if its target is missing, so one changed label costs a
// moment of footage rather than the whole recording.

const createDirector = (page) => {
  let mouse = { x: SIZE.width / 2, y: SIZE.height / 2 }
  const moveTo = async (x, y, steps = 18) => {
    await page.mouse.move(x, y, { steps })
    mouse = { x, y }
  }
  const centre = async (locator) => {
    const box = await locator.boundingBox()
    if (!box) throw new Error('not visible')
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  const skipped = (step, error) => console.warn(`  ${step} skipped:`, error.message.split('\n')[0])
  const director = {
    page,
    wait,
    moveTo,
    hover: async (locator, pause = 700) => {
      try {
        await locator.scrollIntoViewIfNeeded({ timeout: 4000 })
        const { x, y } = await centre(locator)
        await moveTo(x, y)
        await wait(pause)
      } catch (error) { skipped('hover', error) }
    },
    click: async (locator, pause = 1400) => {
      try {
        await locator.scrollIntoViewIfNeeded({ timeout: 4000 })
        const { x, y } = await centre(locator)
        await moveTo(x, y)
        await wait(250)
        await page.mouse.down()
        await page.mouse.up()
        await wait(pause)
        return true
      } catch (error) { skipped('click', error); return false }
    },
    // Click into a field and type at a readable speed.
    type: async (locator, text, { pause = 500, delay = 45, clear = false } = {}) => {
      if (!(await director.click(locator, 200))) return
      if (clear) {
        await page.keyboard.press('Control+A')
        await page.keyboard.press('Backspace')
      }
      await page.keyboard.type(text, { delay })
      await wait(pause)
    },
    // A file picker's input is hidden; hand it the file directly (the click that would open the dialog is shown).
    upload: async (input, file, pause = 2000) => {
      try {
        await input.setInputFiles(path.join(ASSETS, file), { timeout: 5000 })
        await wait(pause)
      } catch (error) { skipped('upload', error) }
    },
    // Smooth scrolling of whatever container sits under (x, y): small wheel steps read as a person scrolling.
    // Paced by the clock, not a step count: on chart-heavy pages each wheel event can take far longer than planned.
    scroll: async (distance, { x = mouse.x, y = mouse.y, ms = 2400 } = {}) => {
      await moveTo(x, y, 12)
      const started = Date.now()
      let done = 0
      while (Math.abs(done) < Math.abs(distance)) {
        const due = distance * Math.min(1, (Date.now() - started) / ms + 0.03)
        const step = Math.abs(due - done) < 1 ? Math.sign(distance) : due - done
        await page.mouse.wheel(0, step)
        done += step
        await wait(30)
      }
      await wait(500)
    },
    // Switch page inside the app without a reload, as a click on a menu link would.
    navigate: async (to, ready, pause = 1500) => {
      await page.evaluate((url) => {
        window.history.pushState({}, '', url)
        window.dispatchEvent(new PopStateEvent('popstate'))
      }, to)
      if (ready) await page.getByText(ready).first().waitFor({ timeout: 30_000 }).catch((error) => skipped('navigate', error))
      await wait(pause)
    },
  }
  return director
}

const text = (page, value, { exact = true, last = false } = {}) => {
  const locator = page.getByText(value, { exact })
  return last ? locator.last() : locator.first()
}
const button = (page, name, { last = false } = {}) => {
  const locator = page.getByRole('button', { name })
  return last ? locator.last() : locator.first()
}
const drawer = (page) => page.locator('.ant-drawer-open').last()
const modal = (page) => page.locator('.ant-modal-wrap:not([style*="display: none"]) .ant-modal').last()

// ---------------------------------------------------------------------------------------------------------------
// The shots, in recording order (later shots rely on what earlier ones did: the learner hands in before marking).
// `as` signs in; `url` opens the page (a query string opens the workspace view instead of the Agentic home);
// filming starts once `ready` is on screen and `prepare` has run off camera.

const SHOTS = {
  // ---- Incubation ----
  'ops-home': {
    as: 'operations',
    url: '/operations',
    ready: 'Pending decisions',
    act: async (page, d) => {
      await d.wait(1200)
      await d.hover(text(page, 'Pending decisions'), 1100)
      await d.hover(text(page, 'Ongoing interventions'), 1100)
      await d.hover(text(page, 'Active SMEs'), 1100)
      await d.hover(text(page, 'Which interventions are falling behind?'), 1600)
      // The top bar's Dashboard link (it was a Workspace button before Daniel's November top bar).
      await d.click(text(page, 'Dashboard'), 3500)
      await d.hover(text(page, 'Active SMEs'), 1200)
      await d.hover(text(page, 'Revenue & Employees'), 1500)
      await d.hover(text(page, 'Compliance Health'), 1200)
      await d.scroll(450, { x: 960, y: 650, ms: 2400 })
      await d.hover(text(page, 'Carry-over / Overdue'), 1500)
    },
  },
  applications: {
    as: 'operations',
    url: '/shared/applications?demo=video',
    ready: 'Umoya Tea Estate',
    act: async (page, d) => {
      await d.wait(1200)
      await d.hover(text(page, 'Pending'), 900)
      await d.hover(text(page, 'Accepted'), 900)
      await d.hover(text(page, 'Kwena Feeds'), 900)
      await d.click(text(page, 'Umoya Tea Estate'), 2600)
      await d.scroll(350, { x: 1300, y: 650, ms: 2000 })
      await d.click(text(page, 'Documents', { last: true }), 2500)
      await d.click(text(page, 'Decision', { last: true }), 3000)
      await d.click(text(page, 'Overview', { last: true }), 2000)
    },
  },
  diagnostic: {
    as: 'operations',
    url: '/operations/participants/diagnostic-plans?demo=video',
    ready: /^Confirmed \d+$/,
    prepare: async (page) => {
      await page.getByText(/^Confirmed \d+$/).first().click()
      await page.getByText('Ubuntu Harvest', { exact: true }).first().click()
      await wait(2500)
    },
    act: async (page, d) => {
      await d.wait(1200)
      await d.hover(page.getByText(/^Confirmed \d+$/).first(), 900)
      await d.hover(text(page, 'Ubuntu Harvest', { last: true }), 900)
      await d.hover(text(page, 'SWOT Analysis'), 1300)
      await d.scroll(500, { x: 1130, y: 700, ms: 3000 })
      await d.wait(1500)
      await d.scroll(450, { x: 1130, y: 700, ms: 3000 })
      await d.wait(1500)
      await d.click(text(page, 'Ilanga Solar Farms'), 2800)
      await d.scroll(500, { x: 1130, y: 700, ms: 2800 })
    },
  },
  assign: {
    as: 'operations',
    url: '/operations/interventions/assign?demo=video',
    ready: 'Ubuntu Harvest',
    act: async (page, d) => {
      await d.wait(1200)
      await d.hover(text(page, 'Required'), 900)
      await d.hover(text(page, 'Assigned'), 900)
      await d.hover(text(page, 'Ubuntu Harvest'), 900)
      await d.click(button(page, /Assign intervention/), 2200)
      const form = modal(page).or(drawer(page)).first()
      await d.click(form.locator('.ant-select').first(), 1200)
      await d.click(page.locator('.ant-select-dropdown:visible .ant-select-item-option').first(), 1500)
      await d.click(form.locator('.ant-select').nth(1), 1200)
      await d.hover(page.locator('.ant-select-dropdown:visible .ant-select-item-option').nth(1), 1200)
      await page.keyboard.press('Escape')
      await d.wait(1500)
      await page.keyboard.press('Escape')
      await d.wait(1000)
    },
  },
  consultant: {
    as: 'consultant',
    url: '/consultant/allocated?demo=video',
    ready: 'Marketing Strategy Development',
    act: async (page, d) => {
      await d.wait(1200)
      await d.hover(text(page, 'Pending'), 900)
      await d.hover(text(page, 'In progress'), 900)
      await d.hover(text(page, 'Marketing Strategy Development'), 900)
      await d.click(button(page, 'View'), 2500)
      await d.scroll(400, { x: 1500, y: 600, ms: 2200 })
      await d.wait(1500)
      await page.keyboard.press('Escape')
      await d.wait(1000)
      await d.click(page.getByText(/^History \(\d+\)$/).first(), 2500)
    },
  },
  sme: {
    as: 'sme',
    url: '/incubatee?demo=video',
    ready: 'Action centre',
    act: async (page, d) => {
      await d.wait(1200)
      await d.hover(text(page, 'Documents outstanding'), 1000)
      await d.hover(text(page, 'Completions to confirm'), 1000)
      await d.click(text(page, 'Diagnostic Plan'), 3000)
      await d.hover(text(page, 'Marketing Strategy Development'), 1000)
      await d.hover(text(page, 'Sign-off'), 1200)
      await d.click(text(page, 'Compliance'), 3000)
      await d.click(text(page, 'Interventions'), 2500)
      await d.hover(text(page, 'Request support'), 1000)
    },
  },
  monitoring: {
    as: 'operations',
    url: '/operations/interventions/monitoring?demo=video',
    ready: 'Hold-up reasons',
    act: async (page, d) => {
      await d.wait(1500)
      await d.hover(text(page, 'Held up'), 900)
      await d.hover(text(page, 'Overdue'), 900)
      await d.scroll(420, { x: 960, y: 700, ms: 2200 })
      await d.hover(text(page, 'Hold-up reasons'), 900)
      await d.hover(page.locator('.highcharts-point').nth(1), 1300)
      await d.hover(page.locator('.highcharts-point').nth(2), 1300)
      await d.scroll(500, { x: 960, y: 700, ms: 2400 })
      await d.click(text(page, 'Assignments'), 2500)
      await d.scroll(400, { x: 960, y: 700, ms: 2400 })
    },
  },
  readiness: {
    as: 'operations',
    url: '/operations/participants/control-tower?demo=video',
    ready: 'Needs attention first',
    act: async (page, d) => {
      await d.wait(1500)
      await d.hover(text(page, 'Almost ready'), 900)
      await d.hover(page.getByText(/^Tax clearance/).first(), 1100)
      await d.hover(page.getByText(/^Bank confirmation/).first(), 1100)
      await d.click(text(page, 'Bophelo Organics'), 2500)
      await d.scroll(420, { x: 1150, y: 700, ms: 2200 })
      await d.click(text(page, 'Market linkage'), 2500)
    },
  },
  impact: {
    as: 'operations',
    url: '/kpis?demo=video',
    ready: 'Intervention completion rate',
    act: async (page, d) => {
      await d.wait(1200)
      await d.hover(text(page, 'Intervention completion rate'), 1300)
      await d.hover(text(page, 'Off track'), 1200)
      await d.navigate('/operations/impact-analysis?demo=video', 'Before and after support', 2000)
      await d.hover(text(page, 'Revenue growth'), 1000)
      await d.hover(text(page, 'Jobs created'), 1000)
      await d.hover(text(page, 'Portfolio over time'), 1300)
      await d.scroll(500, { x: 960, y: 700, ms: 2600 })
      await d.hover(text(page, 'Before and after support'), 1500)
    },
  },
  director: {
    as: 'director',
    url: '/director?demo=video',
    ready: 'Programmes at a glance',
    act: async (page, d) => {
      await d.wait(1200)
      await d.hover(text(page, 'Revenue growth'), 900)
      await d.hover(text(page, 'Jobs created'), 900)
      await d.hover(text(page, 'Needs your attention'), 1300)
      await d.scroll(450, { x: 960, y: 700, ms: 2400 })
      await d.hover(text(page, 'Demo Growth Accelerator 2026', { last: true }), 1500)
    },
  },
  funder: {
    as: 'funder',
    url: '/funder?demo=video',
    ready: 'SMEs supported',
    act: async (page, d) => {
      await d.wait(1200)
      await d.hover(text(page, 'SMEs supported'), 900)
      await d.hover(text(page, 'Revenue growth'), 900)
      await d.hover(text(page, 'Portfolio revenue'), 1200)
      await d.scroll(450, { x: 960, y: 700, ms: 2200 })
      await d.click(text(page, 'Portfolio'), 3000)
      await d.hover(text(page, 'Ilanga Solar Farms'), 1200)
    },
  },

  // Daniel's funder impact page, in its demo mode (made-up figures for ten programmes; nothing is read or saved).
  'funder-impact': {
    as: 'funder',
    url: '/funder/impact?demo=1',
    ready: 'Funding committed',
    act: async (page, d) => {
      await d.wait(1200)
      await d.hover(text(page, 'Funding committed'), 900)
      await d.hover(text(page, 'Jobs created'), 900)
      await d.hover(text(page, 'Beneficiary profile'), 1100)
      await d.hover(text(page, 'Support delivered'), 1100)
      await d.scroll(520, { x: 960, y: 760, ms: 2600 })
      await d.hover(text(page, 'Agri Hub SA'), 1100)
      await d.scroll(700, { x: 960, y: 760, ms: 3000 })
      await d.wait(1500)
    },
  },

  'funder-portfolio': {
    as: 'funder',
    url: '/funder/portfolio?demo=video',
    ready: 'Portfolio SMEs',
    act: async (page, d) => {
      await d.wait(1000)
      await d.hover(text(page, 'Portfolio Revenue'), 900)
      await d.hover(text(page, 'Ilanga Solar Farms'), 900)
      await d.click(button(page, /View Performance/), 2600)
      await d.scroll(400, { x: 1500, y: 600, ms: 2400 })
      await d.wait(1500)
    },
  },

  // The bell in the top bar, then the notification centre behind "View all notifications".
  bell: {
    as: 'operations',
    url: '/operations',
    ready: 'Pending decisions',
    act: async (page, d) => {
      await d.wait(1200)
      await d.click(page.locator('.anticon-bell').first(), 1600)
      await d.hover(text(page, '1 overdue and 2 due soon interventions', { exact: false }), 1200)
      await d.hover(text(page, '2 follow-ups due', { exact: false }), 1000)
      await d.hover(text(page, 'View all notifications'), 700)
      // The link closes the popover before routing, so open the centre directly (its loading is cut in the edit).
      await page.goto(`${APP}/notifications?demo=video`, { waitUntil: 'domcontentloaded' })
      await page.getByText('Open related page').first().waitFor({ timeout: 30_000 }).catch((error) => console.warn('  centre not loaded', error.message))
      await d.wait(1200)
      await d.hover(text(page, 'Business Plan Refresh (Ubuntu Harvest): 3 days overdue', { exact: false }), 1400)
      await d.hover(text(page, 'Open related page'), 1200)
    },
  },

  // ---- Training ----
  classes: {
    as: 'trainer',
    url: '/training/classes?demo=video',
    ready: 'All classes',
    act: async (page, d) => {
      await d.wait(1200)
      await d.hover(text(page, 'Upcoming or ongoing'), 900)
      await d.hover(text(page, 'Day 1 of 3'), 1100)
      await d.click(button(page, 'New class'), 1500)
      const form = modal(page)
      await d.type(form.locator('#courseTitle'), 'ESG Awareness Training', { clear: true })
      await d.click(form.getByText('In person and online'), 900)
      await d.type(form.locator('#venue'), 'Marula Logistics, Durban')
      await d.type(form.locator('#meetingUrl'), 'https://zoom.us/j/5550001234', { pause: 1200 })
      await d.type(form.locator('#startDate'), '4 Dec 2026', { pause: 300 })
      await page.keyboard.press('Enter')
      await d.type(form.locator('#dayCount'), '2', { clear: true })
      await d.scroll(400, { x: 960, y: 650, ms: 1600 })
      await d.click(button(page, 'Create class', { last: true }), 500)
      // Creating opens the new class: end on it once it has loaded, not on its loading state.
      await page.getByText('Import from Excel').first().waitFor({ timeout: 20_000 }).catch(() => undefined)
      await d.hover(text(page, 'Marula Logistics, Durban', { exact: false }), 1500)
    },
  },
  learners: {
    as: 'trainer',
    url: '/training/classes/tns-class-online?demo=video',
    ready: 'Import from Excel',
    act: async (page, d) => {
      await d.wait(1200)
      await d.click(button(page, 'Import from Excel'), 900)
      await d.upload(modal(page).locator('input[type=file]'), 'demo-attendance.xlsx', 2200)
      await d.hover(modal(page).getByText('Selin Arslan'), 600)
      await d.click(modal(page).getByRole('button', { name: /Add \d+ learner/ }), 2200)
      await d.click(page.getByText(/^Marula Logistics \(\d+\)$/).first(), 1500)
    },
  },
  assessments: {
    as: 'trainer',
    url: '/training/assessments?demo=video',
    ready: 'New assessment',
    act: async (page, d) => {
      await d.wait(1200)
      await d.hover(text(page, 'ESG Quick Quiz (multiple choice and written)'), 1000)
      await d.click(button(page, 'New assessment'), 1500)
      await d.hover(drawer(page).getByText(/Word/).first(), 800)
      await d.upload(drawer(page).locator('input[type=file]'), 'demo-quiz.docx', 2500)
      await d.hover(drawer(page).locator('.ant-segmented').first(), 1200)
      await d.scroll(500, { x: 1500, y: 650, ms: 2400 })
      await d.hover(drawer(page).locator('.ant-radio-wrapper-checked').first(), 1200)
      await d.scroll(500, { x: 1500, y: 650, ms: 2000 })
      await d.click(button(page, 'Save assessment', { last: true }), 2500)
    },
  },
  'learner-test': {
    as: 'learner',
    url: '/learner?demo=video',
    ready: /^Start pre-assessment/,
    act: async (page, d) => {
      await d.wait(1200)
      await d.hover(text(page, 'Attendance'), 900)
      await d.click(page.getByRole('button', { name: /^Start pre-assessment/ }).first(), 2500)
      await page.locator('.ant-radio-group').first().waitFor({ timeout: 20_000 }).catch(() => undefined)
      const option = (value) => page.locator('.ant-radio-wrapper', { hasText: value }).first()
      await d.click(option('Governance'), 700)
      await d.click(option('The Universal Standards (GRI 1, 2 and 3)'), 700)
      await d.click(option('Scope 1'), 700)
      await d.type(page.locator('textarea[placeholder="Your answer"]').first(), 'Water use: a mine needs a lot of it, and it shares that water with nearby communities.', { delay: 30, pause: 1500 })
      await d.click(button(page, /Hand in assessment/), 900)
      await d.click(page.locator('.ant-popover, .ant-popconfirm').getByRole('button', { name: /Hand in/ }).last(), 3500)
    },
  },
  marking: {
    as: 'trainer',
    url: '/training/classes/tns-class-now?demo=video',
    ready: 'Sipho Dlamini',
    act: async (page, d) => {
      await d.wait(1000)
      await d.click(text(page, 'Attendance', { last: true }), 2200)
      await d.scroll(300, { x: 960, y: 650, ms: 1500 })
      await d.wait(1200)
      await d.click(text(page, 'Assessments', { last: true }), 2000)
      const row = page.locator('tr', { hasText: 'Sipho Dlamini' }).filter({ has: page.getByRole('button', { name: /Mark/ }) }).first()
      await d.click(row.getByRole('button', { name: /Mark/ }), 2200)
      await d.hover(drawer(page).getByText('Marked automatically. You can still change the mark.').first(), 1500)
      await d.scroll(500, { x: 1500, y: 650, ms: 2000 })
      await d.type(drawer(page).locator('.ant-input-number input').last(), '2', { clear: true, pause: 1200 })
      await d.click(drawer(page).getByRole('button', { name: 'Save marks' }), 2500)
    },
  },
  certificate: {
    as: 'certified',
    url: '/learner?demo=video',
    ready: 'Download certificate',
    act: async (page, d) => {
      await d.wait(1000)
      await d.hover(text(page, '17/20 (85%)'), 1000)
      await d.hover(text(page, 'Download certificate'), 1300)
      await d.navigate('/verify/seedCert0000000000001', 'TNS-2026-0001', 2500)
      await d.scroll(300, { x: 960, y: 600, ms: 1500 })
      await d.wait(2000)
    },
  },
  company: {
    as: 'clientCompany',
    url: '/company?demo=video',
    ready: 'Our people',
    act: async (page, d) => {
      await d.wait(1000)
      await d.hover(text(page, 'People trained or booked'), 900)
      await d.hover(button(page, 'Book people into a class'), 900)
      await d.scroll(350, { x: 960, y: 650, ms: 1600 })
      await d.click(text(page, 'Certificates'), 2200)
      await d.click(text(page, 'Business metrics'), 2600)
      await d.click(text(page, 'ESG report'), 2600)
    },
  },
  library: {
    as: 'trainer',
    url: '/training/library?demo=video',
    ready: 'Upload documents',
    act: async (page, d) => {
      await d.wait(1000)
      await d.hover(button(page, 'Upload documents'), 900)
      await d.hover(text(page, 'Learner Manual'), 900)
      await d.hover(text(page, 'Only your team'), 1000)
      await d.click(text(page, 'Surveys'), 2600)
      await d.hover(text(page, 'Participant feedback form'), 1000)
      await d.hover(text(page, 'How did the training work for your company?'), 1200)
    },
  },

  // ---- ESG ----
  'esg-report': {
    as: 'trainer',
    url: '/esg/reports?demo=video',
    ready: 'New ESG report',
    act: async (page, d) => {
      await d.wait(1200)
      await d.hover(text(page, 'GRI 14'), 1200)
      await d.hover(text(page, 'King IV Code on Corporate Governance'), 1200)
      await d.hover(text(page, 'TSRS 1 and TSRS 2'), 1500)
      await d.click(text(page, 'Kgalagadi Mining (Pty) Ltd'), 3000)
      await d.hover(text(page, 'Follows:', { exact: false }), 1500)
      await d.hover(button(page, 'Import ESG toolkit'), 1200)
      await d.click(page.getByText(/^1\. Figures/).first(), 2000)
      await d.scroll(500, { x: 960, y: 700, ms: 2600 })
      await d.wait(1500)
    },
  },
  'esg-footprint': {
    as: 'trainer',
    url: '/esg/reports/tns-esg-kgalagadi-fy2026?demo=video',
    ready: 'From the figures to the Word report',
    act: async (page, d) => {
      await d.wait(1000)
      await d.click(page.getByText(/^2\. Carbon footprint/).first(), 2000)
      await d.scroll(450, { x: 960, y: 700, ms: 2200 })
      await d.hover(text(page, 'Carbon tax', { last: true }), 1000)
      await d.scroll(-450, { x: 960, y: 600, ms: 1200 })
      await d.click(page.getByText(/^3\. Written report/).first(), 1800)
      await d.click(text(page, 'Climate change and energy'), 1200)
      await d.click(button(page, 'Draft with AI'), 7000)
      await d.hover(button(page, 'Download the Word report'), 1500)
    },
  },
  revenue: {
    as: 'trainer',
    url: '/training/revenue?demo=video',
    ready: 'Record income',
    act: async (page, d) => {
      await d.wait(1000)
      await d.hover(text(page, 'Last 12 months'), 900)
      await d.hover(text(page, 'Outstanding'), 900)
      await d.scroll(450, { x: 960, y: 700, ms: 2000 })
      await d.navigate('/training/funder?demo=video', 'Report for funders', 1500)
      await d.click(page.locator('.ant-select', { hasText: 'The whole company' }).first(), 1000)
      await d.click(page.locator('.ant-select-dropdown:visible .ant-select-item-option', { hasText: 'Green Enterprise Fund' }).first(), 2500)
      await d.hover(text(page, 'Women trained'), 1000)
      await d.hover(text(page, 'Youth (under 35)'), 1000)
    },
  },

  // ---- Platform ----
  admin: {
    as: 'admin',
    url: '/admin/client-modules?demo=video',
    ready: 'Workspace type',
    act: async (page, d) => {
      await d.wait(1200)
      await d.hover(text(page, 'Training workspaces'), 900)
      await d.hover(text(page, 'ESG reporting add-on'), 900)
      await d.hover(text(page, 'Demo Incubator'), 900)
      const row = page.locator('tr', { hasText: 'Siyafunda Skills Academy' }).first()
      await d.click(row.locator('.ant-select').first(), 1800)
      await page.keyboard.press('Escape')
      await d.wait(800)
      await d.hover(row.locator('.ant-switch').first(), 1500)
      await d.hover(page.locator('tr', { hasText: 'Demo Sustainability Training' }).locator('.ant-switch').first(), 1500)
    },
  },
}

// ---------------------------------------------------------------------------------------------------------------

const signIn = async (page, email) => {
  await page.goto(`${APP}/auth`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  await page.locator('#auth_email').fill(email, { timeout: 60_000 })
  await page.locator('#auth_password').fill(PASSWORD)
  await page.locator('button[type=submit]').click()
  await page.waitForURL((url) => !url.pathname.startsWith('/auth'), { timeout: 60_000 })
}

const recordShot = async (browser, name) => {
  const shot = SHOTS[name]
  const frameDir = path.join(WORK, name)
  rmSync(frameDir, { recursive: true, force: true })
  mkdirSync(frameDir, { recursive: true })

  const context = await browser.newContext({ viewport: SIZE, deviceScaleFactor: 1, acceptDownloads: false })
  await context.addInitScript(({ theme }) => {
    localStorage.setItem('smartv2.activeProgramId', 'all')
    localStorage.setItem('smartv2.themeMode', theme)
  }, { theme: THEME })
  await context.addInitScript(CURSOR_SCRIPT)
  const page = await context.newPage()
  try {
    // Sign in and let the page load and settle off camera; film only once the shot's own content is on screen.
    await signIn(page, ACCOUNTS[shot.as])
    await page.goto(`${APP}${shot.url}`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
    await page.getByText(shot.ready).first().waitFor({ timeout: 90_000 })
    if (shot.prepare) await shot.prepare(page)
    // Headings render before the figures do: also wait out the loading placeholders.
    await page.waitForFunction(() => !document.querySelector('.ant-skeleton-active, .ant-skeleton, .ant-spin-spinning'), null, { timeout: 60_000, polling: 500 }).catch(() => console.warn('  still loading after 60 s'))
    await wait(2000)

    const frames = []
    const cdp = await context.newCDPSession(page)
    cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
      const file = `f${String(frames.length).padStart(5, '0')}.jpg`
      writeFileSync(path.join(frameDir, file), Buffer.from(data, 'base64'))
      frames.push({ file, t: metadata.timestamp })
      await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined)
    })
    await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: SIZE.width, maxHeight: SIZE.height, everyNthFrame: 1 })
    const started = Date.now()
    const director = createDirector(page)
    await director.moveTo(SIZE.width * 0.55, SIZE.height * 0.45, 1)
    await wait(600)
    await shot.act(page, director)
    // Hold the last screen until the narration is over.
    const target = (speechSeconds(name) + HOLD_AFTER_SPEECH_S) * 1000
    if (Date.now() - started < target) await wait(target - (Date.now() - started))
    const end = Date.now() / 1000
    await cdp.send('Page.stopScreencast')

    if (frames.length < 2) throw new Error(`${name}: no frames captured`)
    // Hold each frame until the next one arrives; the last until the end of the shot.
    const lines = frames.flatMap((frame, index) => {
      const next = frames[index + 1]?.t ?? Math.max(end, frame.t + 0.5)
      return [`file '${frame.file}'`, `duration ${Math.max(0.001, next - frame.t).toFixed(4)}`]
    })
    lines.push(`file '${frames.at(-1).file}'`)
    writeFileSync(path.join(frameDir, 'frames.txt'), lines.join('\n'))

    mkdirSync(OUT, { recursive: true })
    const output = path.join(OUT, `${name}.mp4`)
    // Remotion's bundled ffmpeg, called directly: through a shell, Windows splits the filter string at its commas.
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(frameDir, 'frames.txt'),
      '-vf', `scale=${SIZE.width}:${SIZE.height}:flags=lanczos,format=yuv420p`, '-r', '30', '-fps_mode', 'cfr', '-c:v', 'libx264', '-crf', '17', '-preset', 'slow', '-movflags', '+faststart', output],
    { stdio: 'inherit' })
    console.log(`saved recordings/${name}.mp4 (${(end - started / 1000).toFixed(1)} s, narration ${speechSeconds(name).toFixed(1)} s)`)
  } finally {
    await context.close()
  }
}

const requested = process.argv.slice(2)
const unknown = requested.filter((name) => !SHOTS[name])
if (unknown.length) throw new Error(`No such shot: ${unknown.join(', ')}. Shots: ${Object.keys(SHOTS).join(', ')}`)
const browser = await chromium.launch({ channel: 'chrome', headless: true })
try {
  for (const name of requested.length ? requested : Object.keys(SHOTS)) {
    console.log(`recording ${name}...`)
    await recordShot(browser, name)
  }
} finally {
  await browser.close()
}
