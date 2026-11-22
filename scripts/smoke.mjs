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

function canonicalId(html) {
  const match = html.match(/<link rel="canonical" href="\/p\/([^"]+)"/)
  return match?.[1] ?? null
}

function deleteToken(html) {
  const match = html.match(/id="delete-token-value">([^<]+)</)
  return match?.[1] ?? null
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
check(main.response.status === 201, `create: expected 201, got ${main.response.status}`)
check(main.html.includes('<link rel="canonical" href="/p/'), 'create response carries a canonical paste link')
check(!main.html.includes('<script>alert("xss")</script>'), 'create response escapes script markup')
check(!main.html.includes('<img src=x onerror'), 'create response escapes attribute-breakout markup')

const id = canonicalId(main.html)
check(Boolean(id), 'create response exposes the canonical paste id')
const token = deleteToken(main.html)
check(Boolean(token), 'create response exposes the deletion token once')
check(main.response.headers.get('x-robots-tag') === 'noindex, nofollow', 'paste pages are noindex')
check(main.response.headers.get('cache-control') === 'no-store', 'paste pages are not cached')

const page = await fetch(`${BASE}/p/${id}`)
const pageHtml = await page.text()
check(page.status === 200, `view: expected 200, got ${page.status}`)
check(pageHtml.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'), 'view escapes script markup')
check(!pageHtml.includes(mainBody), 'view does not echo the raw body')
check(!pageHtml.includes(token), 'view does not leak the deletion token')
check(pageHtml.includes(`/p/${id}`), 'view links back to its canonical url')

const raw = await fetch(`${BASE}/p/${id}/raw`)
const rawBytes = new Uint8Array(await raw.arrayBuffer())
check(raw.status === 200, `raw: expected 200, got ${raw.status}`)
check(raw.headers.get('content-type') === 'text/plain; charset=utf-8', 'raw is plain utf-8 text')
check(!new TextDecoder().decode(rawBytes).includes(token), 'raw does not include the deletion token')
check(new TextDecoder().decode(rawBytes) === mainBody, 'raw returns the exact bytes that were stored')

const independentRaw = await fetch(`${BASE}/p/${id}/raw`)
const independentBytes = new Uint8Array(await independentRaw.arrayBuffer())
check(
  Buffer.from(independentBytes).equals(Buffer.from(rawBytes)),
  'independent raw reads return identical bytes',
)

await expect404('/p/doesnotexist1/raw', 'unknown paste raw')
await expect404('/p/short', 'malformed paste id')
await expect404('/p/short/raw', 'malformed paste id raw')

const exact = 'a'.repeat(65530) + '👋é'
check(new TextEncoder().encode(exact).byteLength === 65536, 'fixture is exactly the 64 KiB limit')
const max = await create(exact)
check(max.response.status === 201, `max utf-8 paste: expected 201, got ${max.response.status}`)
const maxId = canonicalId(max.html)
check(Boolean(maxId), 'max utf-8 paste has an id')
const maxRaw = new Uint8Array(await (await fetch(`${BASE}/p/${maxId}/raw`)).arrayBuffer())
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
check(expiring.response.status === 201, 'created paste for expiry test')
const expiringId = canonicalId(expiring.html)
localSql(`UPDATE pastes SET expires_at = 1 WHERE id = '${expiringId}'`)
await expect404(`/p/${expiringId}`, 'expired paste view')
await expect404(`/p/${expiringId}/raw`, 'expired paste raw')

const scheduled = await fetch(`${BASE}/__scheduled?cron=17+*+*+*+*`)
await scheduled.arrayBuffer()
check(scheduled.status === 200, `scheduled trigger: expected 200, got ${scheduled.status}`)
const remaining = JSON.parse(localSql(`SELECT count(*) AS n FROM pastes WHERE id = '${expiringId}'`))
check(remaining[0].results[0].n === 0, 'scheduled cleanup removed the expired row')

const deletable = await create('delete me')
check(deletable.response.status === 201, 'created paste for delete test')
const deletableId = canonicalId(deletable.html)
const deletableToken = deleteToken(deletable.html)

const malformed = await post(`/p/${deletableId}/delete`, { token: 'short' })
check(malformed.status === 404, `malformed token: expected 404, got ${malformed.status}`)
await malformed.arrayBuffer()
check((await fetch(`${BASE}/p/${deletableId}`)).status === 200, 'malformed token leaves paste in place')

const wrongToken = await post(`/p/${deletableId}/delete`, { token: 'A'.repeat(43) })
check(wrongToken.status === 404, `wrong token: expected 404, got ${wrongToken.status}`)
await wrongToken.arrayBuffer()
check((await fetch(`${BASE}/p/${deletableId}`)).status === 200, 'wrong token leaves paste in place')

const deleted = await post(`/p/${deletableId}/delete`, { token: deletableToken })
check(deleted.status === 200, `delete: expected 200, got ${deleted.status}`)
check((await deleted.text()).includes('paste deleted'), 'delete confirms removal')
await expect404(`/p/${deletableId}`, 'deleted paste view')
await expect404(`/p/${deletableId}/raw`, 'deleted paste raw')
const replayed = await post(`/p/${deletableId}/delete`, { token: deletableToken })
check(replayed.status === 404, `replayed delete: expected 404, got ${replayed.status}`)
await replayed.arrayBuffer()

const abuse = await fetch(`${BASE}/abuse`)
const abuseHtml = await abuse.text()
check(abuse.status === 200, `abuse page: expected 200, got ${abuse.status}`)
check(abuseHtml.includes('report abuse'), 'abuse page explains how to report')
if (ABUSE_EMAIL) {
  check(abuseHtml.includes(`mailto:${ABUSE_EMAIL}`), 'abuse page shows the configured contact')
}

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
await home.text()
check(home.status === 200, `home: expected 200, got ${home.status}`)
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
