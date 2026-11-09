// Records live footage of the app for the showcase video.
//
//   node record.mjs signin            Opens Chrome on the app; sign in as a test operations user. The session is
//                                     kept in %LOCALAPPDATA%/smart-incubation-video (outside the repo)
//                                     and the window closes once you are in.
//   node record.mjs                   Records every shot to public/recordings/<shot>.mp4.
//   node record.mjs kpis impact       Records just those shots.
//
// Frames come from Chrome's screencast (sharp JPEGs, timestamped) rather than Playwright's built-in recorder,
// whose low bitrate blurs small UI text; they are stitched to 30 fps with the ffmpeg bundled in Remotion.
import { chromium } from 'playwright'
import { execFileSync } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const APP = process.env.APP_URL || 'http://localhost:5173'
// Chrome's profile and the raw frames live outside the repo: the app's Vite dev server watches the whole repo,
// and Chrome's locked session files crash it (EBUSY) if they sit anywhere under it.
const SCRATCH = path.join(process.env.LOCALAPPDATA || path.resolve('..', '..'), 'smart-incubation-video')
const PROFILE = path.join(SCRATCH, 'profile')
const OUT = path.resolve('public/recordings')
const WORK = path.join(SCRATCH, 'frames')
const SIZE = { width: 1920, height: 1080 }
const FFMPEG = path.resolve('node_modules/@remotion/compositor-win32-x64-msvc/ffmpeg.exe')
// 'all' = the account's own programmes, as in the pitch screenshots. Set PROGRAMME to a programme id to narrow it.
const PROGRAMME_ID = process.env.PROGRAMME || 'all'
const THEME = process.env.THEME || 'dark'

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

const launch = (headless) =>
  chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome',
    headless,
    viewport: headless ? SIZE : null,
    // A fixed scale only applies to the fixed-size recording viewport; the sign-in window uses the screen's own.
    ...(headless ? { deviceScaleFactor: 1 } : {}),
    args: headless ? [] : ['--start-maximized'],
  })

// ---------------------------------------------------------------------------------------------------------------
// Helpers used by the shots

