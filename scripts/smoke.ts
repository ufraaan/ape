import { DatabaseSync } from 'node:sqlite'

const BASE = process.env.SMOKE_BASE_URL ?? 'http://127.0.0.1:8787'
const ABUSE_EMAIL = process.env.SMOKE_ABUSE_EMAIL ?? ''
const DO_SQLITE = process.env.SMOKE_DO_SQLITE

let checks = 0
function check(condition: unknown, message: string) {
  checks++
  if (!condition) throw new Error(`FAIL: ${message}`)
}

function form(fields: Record<string, string>): string {
  return new URLSearchParams(fields).toString()
}

async function post(
  path: string,
  fields: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<Response> {
  return fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    body: form(fields),
    redirect: 'manual',
  })
}

function createdId(response: Response): string | null {
  const path = response.headers.get('location') ?? ''
  const match = path.match(/^\/([A-Za-z0-9]{6})$/)
  return match?.[1] ?? null
}

function reportDraft(html: string): URL | null {
  const href = html.match(/href="(mailto:[^"]+)"/)?.[1]
  return href ? new URL(href.replaceAll('&amp;', '&')) : null
}

function linksMade(html: string): number | null {
  const match = html.match(/([\d,]+) links made so far\./)
  return match ? Number(match[1].replaceAll(',', '')) : null
}

function agePaste(id: string) {
  if (!DO_SQLITE) return false
  const db = new DatabaseSync(DO_SQLITE)
  db.prepare('UPDATE pastes SET expires_at = 1 WHERE id = ?').run(id)
  db.close()
  return true
}

async function create(body: string, ttl = '1h'): Promise<{ response: Response; html: string }> {
  const response = await post('/pastes', { body, ttl })
  return { response, html: await response.text() }
}

async function expect404(path: string, label: string) {
  const response = await fetch(BASE + path)
  check(response.status === 404, `${label}: expected 404, got ${response.status}`)
  await response.arrayBuffer()
}

const mainBody = 'first line\n<script>alert("xss")</script></textarea><img src=x onerror=alert(1)>\n👋 café'
const main = await create(mainBody)
check(main.response.status === 303, `create: expected 303, got ${main.response.status}`)
check(main.response.headers.get('cache-control') === 'no-store', 'create redirect is not cached')

