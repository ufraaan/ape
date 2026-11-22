import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:8787'
const ABUSE_EMAIL = process.env.SMOKE_ABUSE_EMAIL ?? ''

let checks = 0
function check(condition, message) {
  checks++
  if (!condition) throw new Error(`FAIL: ${message}`)
}

function form(fields) {
  return new URLSearchParams(fields).toString()
}

async function post(path, fields, headers = {}) {
  return fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: form(fields),
    redirect: 'manual',
  })
}

function createdId(response) {
  const path = response.headers.get('location') ?? ''
  const match = path.match(/^\/([A-Za-z0-9_-]{22})$/)
  return match?.[1] ?? null
}

function reportDraft(html) {
  const href = html.match(/href="(mailto:[^"]+)"/)?.[1]
  return href ? new URL(href.replaceAll('&amp;', '&')) : null
}

function localSql(command) {
  return execFileSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['--no-install', 'wrangler', 'd1', 'execute', 'ape', '--local', '--json', '--command', command],
    { cwd: fileURLToPath(new URL('..', import.meta.url)), encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
}

async function create(body, ttl = '1h') {
  const response = await post('/pastes', { body, ttl })
  return { response, html: await response.text() }
}

async function expect404(path, label) {
  const response = await fetch(BASE + path)
  check(response.status === 404, `${label}: expected 404, got ${response.status}`)
  await response.arrayBuffer()
}

const mainBody = 'first line\n<script>alert("xss")</script></textarea><img src=x onerror=alert(1)>\n👋 café'
const main = await create(mainBody)
check(main.response.status === 303, `create: expected 303, got ${main.response.status}`)
check(main.response.headers.get('cache-control') === 'no-store', 'create redirect is not cached')

const id = createdId(main.response)
check(Boolean(id), 'create redirects to the short paste url')
const page = await fetch(`${BASE}/${id}`)
const pageHtml = await page.text()
check(page.status === 200, `view: expected 200, got ${page.status}`)
check(page.headers.get('x-robots-tag') === 'noindex, nofollow', 'paste pages are noindex')
check(page.headers.get('cache-control') === 'no-store', 'paste pages are not cached')
check(!pageHtml.includes('<script>alert("xss")</script>'), 'view escapes script markup')
check(!pageHtml.includes('<img src=x onerror'), 'view escapes attribute-breakout markup')
check(pageHtml.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'), 'view contains escaped paste text')
check(!pageHtml.includes(mainBody), 'view does not echo the raw body')
check(!pageHtml.includes('deletion token'), 'view has no deletion token')
check(
  pageHtml.includes(`<link rel="canonical" href="/${id}" />`),
  'view declares the short url as canonical',
)
if (ABUSE_EMAIL) {
  const draft = reportDraft(pageHtml)
  check(draft?.pathname === ABUSE_EMAIL, 'paste report addresses the configured contact')
  check(draft.searchParams.get('subject') === 'ape abuse report', 'paste report has a subject')
  check(
    draft.searchParams.get('body')?.startsWith(`paste link: ${new URL(`/${id}`, BASE).href}\r\n`),
    'paste report includes the canonical url',
  )
}

for (const suffix of ['', '/raw']) {
  const legacy = await fetch(`${BASE}/p/${id}${suffix}`, { redirect: 'manual' })
  check(legacy.status === 308, 'old paste links redirect')
  check(legacy.headers.get('location') === `/${id}${suffix}`, 'old links redirect to the short url')
  await legacy.arrayBuffer()
}

const raw = await fetch(`${BASE}/${id}/raw`)
const rawBytes = new Uint8Array(await raw.arrayBuffer())
check(raw.status === 200, `raw: expected 200, got ${raw.status}`)
check(raw.headers.get('content-type') === 'text/plain; charset=utf-8', 'raw is plain utf-8 text')
check(new TextDecoder().decode(rawBytes) === mainBody, 'raw returns the exact bytes that were stored')

const independentRaw = await fetch(`${BASE}/${id}/raw`)
const independentBytes = new Uint8Array(await independentRaw.arrayBuffer())
check(
  Buffer.from(independentBytes).equals(Buffer.from(rawBytes)),
  'independent raw reads return identical bytes',
)

await expect404('/doesnotexist1/raw', 'unknown paste raw')
await expect404('/short', 'malformed paste id')
await expect404('/short/raw', 'malformed paste id raw')

const exact = 'a'.repeat(65530) + '👋é'
check(new TextEncoder().encode(exact).byteLength === 65536, 'fixture is exactly the 64 KiB limit')
const max = await create(exact)
check(max.response.status === 303, `max utf-8 paste: expected 303, got ${max.response.status}`)
const maxId = createdId(max.response)
check(Boolean(maxId), 'max utf-8 paste has an id')
const maxRaw = new Uint8Array(await (await fetch(`${BASE}/${maxId}/raw`)).arrayBuffer())
check(maxRaw.byteLength === 65536, `max paste round-trips 65536 bytes, got ${maxRaw.byteLength}`)

const oversized = 'a'.repeat(65537)
const tooLarge = await create(oversized)
check(tooLarge.response.status === 413, `over-limit paste: expected 413, got ${tooLarge.response.status}`)
check(tooLarge.html.includes(oversized), 'over-limit response keeps the submitted text for editing')

const blocked = await post('/pastes', { body: 'blocked' }, { origin: 'https://evil.example' })
check(blocked.status === 403, `cross-origin create: expected 403, got ${blocked.status}`)
await blocked.arrayBuffer()

const wrongType = await fetch(`${BASE}/pastes`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{"body":"nope"}',
})
check(wrongType.status === 415, `non-form create: expected 415, got ${wrongType.status}`)
await wrongType.arrayBuffer()

const expiring = await create('expires soon')
check(expiring.response.status === 303, 'created paste for expiry test')
const expiringId = createdId(expiring.response)
localSql(`UPDATE pastes SET expires_at = 1 WHERE id = '${expiringId}'`)
await expect404(`/${expiringId}`, 'expired paste view')
await expect404(`/${expiringId}/raw`, 'expired paste raw')

const scheduled = await fetch(`${BASE}/__scheduled?cron=17+*+*+*+*`)
await scheduled.arrayBuffer()
check(scheduled.status === 200, `scheduled trigger: expected 200, got ${scheduled.status}`)
const remaining = JSON.parse(localSql(`SELECT count(*) AS n FROM pastes WHERE id = '${expiringId}'`))
check(remaining[0].results[0].n === 0, 'scheduled cleanup removed the expired row')

for (const path of [`/${id}/delete`, `/p/${id}/delete`]) {
  const removedEndpoint = await post(path, {})
  check(removedEndpoint.status === 404, 'public delete endpoint is unavailable')
  await removedEndpoint.arrayBuffer()
}
check((await fetch(`${BASE}/${id}`)).status === 200, 'paste stays available until it expires')

const abuse = await fetch(`${BASE}/abuse`)
const abuseHtml = await abuse.text()
check(abuse.status === 200, `abuse page: expected 200, got ${abuse.status}`)
check(abuseHtml.includes('report abuse'), 'abuse page explains how to report')
if (ABUSE_EMAIL) {
  check(reportDraft(abuseHtml)?.pathname === ABUSE_EMAIL, 'abuse page shows the configured contact')
  check(!abuseHtml.includes(`>${ABUSE_EMAIL}<`), 'abuse page does not print the contact email')
  check(
    /<a class="button" href="mailto:[^"]+">report<\/a>/.test(abuseHtml),
    'abuse page offers a report button',
  )
}