const createDirector = (page) => {
  let mouse = { x: SIZE.width / 2, y: SIZE.height / 2 }
  const moveTo = async (x, y, steps = 28) => {
    await page.mouse.move(x, y, { steps })
    mouse = { x, y }
  }
  const centre = async (locator) => {
    const box = await locator.boundingBox()
    if (!box) throw new Error('not visible')
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  return {
    wait,
    hover: async (locator, pause = 700) => {
      try {
        await locator.scrollIntoViewIfNeeded({ timeout: 4000 })
        const { x, y } = await centre(locator)
        await moveTo(x, y)
        await wait(pause)
      } catch (error) { console.warn('  hover skipped:', error.message.split('\n')[0]) }
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
      } catch (error) { console.warn('  click skipped:', error.message.split('\n')[0]) }
    },
    // Smooth scrolling of whatever container sits under (x, y): small wheel steps read as a person scrolling.
    scroll: async (distance, { x = mouse.x, y = mouse.y, ms = 2400 } = {}) => {
      await moveTo(x, y, 12)
      const steps = Math.max(1, Math.round(ms / 40))
      for (let i = 0; i < steps; i++) {
        await page.mouse.wheel(0, distance / steps)
        await wait(40)
      }
      await wait(500)
    },
    moveTo,
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The shots: each opens one screen and acts out what the narration describes. The query string opens the
// workspace view directly instead of the Agentic home.

const SHOTS = {
  applications: {
    url: '/shared/applications?demo=video',
    ready: 'Amanzi Trading',
    act: async (page, d) => {
      await d.wait(1500)
      await d.hover(page.getByText('Pending', { exact: true }).first(), 600)
      await d.hover(page.getByText('Accepted', { exact: true }).first(), 600)
      await d.click(page.getByText('Amanzi Trading', { exact: true }).first())
      await d.hover(page.getByText('B-BBEE level', { exact: true }).first(), 1200)
      await d.click(page.getByText('Decision', { exact: true }).first(), 2200)
      await d.click(page.getByText('Documents', { exact: true }).first(), 2200)
      await d.click(page.getByText('Overview', { exact: true }).first(), 1800)
      await d.click(page.getByText('Litha Agri Co', { exact: true }).first(), 2500)
    },
  },
  diagnostic: {
    url: '/operations/participants/diagnostic-plans?demo=video',
    ready: /^Confirmed [1-9]\d*$/,
    // The page opens on the Draft tab, whose plan belongs to a real person: switch to a confirmed test SME off camera.
    prepare: async (page) => {
      await page.getByText(/^Confirmed \d+$/).first().click()
      await page.getByText('Amanzi Trading', { exact: true }).first().click()
      await page.getByText('Amanzi Trading', { exact: true }).nth(1).waitFor({ timeout: 20_000 }).catch(() => undefined)
      await wait(2500)
    },
    act: async (page, d) => {
      await d.wait(1200)
      await d.hover(page.getByText(/^Confirmed \d+$/).first(), 900)
      await d.hover(page.getByText('SWOT Analysis', { exact: true }).first(), 1200)
      await d.scroll(500, { x: 1130, y: 700, ms: 3000 })
      await d.hover(page.getByText('SWOT and outcomes', { exact: true }).first(), 1500)
      await d.scroll(450, { x: 1130, y: 700, ms: 3000 })
      await d.wait(2000)
      await d.click(page.getByText('Baobab Holdings', { exact: true }).first(), 3000)
      await d.scroll(600, { x: 1130, y: 700, ms: 3200 })
      await d.wait(2000)
    },
  },
  monitoring: {
    url: '/operations/interventions/monitoring?demo=video',
    ready: 'Hold-up reasons',
    act: async (page, d) => {
      await d.wait(1800)
      await d.hover(page.getByText('Overdue', { exact: true }).first(), 900)
      await d.scroll(420, { x: 960, y: 700, ms: 2200 })
      await d.hover(page.getByText('Hold-up reasons', { exact: true }).first(), 900)
      await d.hover(page.locator('.highcharts-point').nth(5), 1500)
      await d.hover(page.locator('.highcharts-point').nth(6), 1500)
      await d.hover(page.locator('.highcharts-point').nth(7), 1500)
      await d.scroll(500, { x: 960, y: 700, ms: 2400 })
      await d.wait(1500)
      await d.click(page.getByText('Assignments', { exact: true }).first(), 2500)
      await d.scroll(500, { x: 960, y: 700, ms: 2600 })
      await d.wait(2000)
    },
  },
  readiness: {
    url: '/operations/participants/control-tower?demo=video',
    ready: 'Amanzi Trading',
    act: async (page, d) => {
      await d.wait(1800)
      await d.click(page.getByText('Amanzi Trading', { exact: true }).first(), 2200)
      await d.hover(page.getByText('Funding readiness', { exact: true }).first(), 900)
      await d.hover(page.getByText('Tax clearance', { exact: true }).first(), 900)
      await d.hover(page.getByText('Financial management', { exact: true }).first(), 900)
      await d.scroll(420, { x: 1150, y: 700, ms: 2400 })
      await d.wait(1200)
      await d.click(page.getByText('Thandeka Logistics', { exact: true }).first(), 2500)
      await d.click(page.getByText('Market linkage', { exact: true }).first(), 2500)
      await d.wait(1500)
    },
  },
  kpis: {
    url: '/kpis?demo=video',
    ready: 'Need attention',
    // A month into a new quarter every KPI reads zero; show the quarter just closed, as the pitch screenshot does.
    prepare: async (page) => {
      await page.getByText(/^[A-Z][a-z]{2} \d{4}$/).first().click()
      await page.getByText(process.env.KPI_MONTH || 'Sep 2026', { exact: true }).last().click()
      await wait(3000)
    },
    act: async (page, d) => {
      await d.wait(2000)
      await d.hover(page.getByText('Need attention').first(), 900)
      await d.hover(page.getByText('Met or on track').first(), 900)
      await d.scroll(450, { x: 960, y: 700, ms: 2600 })
      await d.wait(1500)
      await d.scroll(450, { x: 960, y: 700, ms: 2600 })
      await d.wait(1200)
      await d.scroll(-900, { x: 960, y: 600, ms: 2200 })
      await d.click(page.getByText('Programmes', { exact: true }).first(), 3000)
      await d.scroll(400, { x: 960, y: 700, ms: 2400 })
      await d.wait(2000)
    },
  },
  impact: {
    url: '/operations/impact-analysis?demo=video',
    ready: 'Impact by SME',
    act: async (page, d) => {
      await d.wait(2500)
      await d.hover(page.getByText('Portfolio over time', { exact: true }).first(), 1500)
      await d.hover(page.getByText('Before and after support', { exact: true }).first(), 1800)
      await d.hover(page.getByText('Supported vs not yet supported', { exact: true }).first(), 1800)
      await d.hover(page.getByText('Outcomes by area of support', { exact: true }).first(), 1500)
      await d.scroll(500, { x: 960, y: 700, ms: 3000 })
      await d.wait(1800)
      await d.scroll(500, { x: 960, y: 700, ms: 3000 })
      await d.wait(2500)
    },
  },
}

// ---------------------------------------------------------------------------------------------------------------

const signIn = async () => {
  const context = await launch(false)
  const page = context.pages()[0] || (await context.newPage())
  await page.goto(`${APP}/auth`)
  console.log('Sign in in the Chrome window that opened. Waiting up to 15 minutes...')
  await page.waitForFunction(() => !location.pathname.startsWith('/auth') && !!document.querySelector('#guide-app-topbar, .app-topbar-pill'), null, { timeout: 15 * 60_000, polling: 1000 })
  await wait(3000)
  console.log('Signed in; session saved.')
  await context.close()
}

const recordShot = async (context, name) => {
  const shot = SHOTS[name]
  const frameDir = path.join(WORK, name)
  rmSync(frameDir, { recursive: true, force: true })
  mkdirSync(frameDir, { recursive: true })

  const page = await context.newPage()
  await page.goto(`${APP}${shot.url}`, { waitUntil: 'domcontentloaded', timeout: 90_000 })
  if (page.url().includes('/auth')) throw new Error('Not signed in: run `node record.mjs signin` first.')
  // Let the page load and settle off camera. Data can take 10-30 s to arrive, so film only once the shot's own
  // content is on screen, after any off-camera setup the shot needs.
  await page.getByText(shot.ready).first().waitFor({ timeout: 90_000 })
  if (shot.prepare) await shot.prepare(page)
  // Headings render before the figures do: also wait out the loading placeholders.
  await page.waitForFunction(() => !document.querySelector('.ant-skeleton-active, .ant-skeleton'), null, { timeout: 90_000, polling: 500 }).catch(() => console.warn('  still loading after 90 s'))
  await wait(2500)

  const frames = []
  const cdp = await context.newCDPSession(page)
  cdp.on('Page.screencastFrame', async ({ data, metadata, sessionId }) => {
    const file = `f${String(frames.length).padStart(5, '0')}.jpg`
    writeFileSync(path.join(frameDir, file), Buffer.from(data, 'base64'))
    frames.push({ file, t: metadata.timestamp })
    await cdp.send('Page.screencastFrameAck', { sessionId }).catch(() => undefined)
  })
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: SIZE.width, maxHeight: SIZE.height, everyNthFrame: 1 })
  const director = createDirector(page)
  await director.moveTo(SIZE.width * 0.55, SIZE.height * 0.45, 1)
  await wait(600)
  await shot.act(page, director)
  const end = Date.now() / 1000
  await cdp.send('Page.stopScreencast')
  await page.close()

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
  console.log(`saved recordings/${name}.mp4 (${frames.length} frames, ${(frames.at(-1).t - frames[0].t).toFixed(1)} s)`)
}

const record = async (names) => {
  const context = await launch(true)
  // Same programme and theme as the screenshots, set before any page script runs.
  await context.addInitScript(({ programme, theme }) => {
    localStorage.setItem('smartv2.activeProgramId', programme)
    localStorage.setItem('smartv2.themeMode', theme)
  }, { programme: PROGRAMME_ID, theme: THEME })
  await context.addInitScript(CURSOR_SCRIPT)
  try {
    for (const name of names) {
      console.log(`recording ${name}...`)
      await recordShot(context, name)
    }
  } finally {
    await context.close()
  }
}

const [command, ...rest] = process.argv.slice(2)
if (command === 'signin') await signIn()
else await record([command, ...rest].filter(Boolean).length ? [command, ...rest].filter(Boolean) : Object.keys(SHOTS))
