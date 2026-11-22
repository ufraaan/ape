import { html } from 'hono/html'

type Markup = ReturnType<typeof html>

export interface ComposeOptions {
  body?: string
  ttl?: string
  error?: string
  turnstileSiteKey?: string
}

export interface PasteOptions {
  id: string
  body: string
  expiresAt: number
  deleteToken?: string
  error?: string
}

export interface NoticeOptions {
  title: string
  message: string
  abuseEmail?: string
}

const TTL_OPTIONS = [
  ['1h', '1 hour'],
  ['1d', '1 day'],
  ['7d', '7 days'],
] as const

const MAX_BYTES = 64 * 1024

const DESCRIPTION = 'Paste up to 64 KiB of plain text, share the link, and let it expire. No account, no password.'
const THEME_COLOR = '#f6f2ea'

function utf8Length(value: string): number {
  let bytes = 0
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4
  }
  return bytes
}

function sizeLabel(bytes: number): string {
  const kib = (bytes / 1024).toFixed(1)
  return bytes > MAX_BYTES ? `${kib} KiB of 64 KiB (over limit)` : `${kib} KiB of 64 KiB`
}

function shortSize(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

function lineLabel(value: string): string {
  const count = value === '' ? 0 : value.split('\n').length
  return `${count} ${count === 1 ? 'line' : 'lines'}`
}

function expiryTime(expiresAt: number): { label: string; iso: string } {
  const date = new Date(expiresAt * 1000)
  const iso = Number.isFinite(expiresAt) && !Number.isNaN(date.getTime()) ? date.toISOString() : ''
  const remaining = Math.round(expiresAt - Date.now() / 1000)
  if (!Number.isFinite(remaining) || remaining <= 0) return { label: 'Expired', iso }
  const unit = (count: number, name: string) => `${count} ${name}${count === 1 ? '' : 's'}`
  if (remaining < 3600) return { label: `in ${unit(Math.max(1, Math.floor(remaining / 60)), 'minute')}`, iso }
  if (remaining < 172800) return { label: `in ${unit(Math.round(remaining / 3600), 'hour')}`, iso }
  return { label: `in ${unit(Math.round(remaining / 86400), 'day')}`, iso }
}

function copyButton(command: string, label: string, targetId: string): Markup {
  return html`<span class="copy"
    ><button
      class="button"
      type="button"
      command="${command}"
      commandfor="${targetId}"
    >
      ${label}</button
    ><span class="tip" role="status"></span
  ></span>`
}

function ttlOptions(current: string): Markup {
  return html`${TTL_OPTIONS.map(([value, label]) =>
    current === value
      ? html`<option value="${value}" selected>${label}</option>`
      : html`<option value="${value}">${label}</option>`
  )}`
}

function page(options: {
  title: string
  description: string
  main: Markup
  headerMeta?: string
  newPaste?: boolean
  turnstileSiteKey?: string
  showFooter?: boolean
  canonicalPath?: string
}): Markup {
  return html`<!doctype html>
<html lang="en" data-type="software" data-radius="sharp">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="color-scheme" content="light" />
    <meta name="theme-color" content="${THEME_COLOR}" />
    <meta name="page-type" content="software" />
    <meta name="site-kind" content="software" />
    <title>${options.title}</title>
    <meta name="description" content="${options.description}" />
    <meta property="og:title" content="${options.title}" />
    <meta property="og:description" content="${options.description}" />
    <meta property="og:type" content="website" />
    <meta property="og:image" content="/share.png" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta name="twitter:card" content="summary_large_image" />
    ${options.canonicalPath
      ? html`<link rel="canonical" href="${options.canonicalPath}" />`
      : ''}
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/app.css" />
    <script src="/app.js" defer></script>
    ${options.turnstileSiteKey
      ? html`<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
      : ''}
  </head>
  <body>
    <header class="masthead nav">
      <a class="skip" href="#main">Skip to content</a>
      <div class="wrap masthead-inner">
        <a class="brand" href="/"
          ><span class="brand-word">ape</span
          ><span class="brand-mark" aria-hidden="true"></span></a
        >
        ${options.newPaste
          ? html`<a class="masthead-link" href="/">Create a paste</a>`
          : options.headerMeta
            ? html`<span class="masthead-meta">${options.headerMeta}</span>`
            : ''}
      </div>
    </header>
    ${options.main}
    ${options.showFooter === false
      ? ''
      : html`<footer class="site-footer closing">
          <div class="wrap">
            <span class="footer-note">No account required.</span>
            <a href="/abuse">Report abuse</a>
          </div>
        </footer>`}
  </body>
</html>`
}

export function renderCompose(options: ComposeOptions = {}): string | Promise<string> {
  const body = options.body ?? ''
  const ttl = options.ttl === '1h' || options.ttl === '7d' ? options.ttl : '1d'
  const count = utf8Length(body)

  const main = html`<main id="main" class="main">
  <section class="stage" data-enter aria-labelledby="compose-title">
    <div class="wrap stage-grid">
      <div class="stage-intro">
        <h1 id="compose-title" class="display">A pastebin for plain text</h1>
        <p class="lead">Type or paste up to 64 KiB and share the link. Every paste expires on its own, and the deletion token is shown once to the person who made it.</p>
      </div>
      <div class="stage-spec">
        <dl class="facts">
          <div class="fact"><dt>Limit</dt><dd>64 KiB of UTF-8 text</dd></div>
          <div class="fact"><dt>Expiry</dt><dd>1 hour, 1 day, or 7 days</dd></div>
          <div class="fact"><dt>Access</dt><dd>Anyone with the link</dd></div>
        </dl>
        <p class="stage-note">Do not paste anything you would not post publicly.</p>
      </div>
      <div class="stage-form">
        ${options.error ? html`<p class="error" role="alert">${options.error}</p>` : ''}
        <form class="composer" method="post" action="/pastes" aria-labelledby="compose-title">
          <div class="composer-head">
            <label class="composer-label" for="body"
              ><span class="brand-mark" aria-hidden="true"></span>Paste text</label
            >
            <span class="composer-lines" data-lines aria-hidden="true">${lineLabel(body)}</span>
          </div>
          <textarea
            id="body"
            name="body"
            data-body
            required
            aria-describedby="byte-count"
            ${count > MAX_BYTES ? html`aria-invalid="true"` : ''}
            placeholder="Type or paste text here"
          >${body}</textarea>
          <div class="composer-bar">
            <output
              id="byte-count"
              class="count"
              data-count
              for="body"
              ${count > MAX_BYTES ? html`data-over` : ''}
              >${sizeLabel(count)}</output
            >
            <div class="composer-actions">
              <div class="field-inline">
                <label class="inline-label" for="ttl">Expires</label>
                <select class="select" id="ttl" name="ttl">${ttlOptions(ttl)}</select>
              </div>
              <button class="button button--primary" type="submit" data-submit>Create paste</button>
            </div>
          </div>
        </form>
        ${options.turnstileSiteKey
          ? html`<div class="turnstile-slot">
              <div class="cf-turnstile" data-sitekey="${options.turnstileSiteKey}" data-theme="light"></div>
            </div>`
          : ''}
      </div>
    </div>
  </section>
</main>`

  return page({
    title: 'Ape: a pastebin for plain text',
    description: DESCRIPTION,
    headerMeta: '64 KiB per paste',
    main,
    turnstileSiteKey: options.turnstileSiteKey,
  })
}

export function renderPaste(options: PasteOptions): string | Promise<string> {
  const body = options.body ?? ''
  const path = `/p/${encodeURIComponent(options.id)}`
  const expiry = expiryTime(options.expiresAt)
  const token = options.deleteToken
  const bytes = utf8Length(body)

  const main = html`<main id="main" class="main">
  <div class="wrap paste">
    <div class="paste-head">
      <div>
        <h1 class="paste-title"><span class="slug">p/</span>${options.id}</h1>
        <p class="paste-meta">
          <span>Expires ${expiry.iso
            ? html`<time datetime="${expiry.iso}" title="${expiry.iso}">${expiry.label}</time>`
            : expiry.label}</span>
          <span class="dot" aria-hidden="true">·</span>
          <span>${shortSize(bytes)}</span>
        </p>
      </div>
      <div class="paste-actions">
        ${copyButton('--copy-link', 'Copy link', 'paste-body')}
        ${copyButton('--copy-text', 'Copy text', 'paste-body')}
        <a class="button" href="${path}/raw">Open raw</a>
      </div>
    </div>
    ${token
      ? html`<section class="token" aria-labelledby="token-heading">
          <div>
            <h2 id="token-heading">Deletion token, shown once</h2>
            <code class="token-value" id="delete-token-value">${token}</code>
          </div>
          ${copyButton('--copy-token', 'Copy token', 'delete-token-value')}
          <p class="token-hint">Save it somewhere safe. It cannot be shown again after you leave this page.</p>
        </section>`
      : ''}
    ${options.error ? html`<p class="error" role="alert">${options.error}</p>` : ''}
    <div class="content">
      <div class="content-head">
        <span><span class="brand-mark" aria-hidden="true"></span>Paste text</span>
        <span class="content-size">${shortSize(bytes)}</span>
      </div>
      <pre class="paste-body" id="paste-body" tabindex="0">${body}</pre>
    </div>
    <details class="delete">
      <summary>Delete this paste</summary>
      <form method="post" action="${path}/delete">
        <label for="delete-token">Deletion token</label>
        <p class="hint" id="delete-help">Deleting removes the paste for everyone. This cannot be undone.</p>
        <input
          id="delete-token"
          name="token"
          type="text"
          required
          autocomplete="off"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          aria-describedby="delete-help"
          ${token ? html`value="${token}"` : ''}
        />
        <button class="button button--danger" type="submit">Delete permanently</button>
      </form>
    </details>
  </div>
</main>`

  return page({
    title: `p/${options.id} — Ape`,
    description: 'A paste on Ape. Anyone with the link can read it.',
    newPaste: true,
    canonicalPath: path,
    main,
  })
}

export function renderNotice(options: NoticeOptions): string | Promise<string> {
  const main = html`<main id="main" class="main notice-main">
  <div class="notice">
    <h1>${options.title}</h1>
    <p class="notice-message">${options.message}</p>
    ${options.abuseEmail
      ? html`<p class="notice-contact">
          For help with this site, email <a href="mailto:${options.abuseEmail}">${options.abuseEmail}</a>.
        </p>`
      : ''}
    <p class="notice-action"><a class="button button--primary" href="/">Create a paste</a></p>
  </div>
</main>`

  return page({
    title: `${options.title} — Ape`,
    description: `${options.title}. A pastebin for plain text.`,
    headerMeta: '64 KiB per paste',
    main,
    showFooter: !options.abuseEmail,
  })
}
