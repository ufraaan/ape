import { Hono } from 'hono'
import type { Context } from 'hono'
import type { ContentfulStatusCode } from 'hono/utils/http-status'
import { PasteStore } from './store'
import { renderCompose, renderNotice, renderPaste } from './views'

type RateLimiter = {
  limit(options: { key: string }): Promise<{ success: boolean }>
}

type Bindings = {
  PASTES: DurableObjectNamespace<PasteStore>
  TURNSTILE_SITE_KEY?: string
  TURNSTILE_SECRET_KEY?: string
  CREATE_RATE_LIMIT?: RateLimiter
  READ_RATE_LIMIT?: RateLimiter
  ABUSE_EMAIL?: string
}

type TurnstileKeys = {
  siteKey?: string
  secretKey?: string
}

type AppContext = Context<{ Bindings: Bindings; Variables: { turnstile: TurnstileKeys } }>

const MAX_PASTE_BYTES = 64 * 1024
// percent-encoding expands one byte to three characters, plus room for the other fields
const MAX_FORM_BYTES = MAX_PASTE_BYTES * 3 + 4096
const TTL_SECONDS = { '1h': 3600, '1d': 86400, '7d': 604800 } as const
const DEFAULT_TTL = '1d'
const PASTE_ID = /^[A-Za-z0-9]{6}$/
const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

const app = new Hono<{ Bindings: Bindings; Variables: { turnstile: TurnstileKeys } }>()

function pasteStore(env: Bindings): DurableObjectStub<PasteStore> {
  return env.PASTES.get(env.PASTES.idFromName('pastes'))
}

function turnstileKeys(env: Bindings): TurnstileKeys | null {
  const siteKey = env.TURNSTILE_SITE_KEY?.trim() || undefined
  const secretKey = env.TURNSTILE_SECRET_KEY?.trim() || undefined
  if (!siteKey && !secretKey) return {}
  if (!siteKey || !secretKey) return null
  return { siteKey, secretKey }
}