const missingHtml = await (await fetch(`${BASE}/doesnotexist1`)).text()
check((missingHtml.match(/>new paste<\/a>/g) ?? []).length === 1, 'notice page exposes one new paste link')
check(
  missingHtml.indexOf('>new paste</a>') < missingHtml.indexOf('<main'),
  'notice new paste link is in the header',
)

for (const [path, type] of [
  ['/app.css', 'text/css'],
  ['/app.js', 'text/javascript'],
  ['/ape-logo.webp', 'image/webp'],
]) {
  const asset = await fetch(BASE + path)
  check(asset.status === 200, `${path}: expected 200, got ${asset.status}`)
  check(
    (asset.headers.get('content-type') ?? '').startsWith(type),
    `${path}: expected ${type}, got ${asset.headers.get('content-type')}`,
  )
  await asset.arrayBuffer()
}

const appJs = await (await fetch(`${BASE}/app.js`)).text()
check(appJs.includes('link[rel="canonical"]'), 'copy link reads the canonical url')

const home = await fetch(BASE + '/')
const homeCsp = home.headers.get('content-security-policy') ?? ''
const homeHtml = await home.text()
if (ABUSE_EMAIL) {
  const draft = reportDraft(homeHtml)
  check(draft?.pathname === ABUSE_EMAIL, 'home report addresses the configured contact')
  check(draft.searchParams.get('body')?.startsWith('paste link: \r\n'), 'home report leaves the link blank')
}
check(home.status === 200, `home: expected 200, got ${home.status}`)
check(homeHtml.includes('<h1>new paste</h1>'), 'home keeps the compose heading')
check(homeHtml.includes('action="/pastes"'), 'home keeps the create form')
check(!homeHtml.includes('class="quiet-link" href="/">new paste'), 'home does not duplicate the new paste link')
check(homeCsp.includes("default-src 'none'"), 'CSP blocks unrelated origins by default')
check(homeCsp.includes("script-src 'self'"), 'CSP allows the self-hosted script')
check(homeCsp.includes("style-src 'self'"), 'CSP allows the self-hosted stylesheet')
check(homeCsp.includes("img-src 'self' data:"), 'CSP allows self-hosted and data images')
check(!homeCsp.includes('unsafe-inline'), 'CSP does not allow inline code')

const limited = []
for (let attempt = 0; attempt < 10; attempt++) {
  const attemptResult = await create(`rate limit ${attempt}`)
  limited.push(attemptResult.response.status)
}
check(limited.includes(429), `create rate limiter returned 429 within the window, saw ${limited.join(',')}`)

console.log(`ok: ${checks} checks passed`)
