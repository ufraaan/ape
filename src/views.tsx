import { html } from 'hono/html'

type Markup = ReturnType<typeof html>

export interface ComposeOptions {
  body?: string
  ttl?: string
  error?: string
  turnstileSiteKey?: string
  reportHref?: string
  linkCount?: number
}

export interface PasteOptions {
  id: string
  body: string
  expiresAt: number
  reportHref?: string
}

export interface NoticeOptions {
  title: string
  message: string
}

const TTL_OPTIONS = [
  ['1h', '1 hour'],
  ['1d', '1 day'],
  ['7d', '7 days'],
] as const

const MAX_BYTES = 64 * 1024
const encoder = new TextEncoder()
const countFormat = new Intl.NumberFormat('en-US')
const ORIGIN = 'https://ape.ufraan.dev'
const DESCRIPTION = 'paste it. share it. gone. anonymous pastes with expiring links — no account, no tracking.'

function sizeLabel(bytes: number): string {
  if (bytes === 0) return '64 kib max'
  const size = bytes < 1024 ? `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}` : `${(bytes / 1024).toFixed(1)} kib`
  return bytes > MAX_BYTES ? `${size} / 64 kib (over limit)` : `${size} / 64 kib`
}

function expiryTime(expiresAt: number): Markup {
  const date = new Date(expiresAt * 1000)
  const remaining = expiresAt - Date.now() / 1000
  const [amount, unit] = remaining >= 86400
    ? [Math.ceil(remaining / 86400), 'day']
    : remaining >= 3600
      ? [Math.ceil(remaining / 3600), 'hour']
      : [Math.max(1, Math.ceil(remaining / 60)), 'minute']

  return html`expires in <time datetime="${date.toISOString()}">${amount} ${unit}${amount === 1 ? '' : 's'}</time>`
}

function copyButton(command: string, label: string, targetId: string): Markup {
  return html`<span class="relative hidden [[data-enhanced]_&]:inline-flex">
    <button class="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-[0.45rem] border border-border bg-surface px-3 py-[0.45rem] text-[0.875rem] leading-[1.25] font-[550] whitespace-nowrap no-underline hover:bg-[#f2f3f5]" type="button" command="${command}" commandfor="${targetId}">${label}</button>
    <span class="absolute bottom-[calc(100%_+_0.3rem)] start-0 z-[1] w-max max-w-44 rounded-[0.35rem] border border-border bg-surface px-[0.55rem] py-[0.35rem] text-[0.75rem] empty:hidden" role="status"></span>
  </span>`
}

