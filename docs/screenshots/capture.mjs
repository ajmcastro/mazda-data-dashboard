// Takes the README screenshots from the SYNTHETIC demo data: `make screenshots` (needs Google Chrome).
// Starts the demo API (:8000), the Mac dashboard (:5173) and the phone app (:5174), shoots, and stops them.
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import puppeteer from 'puppeteer-core'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')
const out = path.dirname(fileURLToPath(import.meta.url))
const CHROME =
  process.env.CHROME_PATH ??
  ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync)
if (!CHROME) throw new Error('Google Chrome not found: set CHROME_PATH')

const inUse = (port) =>
  new Promise((resolve) => {
    const s = net.connect(port, '127.0.0.1')
    s.on('connect', () => (s.destroy(), resolve(true)))
    s.on('error', () => resolve(false))
  })
for (const port of [8000, 5173, 5174]) {
  if (await inUse(port)) throw new Error(`port ${port} is in use: stop make dev / make mobile-dev first`)
}

const children = []
function start(cmd, args, cwd, env = {}) {
  const child = spawn(cmd, args, { cwd, env: { ...process.env, ...env }, detached: true, stdio: 'ignore' })
  children.push(child)
}
const stopAll = () => children.forEach((c) => { try { process.kill(-c.pid) } catch {} })
process.on('exit', stopAll)
process.on('SIGINT', () => process.exit(1))

async function waitFor(url) {
  for (let i = 0; i < 120; i++) {
    try { if ((await fetch(url)).ok) return } catch {}
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`${url} did not start`)
}

start('uv', ['run', 'uvicorn', 'mazda_dash.api.app:app', '--port', '8000'], path.join(root, 'backend'), { MAZDA_DB: '../db/demo.duckdb' })
start('npm', ['run', 'dev', '--', '--port', '5173', '--strictPort'], path.join(root, 'frontend'))
start('npm', ['run', 'dev'], path.join(root, 'mobile'))
await Promise.all([waitFor('http://127.0.0.1:8000/api/health'), waitFor('http://localhost:5173/'), waitFor('http://localhost:5174/')])

const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ['--no-sandbox'] })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// The demo data ends on 30 June 2026; pretend it is the day after, so "last reading 1 day ago" stays true
// whenever the screenshots are taken.
function pretendItIsJuly2026() {
  const RealDate = Date
  const offset = RealDate.UTC(2026, 6, 1, 12, 0, 0) - RealDate.now()
  globalThis.Date = class extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset)
      else super(...args)
    }
    static now() {
      return RealDate.now() + offset
    }
  }
}

async function newPage(width, height, scale, scheme = 'dark') {
  const page = await browser.newPage()
  await page.evaluateOnNewDocument(pretendItIsJuly2026)
  await page.setViewport({ width, height, deviceScaleFactor: scale })
  await page.emulateMediaFeatures([
    { name: 'prefers-color-scheme', value: scheme },
    { name: 'prefers-reduced-motion', value: 'reduce' },
  ])
  return page
}

/** Scrolls the section whose heading contains `text` to the top of the page. */
const scrollToHeading = (page, text, offset = 16) =>
  page.evaluate(
    (t, off) => {
      const h = [...document.querySelectorAll('h2')].find((e) => e.textContent.toLowerCase().includes(t.toLowerCase()))
      if (!h) throw new Error(`no heading "${t}"`)
      const box = h.closest('section') ?? h
      window.scrollTo(0, box.getBoundingClientRect().top + window.scrollY - off)
    },
    text,
    offset,
  )

// ---- the Mac dashboard (dark, 1280 px wide)
const mac = await newPage(1280, 860, 1.5)
async function shoot(file, url, prepare) {
  await mac.goto(`http://localhost:5173${url}`, { waitUntil: 'networkidle0' })
  await sleep(600)
  if (prepare) await prepare(mac)
  await sleep(500)
  await mac.screenshot({ path: path.join(out, file) })
  console.log('wrote', file)
}
await shoot('overview.png', '/')
await shoot('trends.png', '/trends')
await shoot('alerts.png', '/alerts')
await shoot('faults.png', '/faults', async (p) => {
  await p.evaluate(() => document.querySelector('tbody tr.clickable')?.click())
  await sleep(1500)
})
await shoot('status.png', '/status', (p) => scrollToHeading(p, 'Tire pressure'))
await shoot('warning-lamps.png', '/status', async (p) => {
  await scrollToHeading(p, 'Warning lamps')
  await p.evaluate(() => document.querySelector('.lamp-head')?.click())
  await sleep(1500)
})
await shoot('diagnostics.png', '/diagnostics')
await mac.close()

