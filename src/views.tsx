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
const encoder = new TextEncoder()

function sizeLabel(bytes: number): string {
  if (bytes === 0) return '64 KiB max'
  const size = bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(1)} KiB`
  return bytes > MAX_BYTES ? `${size} / 64 KiB (over limit)` : `${size} / 64 KiB`
}

function expiryTime(expiresAt: number): Markup {
  const date = new Date(expiresAt * 1000)
  const remaining = expiresAt - Date.now() / 1000
  const [amount, unit] = remaining >= 86400
    ? [Math.ceil(remaining / 86400), 'day']
    : remaining >= 3600
      ? [Math.ceil(remaining / 3600), 'hour']
      : [Math.max(1, Math.ceil(remaining / 60)), 'minute']

  return html`Expires in <time datetime="${date.toISOString()}">${amount} ${unit}${amount === 1 ? '' : 's'}</time>`
}

function copyButton(command: string, label: string, targetId: string): Markup {
  return html`<span class="copy">
    <button class="button" type="button" command="${command}" commandfor="${targetId}">${label}</button>
    <span class="tip" role="status"></span>
  </span>`
}

function page(options: {
  title: string
  main: Markup
  turnstileSiteKey?: string
  canonicalPath?: string
}): Markup {
  return html`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="theme-color" content="#fafafa" />
    <title>${options.title}</title>
    ${options.canonicalPath ? html`<link rel="canonical" href="${options.canonicalPath}" />` : ''}
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="stylesheet" href="/app.css" />
    <script src="/app.js" defer></script>
    ${options.turnstileSiteKey
      ? html`<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>`
      : ''}
  </head>
  <body>
    <a class="skip" href="#main">Skip to content</a>
    <header class="wrap masthead">
      <a class="brand" href="/">Ape</a>
      ${options.canonicalPath ? html`<a class="quiet-link" href="/">New paste</a>` : ''}
    </header>
    ${options.main}
    <footer class="wrap footer"><a class="quiet-link" href="/abuse">Report abuse</a></footer>
  </body>
</html>`
}

export function renderCompose(options: ComposeOptions = {}): string | Promise<string> {
  const body = options.body ?? ''
  const ttl = options.ttl === '1h' || options.ttl === '7d' ? options.ttl : '1d'
  const bytes = encoder.encode(body).length

  return page({
    title: 'New paste · Ape',
    turnstileSiteKey: options.turnstileSiteKey,
    main: html`<main id="main" class="wrap main">
      <h1>New paste</h1>
      <p class="subhead" id="visibility">Anyone with the link can read it.</p>
      <form method="post" action="/pastes">
        ${options.error ? html`<p id="paste-error" class="error" role="alert">${options.error}</p>` : ''}
        <div class="editor">
          <label class="visually-hidden" for="body">Paste text</label>
          <textarea id="body" name="body" data-body required spellcheck="false"
            aria-describedby="visibility byte-count${options.error ? ' paste-error' : ''}"
            ${bytes > MAX_BYTES ? html`aria-invalid="true"` : ''}
            placeholder="Paste or type here"
          >
${body}</textarea>
          <div class="editor-meta">
            <span id="byte-count" data-count ${bytes > MAX_BYTES ? html`data-over` : ''}>${sizeLabel(bytes)}</span>
          </div>
        </div>
        ${options.turnstileSiteKey
          ? html`<div class="turnstile">
              <div class="cf-turnstile" data-sitekey="${options.turnstileSiteKey}" data-theme="light" data-size="flexible"></div>
            </div>`
          : ''}
        <div class="form-actions">
          <div class="expiry">
            <label for="ttl">Expires</label>
            <select id="ttl" name="ttl">${TTL_OPTIONS.map(([value, label]) =>
              currentOption(value, label, ttl)
            )}</select>
          </div>
          <button class="button primary" type="submit" data-submit>Create paste</button>
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
  const path = `/p/${encodeURIComponent(options.id)}`
  const token = options.deleteToken

  return page({
    title: 'Paste · Ape',
    canonicalPath: path,
    main: html`<main id="main" class="wrap main">
      <div class="paste-head">
        <div>
          <h1><a class="paste-title" href="${path}">${token ? 'Paste created' : 'Paste'}</a></h1>
          <p class="subhead">${expiryTime(options.expiresAt)}</p>
        </div>
        <div class="paste-actions">
          ${copyButton('--copy-link', 'Copy link', 'paste-body')}
          ${copyButton('--copy-text', 'Copy text', 'paste-body')}
          <a class="button" href="${path}/raw">Raw</a>
        </div>
      </div>
      ${token
        ? html`<section class="token" aria-labelledby="token-title">
            <div>
              <h2 id="token-title">Deletion token</h2>
              <p class="muted">Save this token to delete the paste later. It is shown once.</p>
            </div>
            <div class="token-row">
              <code id="delete-token-value">${token}</code>
              ${copyButton('--copy-token', 'Copy token', 'delete-token-value')}
            </div>
          </section>`
        : ''}
      ${options.error ? html`<p class="error" role="alert">${options.error}</p>` : ''}
      <pre class="paste-body" id="paste-body" tabindex="0" aria-label="Paste text"><code>${options.body}</code></pre>
      <details class="delete">
        <summary>Delete paste</summary>
        <form method="post" action="${path}/delete">
          <label for="delete-token">Deletion token</label>
          <input id="delete-token" name="token" type="text" required
            autocomplete="off" autocapitalize="none" spellcheck="false"
            aria-describedby="delete-help" ${token ? html`value="${token}"` : ''} />
          <p class="muted" id="delete-help">This permanently removes the paste for everyone.</p>
          <button class="button danger" type="submit">Delete permanently</button>
        </form>
      </details>
    </main>`,
  })
}

export function renderNotice(options: NoticeOptions): string | Promise<string> {
  return page({
    title: `${options.title} · Ape`,
    main: html`<main id="main" class="wrap main notice">
      <h1>${options.title}</h1>
      <p class="subhead">${options.message}</p>
      ${options.abuseEmail ? html`<p><a href="mailto:${options.abuseEmail}">${options.abuseEmail}</a></p>` : ''}
      <a class="button" href="/">New paste</a>
    </main>`,
  })
}
