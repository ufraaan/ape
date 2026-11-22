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
  main: Markup
  showNewPaste?: boolean
  turnstileSiteKey?: string
  showFooter?: boolean
  canonicalPath?: string
}): Markup {
  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="color-scheme" content="light" />
    <meta name="theme-color" content="#f8f5ef" />
    <title>${options.title}</title>
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
    <a class="skip" href="#main">Skip to content</a>
    <header class="site-header">
      <div class="shell">
        <a class="brand" href="/"
          ><span class="mark" aria-hidden="true"></span><span class="brand-name">ape</span></a
        >
        ${options.showNewPaste
          ? html`<a class="header-link" href="/">New paste</a>`
          : html`<span class="header-note">64 KiB per paste</span>`}
      </div>
    </header>
    ${options.main}
    ${options.showFooter === false
      ? ''
      : html`<footer class="site-footer">
          <div class="shell">
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

  const main = html`<main id="main" class="site-main compose">
  <div class="shell">
    <div class="intro">
      <h1 id="compose-title">New paste</h1>
      <p class="note"><strong>Anyone with the link can read this paste.</strong> There is no account or password, so treat the link like a postcard.</p>
    </div>
    ${options.error ? html`<p class="error" role="alert">${options.error}</p>` : ''}
    <form class="composer" method="post" action="/pastes" aria-labelledby="compose-title">
      <div class="editor">
        <label class="visually-hidden" for="body">Paste content</label>
        <textarea
          id="body"
          name="body"
          data-body
          required
          aria-describedby="byte-count"
          ${count > MAX_BYTES ? html`aria-invalid="true"` : ''}
          placeholder="Type or paste text here"
        >${body}</textarea>
        <div class="editor-bar">
          <output
            id="byte-count"
            class="count"
            data-count
            for="body"
            ${count > MAX_BYTES ? html`data-over` : ''}
            >${sizeLabel(count)}</output
          >
          <div class="bar-end">
            <div class="field-inline">
              <label class="inline-label" for="ttl">Expires</label>
              <select class="select" id="ttl" name="ttl">${ttlOptions(ttl)}</select>
            </div>
            <button class="button button--primary" type="submit" data-submit>Create paste</button>
          </div>
        </div>
      </div>
      ${options.turnstileSiteKey
        ? html`<div class="turnstile-slot">
            <div class="cf-turnstile" data-sitekey="${options.turnstileSiteKey}" data-theme="light"></div>
          </div>`
        : ''}
    </form>
  </div>
</main>`

  return page({
    title: 'New paste — Ape',
    main,
    turnstileSiteKey: options.turnstileSiteKey,
  })
}

export function renderPaste(options: PasteOptions): string | Promise<string> {
  const body = options.body ?? ''
  const path = `/p/${encodeURIComponent(options.id)}`
  const expiry = expiryTime(options.expiresAt)
  const token = options.deleteToken

  const main = html`<main id="main" class="site-main">
  <div class="shell">
    <div class="paste-head">
      <div>
        <h1 class="paste-title"><span class="slug">p/</span>${options.id}</h1>
        <p class="paste-meta">Expires ${expiry.iso
          ? html`<time datetime="${expiry.iso}" title="${expiry.iso}">${expiry.label}</time>`
          : expiry.label}</p>
      </div>
      <div class="paste-actions">
        ${copyButton('--copy-link', 'Copy link', 'paste-body')}
        ${copyButton('--copy-text', 'Copy text', 'paste-body')}
        <a class="button" href="${path}/raw">Raw</a>
      </div>
    </div>
    ${token
      ? html`<section class="token" aria-labelledby="token-heading">
          <div>
            <h2 class="token-heading" id="token-heading">Deletion token, shown once</h2>
            <code class="token-value" id="delete-token-value">${token}</code>
          </div>
          ${copyButton('--copy-token', 'Copy token', 'delete-token-value')}
          <p class="token-hint">Save it somewhere safe. It cannot be shown again after you leave this page.</p>
        </section>`
      : ''}
    ${options.error ? html`<p class="error" role="alert">${options.error}</p>` : ''}
    <pre class="paste-body" id="paste-body" tabindex="0">${body}</pre>
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
    main,
    showNewPaste: true,
    canonicalPath: path,
  })
}

export function renderNotice(options: NoticeOptions): string | Promise<string> {
  const main = html`<main id="main" class="notice">
  <h1>${options.title}</h1>
  <p class="notice-message">${options.message}</p>
  ${options.abuseEmail
    ? html`<p class="notice-contact">
        For help with this site, email <a href="mailto:${options.abuseEmail}">${options.abuseEmail}</a>.
      </p>`
    : ''}
  <p class="notice-action"><a class="button" href="/">New paste</a></p>
</main>`

  return page({
    title: `${options.title} — Ape`,
    main,
    showNewPaste: true,
    showFooter: !options.abuseEmail,
  })
}