// ---- the phone app (390 x 844, loaded with the demo pack)
async function phone(file, hash, { scheme = 'dark', theme, prepare } = {}) {
  const page = await newPage(390, 844, 2, scheme)
  await page.evaluateOnNewDocument((t) => { if (t) localStorage.setItem('cx5.theme', t) }, theme)
  await page.goto('http://localhost:5174/', { waitUntil: 'networkidle0' })
  const demo = await page.waitForSelector('xpath/.//button[contains(., "Load demo data")]', { timeout: 20000 }).catch(() => null)
  if (demo) await demo.click()
  await page.waitForSelector('.tabbar', { timeout: 60000 })
  await page.evaluate((h) => { location.hash = h }, hash)
  await sleep(2500)
  if (prepare) await prepare(page)
  await sleep(500)
  await page.screenshot({ path: path.join(out, file) })
  console.log('wrote', file)
  await page.close()
}
await phone('phone-overview.png', '#/')
await phone('phone-overview-light.png', '#/', { theme: 'light', scheme: 'light' })
await phone('phone-alerts.png', '#/alerts')
await phone('phone-lamps.png', '#/status', {
  prepare: async (p) => {
    await scrollToHeading(p, 'Warning lamps')
    await p.evaluate(() => document.querySelector('.lamp-head')?.click())
    await sleep(1500)
  },
})

// ---- the GitHub social preview (docs/social-preview.png, 1280 x 640: Settings > Social preview > Upload)
{
  const fonts = path.join(root, 'frontend/node_modules/@fontsource/big-shoulders-display/files/big-shoulders-display-latin-800-normal.woff2')
  const sans = path.join(root, 'frontend/node_modules/@fontsource/ibm-plex-sans/files/ibm-plex-sans-latin-500-normal.woff2')
  const img = (f) => `file://${path.join(out, f)}`
  const html = `<!doctype html><meta charset="utf-8"><style>
    @font-face { font-family: Big; src: url(file://${fonts}); font-weight: 800 }
    @font-face { font-family: Sans; src: url(file://${sans}); font-weight: 500 }
    * { box-sizing: border-box }
    body { margin: 0; width: 1280px; height: 640px; overflow: hidden; position: relative; color: #e9e6df;
           font-family: Sans, sans-serif; background: radial-gradient(900px 500px at 85% -10%, rgba(224,53,69,.28), transparent 60%), #0d0e10 }
    .text { position: absolute; left: 64px; top: 84px; width: 560px }
    h1 { font: 800 118px/0.92 Big, sans-serif; margin: 0; letter-spacing: .01em; text-transform: uppercase }
    h1 span { color: #e03545 }
    p { font-size: 27px; line-height: 1.38; margin: 24px 0 0; color: #c9c5bb }
    .chips { position: absolute; left: 64px; bottom: 56px; width: 560px; display: flex; flex-wrap: wrap; gap: 10px; font-size: 19px }
    .chips b { font-weight: 500; border: 1px solid #3a3f46; border-radius: 99px; padding: 7px 16px; color: #b9b5ab }
    .shot { position: absolute; border-radius: 18px; border: 1px solid #2a2e34; box-shadow: 0 24px 60px rgba(0,0,0,.6) }
    .mac { left: 830px; top: 150px; width: 540px; height: 470px; object-fit: cover; object-position: top left }
    .phone { left: 676px; top: 56px; width: 250px; height: 536px; object-fit: cover; object-position: top; transform: rotate(-3deg); z-index: 2 }
  </style>
  <div class="text"><h1>CX-5<br><span>Telemetry</span></h1>
  <p>Your Mazda's data as a private dashboard: on your computer, and offline on your iPhone.</p></div>
  <div class="chips"><b>Fuel &amp; trips</b><b>Tire pressure</b><b>Fault codes</b><b>Alerts</b><b>Offline iPhone app</b><b>Open source</b></div>
  <img class="shot mac" src="${img('overview.png')}"><img class="shot phone" src="${img('phone-overview.png')}">`
  const file = path.join(out, 'social-preview.html')
  const { writeFileSync, unlinkSync } = await import('node:fs')
  writeFileSync(file, html)
  const page = await newPage(1280, 640, 1)
  await page.goto(`file://${file}`, { waitUntil: 'networkidle0' })
  await sleep(500)
  await page.screenshot({ path: path.join(out, '..', 'social-preview.png') })
  await page.close()
  unlinkSync(file)
  console.log('wrote ../social-preview.png')
}

await browser.close()
stopAll()