function page(options: {
  title: string
  main: Markup
  turnstileSiteKey?: string
  canonicalPath?: string
  reportHref?: string
  linkCount?: number
  showNewPaste?: boolean
  highlight?: boolean
}): Markup {
  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#fafafa" />
    <title>${options.title}</title>
    <meta name="description" content="${DESCRIPTION}" />
    ${options.canonicalPath ? html`<link rel="canonical" href="${options.canonicalPath}" />` : ''}
    <meta property="og:type" content="website" />
    <meta property="og:site_name" content="ape" />
    <meta property="og:title" content="${options.title}" />
    <meta property="og:description" content="${DESCRIPTION}" />
    <meta property="og:url" content="${ORIGIN}${options.canonicalPath ?? '/'}" />
    <meta property="og:image" content="${ORIGIN}/og.jpg" />
    <meta property="og:image:type" content="image/jpeg" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="ape — paste it. share it. gone." />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${options.title}" />
    <meta name="twitter:description" content="${DESCRIPTION}" />
    <meta name="twitter:image" content="${ORIGIN}/og.jpg" />
    <meta name="twitter:image:alt" content="ape — paste it. share it. gone." />
    <link rel="icon" href="/ape-logo.webp" type="image/webp" />
    <link rel="stylesheet" href="/app.css" />
    ${options.highlight ? html`<script src="/vendor/prism.js" defer></script>` : ''}
    <script src="/app.js" defer></script>
    ${options.turnstileSiteKey
      ? html`<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
      : ''}
  </head>
  <body class="flex min-h-svh flex-col bg-canvas font-sans text-[0.9375rem]/[1.55] text-ink">
    <a class="not-focus:sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[1] focus:bg-surface focus:px-[0.8rem] focus:py-[0.55rem] underline underline-offset-[0.18em]" href="#main">skip to content</a>
    <header class="mx-auto flex min-h-16 w-[min(48rem,100%_-_2.5rem)] items-center justify-between border-b border-line">
      <a class="group inline-flex items-center gap-[0.4rem] text-[1.125rem] font-[650] tracking-[-0.04em] no-underline" href="/"><img class="grayscale group-hover:grayscale-0" src="/ape-logo.webp" width="28" height="28" alt="" />ape</a>
      ${options.canonicalPath || options.showNewPaste ? html`<a class="inline-flex min-h-11 items-center text-[0.8125rem] text-muted no-underline underline-offset-[0.18em] hover:underline" href="/">new paste</a>` : ''}
    </header>
    ${options.main}
    ${options.reportHref || options.linkCount !== undefined ? html`<footer class="mx-auto mt-auto flex w-[min(48rem,100%_-_2.5rem)] items-center justify-end gap-3 text-[0.8125rem] text-muted">
      ${options.linkCount !== undefined ? html`<p class="me-auto tabular-nums">${countFormat.format(options.linkCount)} links made so far.</p>` : ''}
      ${options.reportHref ? html`<a class="inline-flex min-h-11 items-center text-[0.8125rem] text-muted no-underline underline-offset-[0.18em] hover:underline" href="${options.reportHref}" data-report-abuse>report abuse</a>` : ''}
    </footer>` : ''}
  </body>
</html>`
}

export function renderCompose(options: ComposeOptions = {}): string | Promise<string> {
  const body = options.body ?? ''
  const ttl = options.ttl === '1h' || options.ttl === '7d' ? options.ttl : '1d'
  const bytes = encoder.encode(body).length

  return page({
    title: 'new paste · ape',
    turnstileSiteKey: options.turnstileSiteKey,
    reportHref: options.reportHref,
    linkCount: options.linkCount,
    main: html`<main id="main" class="mx-auto w-[min(48rem,100%_-_2.5rem)] pt-[clamp(2rem,5vw,4rem)] pb-8">
      <h1 class="text-title">new paste</h1>
      <p class="subhead mt-[0.4rem] text-muted" id="visibility">anyone with the link can read it.</p>
      <form method="post" action="/pastes" class="mt-3">
        ${options.error ? html`<p id="paste-error" class="mt-0 mb-3 text-danger" role="alert">${options.error}</p>` : ''}
        <div class="mb-[0.35rem] flex justify-end text-[0.75rem] text-muted tabular-nums">
          <span class="group relative cursor-help" tabindex="0" aria-describedby="byte-estimate">
            <span id="byte-count" data-count class="data-over:text-danger" ${bytes > MAX_BYTES ? html`data-over` : ''}>${sizeLabel(bytes)}</span>
            <span class="invisible absolute bottom-full end-0 z-[1] w-max max-w-[min(16rem,80vw)] rounded-[0.35rem] border border-border bg-surface px-[0.55rem] py-[0.3rem] group-hover:visible group-focus:visible" id="byte-estimate" role="tooltip">about 820 lines of code at 80 bytes per line</span>
          </span>
        </div>
        <div class="rounded-[0.625rem] border border-border bg-surface forced-colors:focus-within:[outline:2px_solid_Highlight]">
          <label class="sr-only" for="body">paste text</label>
          <textarea id="body" name="body" data-body autofocus required spellcheck="false"
            class="block min-h-[clamp(15rem,43vh,28rem)] w-full resize-y rounded-[inherit] border-0 bg-transparent p-4 font-mono text-base/[1.65] tab-2 placeholder:font-sans placeholder:text-[0.875rem] placeholder:text-muted focus-visible:outline-none"
            aria-describedby="visibility byte-count${options.error ? ' paste-error' : ''}"
            ${bytes > MAX_BYTES ? html`aria-invalid="true"` : ''}
            placeholder="paste or type here"
          >
${body}</textarea>
        </div>
        ${options.turnstileSiteKey
          ? html`<div class="mt-3">
              <div class="cf-turnstile" data-sitekey="${options.turnstileSiteKey}" data-theme="light" data-size="flexible"></div>
            </div>`
          : ''}
        <div class="mt-3 flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-2">
            <label for="ttl" class="text-[0.8125rem] text-muted">expires</label>
            <span class="relative inline-grid items-center after:pointer-events-none after:absolute after:end-[0.55rem] after:block after:size-[0.4rem] after:-translate-y-1/4 after:rotate-45 after:border-e after:border-b after:border-current after:content-['']">
              <select id="ttl" name="ttl" class="min-h-8 appearance-none rounded-[0.45rem] border border-border bg-surface py-0 pr-[1.3rem] pl-2 text-[0.875rem]">${TTL_OPTIONS.map(([value, label]) =>
                currentOption(value, label, ttl)
              )}</select>
            </span>
          </div>
          <button class="inline-flex min-h-8 cursor-pointer items-center justify-center rounded-[0.45rem] border border-border bg-surface px-[0.6rem] py-0 text-[0.875rem] leading-[1.25] font-normal whitespace-nowrap no-underline hover:bg-[#f2f3f5] data-busy:cursor-progress data-busy:opacity-75" type="submit" data-submit aria-keyshortcuts="Meta+Enter Control+Enter">create paste</button>
        </div>
      </form>
    </main>`,
  })
}

function currentOption(value: string, label: string, current: string): Markup {
  return current === value
    ? html`<option value="${value}" selected>${label}</option>`
    : html`<option value="${value}">${label}</option>`
}

export function renderPaste(options: PasteOptions): string | Promise<string> {
  const path = `/${encodeURIComponent(options.id)}`

  return page({
    title: 'paste · ape',
    canonicalPath: path,
    reportHref: options.reportHref,
    highlight: true,
    main: html`<main id="main" class="mx-auto w-[min(48rem,100%_-_2.5rem)] pt-[clamp(2rem,5vw,4rem)] pb-8">
      <div class="flex flex-wrap items-end justify-between gap-[0.85rem]">
        <div>
          <h1 class="text-title"><a class="no-underline" href="${path}">paste</a></h1>
          <p class="subhead mt-[0.4rem] text-muted">${expiryTime(options.expiresAt)}</p>
        </div>
        <div class="flex flex-wrap items-center gap-2">
          ${copyButton('--copy-link', 'copy link', 'paste-body')}
          ${copyButton('--copy-text', 'copy text', 'paste-body')}
          <a class="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-[0.45rem] border border-border bg-surface px-3 py-[0.45rem] text-[0.875rem] leading-[1.25] font-[550] whitespace-nowrap no-underline hover:bg-[#f2f3f5]" href="${path}/raw">raw</a>
        </div>
      </div>
      <pre class="mt-5 min-h-20 rounded-[0.625rem] border border-border bg-surface p-4 font-mono text-[0.9375rem]/[1.65] whitespace-pre-wrap [overflow-wrap:anywhere] tab-2" id="paste-body" tabindex="0" aria-label="paste text"><code data-highlight class="[font:inherit]">${options.body}</code></pre>
    </main>`,
  })
}

export function renderNotice(options: NoticeOptions): string | Promise<string> {
  return page({
    title: `${options.title} · ape`,
    showNewPaste: true,
    main: html`<main id="main" class="mx-auto grid w-[min(48rem,100%_-_2.5rem)] justify-items-start gap-3 pt-[clamp(2rem,5vw,4rem)] pb-8">
      <h1 class="text-title">${options.title}</h1>
      <p class="subhead mt-[0.4rem] max-w-[58ch] whitespace-pre-line text-muted">${options.message}</p>
    </main>`,
  })
}