const id = createdId(main.response)
check(Boolean(id), 'create redirects to a six-character paste url')
check(id !== 'pastes', 'generated ids avoid the create route word')
const page = await fetch(`${BASE}/${id}`)
const pageHtml = await page.text()
check(page.status === 200, `view: expected 200, got ${page.status}`)
check(page.headers.get('x-robots-tag') === null, 'paste pages allow indexing')
check(page.headers.get('cache-control') === 'no-store', 'paste pages are not cached')
check(!pageHtml.includes('<script>alert("xss")</script>'), 'view escapes script markup')
check(!pageHtml.includes('<img src=x onerror'), 'view escapes attribute-breakout markup')
check(pageHtml.includes('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;'), 'view contains escaped paste text')
check(!pageHtml.includes(mainBody), 'view does not echo the raw body')
check(!pageHtml.includes('deletion token'), 'view has no deletion token')
check(pageHtml.includes(`<link rel="canonical" href="/${id}" />`), 'view declares the short url as canonical')
check(pageHtml.includes('data-highlight'), 'view marks the code block for highlighting')
check(pageHtml.includes('src="/vendor/prism.js"'), 'view loads the local highlighter')
if (ABUSE_EMAIL) {
  const draft = reportDraft(pageHtml)
  check(draft?.pathname === ABUSE_EMAIL, 'paste report addresses the configured contact')
  check(draft?.searchParams.get('subject') === 'ape abuse report', 'paste report has a subject')
  const reportBody = draft?.searchParams.get('body') ?? ''
  check(
    reportBody.startsWith('paste link: ') &&
      new URL(reportBody.split('\r\n')[0].slice('paste link: '.length)).pathname === `/${id}`,
    'paste report includes the canonical url',
  )
  const timestamp = reportBody.match(/^report timestamp: ([^\r\n]+)/m)?.[1]
  check(timestamp && Math.abs(Date.now() - Date.parse(timestamp)) < 60_000, 'paste report includes a fresh timestamp')
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

check(raw.headers.get('x-robots-tag') === null, 'raw pastes allow indexing')

const independentRaw = await fetch(`${BASE}/${id}/raw`)
const independentBytes = new Uint8Array(await independentRaw.arrayBuffer())
check(
  Buffer.from(independentBytes).equals(Buffer.from(rawBytes)),
  'independent raw reads return identical bytes',
)

await expect404('/doesnotexist1/raw', 'unknown paste raw')
await expect404('/short', 'malformed paste id')
await expect404('/short/raw', 'malformed paste id raw')
await expect404('/abcde', 'five-character paste id')
await expect404('/abcdefg', 'seven-character paste id')
await expect404('/abcde!', 'paste id with an invalid character')
await expect404('/abc_def', 'paste id with a legacy-only character and length')
await expect404('/AAAAAA/raw', 'valid-looking missing paste raw')
await expect404('/abcde/raw', 'short missing paste raw')
const invalidLegacy = await fetch(`${BASE}/p/abcde`, { redirect: 'manual' })
check(invalidLegacy.status === 404, 'invalid old paste links do not redirect')
await invalidLegacy.arrayBuffer()

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
check(Boolean(expiringId), 'expiry paste has an id')
// local dev only: backdate the row in the durable object's sqlite file, which is the only
// way to observe expiry without waiting out the shortest ttl
if (expiringId && agePaste(expiringId)) {
  await expect404(`/${expiringId}`, 'expired paste view')
  await expect404(`/${expiringId}/raw`, 'expired paste raw')
}

for (const path of [`/${id}/delete`, `/p/${id}/delete`]) {
  const removedEndpoint = await post(path, {})
  check(removedEndpoint.status === 404, 'public delete endpoint is unavailable')
  await removedEndpoint.arrayBuffer()
}
check((await fetch(`${BASE}/${id}`)).status === 200, 'paste stays available until it expires')

await expect404('/abuse', 'abuse page')

const missingHtml = await (await fetch(`${BASE}/doesnotexist1`)).text()
check((missingHtml.match(/>new paste<\/a>/g) ?? []).length === 1, 'notice page exposes one new paste link')
check(
  missingHtml.indexOf('>new paste</a>') < missingHtml.indexOf('<main'),
  'notice new paste link is in the header',
)

for (const [path, type] of [
  ['/app.css', 'text/css'],
  ['/app.js', 'text/javascript'],
  ['/vendor/prism.js', 'text/javascript'],
  ['/ape-logo.webp', 'image/webp'],
  ['/og.jpg', 'image/jpeg'],
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

const themeCss = await (await fetch(`${BASE}/app.css`)).text()
check(themeCss.includes('.token.keyword'), 'theme colours highlighted tokens')

const highlighter = await (await fetch(`${BASE}/vendor/prism.js`)).text()
check(highlighter.includes('languages.c='), 'highlighter bundles the c grammar')
check(highlighter.includes('languages.python='), 'highlighter bundles the python grammar')
check(!highlighter.includes('hljs-'), 'highlighter is not the old highlight.js bundle')

const robots = await fetch(BASE + '/robots.txt')
check(robots.status === 200, 'robots.txt is available')
check((await robots.text()).trim() === 'User-agent: *\nAllow: /', 'robots.txt allows all crawlers')

const home = await fetch(BASE + '/')
check(home.headers.get('x-robots-tag') === null, 'home allows indexing')
const homeCsp = home.headers.get('content-security-policy') ?? ''
const homeHtml = await home.text()
if (ABUSE_EMAIL) {
  const draft = reportDraft(homeHtml)
  check(draft?.pathname === ABUSE_EMAIL, 'home report addresses the configured contact')
  check(draft?.searchParams.get('body')?.startsWith('paste link: \r\n'), 'home report leaves the link blank')
  check(
    /<footer[\s\S]*?<a [^>]*href="mailto:[^"]+" data-report-abuse>report abuse<\/a>[\s\S]*?<\/footer>/.test(homeHtml),
    'home footer reports abuse by mail',
  )
}
check(!homeHtml.includes('href="/abuse"'), 'home does not link to the removed abuse page')
check(home.status === 200, `home: expected 200, got ${home.status}`)
check(/<h1[^>]*>new paste<\/h1>/.test(homeHtml), 'home keeps the compose heading')
check(homeHtml.includes('action="/pastes"'), 'home keeps the create form')
check(!homeHtml.includes('href="/">new paste'), 'home does not duplicate the new paste link')
check(!homeHtml.includes('/vendor/prism.js'), 'compose does not load the highlighter')
check(homeHtml.includes('property="og:image" content="https://ape.ufraan.dev/og.jpg"'), 'compose links the og image')
check(homeHtml.includes('name="twitter:card" content="summary_large_image"'), 'compose sets the twitter card')
const homeCount = linksMade(homeHtml)
check(homeCount !== null, 'home footer shows the link count')
check(
  /<footer[\s\S]*?<p class="me-auto tabular-nums">[\d,]+ links made so far\.<\/p>[\s\S]*?<\/footer>/.test(homeHtml),
  'home footer formats the link count',
)
check(homeCsp.includes("default-src 'none'"), 'CSP blocks unrelated origins by default')
check(homeCsp.includes("script-src 'self'"), 'CSP allows the self-hosted script')
check(homeCsp.includes("style-src 'self'"), 'CSP allows the self-hosted stylesheet')
check(homeCsp.includes("font-src 'self'"), 'CSP allows the self-hosted font')
check(homeCsp.includes("img-src 'self' data:"), 'CSP allows self-hosted and data images')
check(!homeCsp.includes('unsafe-inline'), 'CSP does not allow inline code')

const counted = await create('count me')
check(counted.response.status === 303, 'created paste for the link count test')
const recountedHtml = await (await fetch(BASE + '/')).text()
check(
  homeCount !== null && linksMade(recountedHtml) === homeCount + 1,
  'link count advances with each paste',
)

const limited: number[] = []
for (let attempt = 0; attempt < 10; attempt++) {
  const attemptResult = await create(`rate limit ${attempt}`)
  limited.push(attemptResult.response.status)
}
check(limited.includes(429), `create rate limiter returned 429 within the window, saw ${limited.join(',')}`)

let readStatus = 0
for (let attempt = 0; attempt < 200 && readStatus !== 429; attempt++) {
  const response = await fetch(`${BASE}/AAAAAA`)
  readStatus = response.status
  await response.arrayBuffer()
}
check(readStatus === 429, `read rate limiter returned 429, last status ${readStatus}`)
const limitedRaw = await fetch(`${BASE}/AAAAAA/raw`)
check(limitedRaw.status === 429, 'read rate limiter covers raw reads')
await limitedRaw.arrayBuffer()

console.log(`ok: ${checks} checks passed`)