function pageHeaders(turnstile: boolean): Record<string, string> {
  const script = turnstile
    ? "script-src 'self' https://challenges.cloudflare.com"
    : "script-src 'self'"
  const frame = turnstile ? 'frame-src https://challenges.cloudflare.com' : "frame-src 'none'"
  const connect = turnstile
    ? "connect-src 'self' https://challenges.cloudflare.com"
    : "connect-src 'self'"
  return {
    'Cache-Control': 'no-store',
    'Content-Security-Policy': [
      "default-src 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "style-src 'self'",
      "font-src 'self'",
      script,
      frame,
      connect,
    ].join('; '),
    'Referrer-Policy': 'same-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  }
}

function rawHeaders(): Record<string, string> {
  return {
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Disposition': 'inline; filename="paste.txt"',
    'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Robots-Tag': 'noindex, nofollow',
  }
}

async function page(
  c: AppContext,
  status: ContentfulStatusCode,
  markup: string | Promise<string>,
  turnstile = false,
): Promise<Response> {
  return c.html(await markup, status, pageHeaders(turnstile))
}

function abuseReportHref(c: AppContext, pasteId?: string): string | undefined {
  const email = c.env.ABUSE_EMAIL?.trim()
  if (!email) return undefined

  const pasteUrl = pasteId ? new URL(`/${pasteId}`, c.req.url).href : ''
  const subject = encodeURIComponent('ape abuse report')
  const timestamp = new Date().toISOString()
  const body = encodeURIComponent(
    `paste link: ${pasteUrl}\r\nreport timestamp: ${timestamp}\r\n\r\nwhat are you reporting?\r\n`,
  )
  return `mailto:${email}?subject=${subject}&body=${body}`
}

function notice(
  c: AppContext,
  status: ContentfulStatusCode,
  title: string,
  message: string,
): Promise<Response> {
  return page(c, status, renderNotice({ title, message }))
}

function compose(
  c: AppContext,
  status: ContentfulStatusCode,
  body: string | undefined,
  ttl: string | undefined,
  error?: string,
): Promise<Response> {
  const { siteKey } = c.get('turnstile')
  return page(
    c,
    status,
    renderCompose({ body, ttl, error, turnstileSiteKey: siteKey, reportHref: abuseReportHref(c) }),
    Boolean(siteKey),
  )
}

function isSameOrigin(request: Request): boolean {
  const origin = request.headers.get('origin')
  if (origin) return origin === new URL(request.url).origin
  const site = request.headers.get('sec-fetch-site')
  return site === null || site === 'same-origin' || site === 'none'
}

async function readCapped(request: Request, limit: number): Promise<string | null> {
  const declared = request.headers.get('content-length')
  if (declared !== null && Number(declared) > limit) return null
  if (!request.body) return ''
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => undefined)
      return null
    }
    chunks.push(value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

async function readForm(c: AppContext): Promise<URLSearchParams | Response> {
  const contentType = c.req.header('content-type') ?? ''
  if (!contentType.toLowerCase().startsWith('application/x-www-form-urlencoded')) {
    return notice(
      c,
      415,
      'unsupported request',
      'submit this form from the paste page in your browser.',
    )
  }
  const text = await readCapped(c.req.raw, MAX_FORM_BYTES)
  if (text === null) {
    return notice(c, 413, 'paste too large', 'pastes are limited to 64 kib of utf-8 text.')
  }
  return new URLSearchParams(text)
}

function parseTtl(value: string | null): { label: string; seconds: number } {
  if (value === '1h' || value === '1d' || value === '7d') {
    return { label: value, seconds: TTL_SECONDS[value] }
  }
  return { label: DEFAULT_TTL, seconds: TTL_SECONDS[DEFAULT_TTL] }
}

async function readNotLimited(c: AppContext): Promise<Response | null> {
  const limiter = c.env.READ_RATE_LIMIT
  if (!limiter) return null
  const { success } = await limiter.limit({ key: c.req.header('cf-connecting-ip') ?? 'unknown' })
  if (success) return null
  return notice(c, 429, 'too many requests', 'please wait a moment before opening more pastes.')
}

async function findPaste(c: AppContext) {
  const id = c.req.param('id') ?? ''
  if (!PASTE_ID.test(id)) return null
  return pasteStore(c.env).get(id)
}

async function verifyTurnstile(secret: string, token: string, remoteIp?: string): Promise<boolean> {
  const form = new URLSearchParams({ secret, response: token })
  if (remoteIp) form.set('remoteip', remoteIp)
  try {
    const response = await fetch(TURNSTILE_VERIFY_URL, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) return false
    const result = (await response.json()) as { success?: boolean }
    return result.success === true
  } catch {
    return false
  }
}

app.use('*', async (c, next) => {
  const keys = turnstileKeys(c.env)
  if (!keys) {
    return notice(
      c,
      503,
      'service unavailable',
      'this paste service is misconfigured. please try again later.',
    )
  }
  c.set('turnstile', keys)
  await next()
})

app.get('/', (c) => {
  return compose(c, 200, undefined, undefined)
})

app.post('/pastes', async (c) => {
  if (!isSameOrigin(c.req.raw)) {
    return notice(c, 403, 'request blocked', 'cross-site form submissions are not allowed.')
  }

  const ip = c.req.header('cf-connecting-ip')
  if (c.env.CREATE_RATE_LIMIT) {
    const outcome = await c.env.CREATE_RATE_LIMIT.limit({ key: ip ?? 'unknown' })
    if (!outcome.success) {
      return notice(
        c,
        429,
        'too many pastes',
        'please wait a moment before creating another paste.',
      )
    }
  }

  const form = await readForm(c)
  if (form instanceof Response) return form

  const body = form.get('body') ?? ''
  const ttl = parseTtl(form.get('ttl'))
  if (new TextEncoder().encode(body).byteLength > MAX_PASTE_BYTES) {
    return compose(c, 413, body, ttl.label, 'pastes are limited to 64 kib of utf-8 text.')
  }
  if (!body.trim()) {
    return compose(c, 400, undefined, ttl.label, 'write something before creating a paste.')
  }

  const { secretKey } = c.get('turnstile')
  if (secretKey) {
    const token = form.get('cf-turnstile-response') ?? ''
    if (!token || !(await verifyTurnstile(secretKey, token, ip))) {
      return compose(c, 400, body, ttl.label, 'verification failed. please try again.')
    }
  }

  const paste = await pasteStore(c.env).create(body, ttl.seconds)
  c.header('Cache-Control', 'no-store')
  return c.redirect(`/${paste.id}`, 303)
})

app.get('/p/:id/raw', (c) => redirectLegacyPaste(c, '/raw'))
app.get('/p/:id', (c) => redirectLegacyPaste(c, ''))

function redirectLegacyPaste(c: AppContext, suffix: '' | '/raw') {
  const id = c.req.param('id') ?? ''
  if (!PASTE_ID.test(id)) {
    return c.notFound()
  }
  return c.redirect(`/${id}${suffix}`, 308)
}

app.get('/:id/raw', async (c) => {
  const limited = await readNotLimited(c)
  if (limited) return limited
  const paste = await findPaste(c)
  if (!paste) {
    return notice(c, 404, 'paste not found', 'this paste does not exist or has expired.')
  }
  return c.text(paste.body, 200, rawHeaders())
})

app.get('/:id', async (c) => {
  const limited = await readNotLimited(c)
  if (limited) return limited
  const paste = await findPaste(c)
  if (!paste) {
    return notice(c, 404, 'paste not found', 'this paste does not exist or has expired.')
  }
  return page(c, 200, renderPaste({ ...paste, reportHref: abuseReportHref(c, paste.id) }))
})

app.notFound((c) => notice(c, 404, 'not found', 'the page you requested does not exist.'))

app.onError((error, c) => {
  console.error('request failed:', error instanceof Error ? error.message : error)
  return notice(c, 503, 'service unavailable', 'something went wrong. please try again shortly.')
})

export { PasteStore } from './store'

export default { fetch: app.fetch }
