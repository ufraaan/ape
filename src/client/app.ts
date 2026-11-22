import apeBanner from './ape-banner.txt'

document.documentElement.dataset.enhanced = ''

console.log(apeBanner.trimEnd())

type CopyCommandEvent = Event & {
  readonly command: string | null
  readonly source: Element | null
  readonly target: Element | null
}

const reportLink = document.querySelector<HTMLAnchorElement>('[data-report-abuse]')
if (reportLink) {
  reportLink.addEventListener('click', () => {
    const draft = new URL(reportLink.href)
    const subject = draft.searchParams.get('subject') ?? ''
    const body = draft.searchParams.get('body') ?? ''
    const updatedBody = body.replace(/^report timestamp: [^\r\n]*/m, `report timestamp: ${new Date().toISOString()}`)
    reportLink.href = `mailto:${draft.pathname}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(updatedBody)}`
  })
}

const MAX_BYTES = 64 * 1024
const field = document.querySelector<HTMLTextAreaElement>('[data-body]')
const count = document.querySelector<HTMLElement>('[data-count]')
const submit = document.querySelector<HTMLButtonElement>('[data-submit]')

function renderMeter(value: string) {
  const bytes = new TextEncoder().encode(value).length
  const size = bytes < 1024 ? `${bytes} ${bytes === 1 ? 'byte' : 'bytes'}` : `${(bytes / 1024).toFixed(1)} kib`
  const over = bytes > MAX_BYTES
  if (count) {
    count.textContent = bytes === 0 ? '64 kib max' : `${size} / 64 kib${over ? ' (over limit)' : ''}`
    count.toggleAttribute('data-over', over)
  }
  if (field) {
    if (over) field.setAttribute('aria-invalid', 'true')
    else field.removeAttribute('aria-invalid')
  }
}

if (field) {
  let queued = false
  renderMeter(field.value)
  field.addEventListener('input', () => {
    if (queued) return
    queued = true
    requestAnimationFrame(() => {
      queued = false
      renderMeter(field.value)
    })
  })

  let sending = false
  field.addEventListener('keydown', (event) => {
    if (event.defaultPrevented || event.isComposing || event.key !== 'Enter') return
    if (!(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return
    event.preventDefault()
    if (!event.repeat && !sending) field.form?.requestSubmit()
  })

  field.form?.addEventListener('submit', (event) => {
    if (sending) {
      event.preventDefault()
      return
    }
    sending = true
    if (submit) {
      submit.setAttribute('data-busy', '')
      submit.textContent = 'creating paste'
    }
  })

  window.addEventListener('pageshow', () => {
    sending = false
    if (submit) {
      submit.removeAttribute('data-busy')
      submit.textContent = 'create paste'
    }
  })
}

const timers = new WeakMap<Element, number>()
function report(button: Element, message: string) {
  const tip = button.parentElement?.querySelector('[role="status"]')
  if (!tip) return
  clearTimeout(timers.get(button))
  tip.textContent = ''
  requestAnimationFrame(() => {
    tip.textContent = message
  })
  timers.set(
    button,
    setTimeout(() => { tip.textContent = '' }, 4000)
  )
}

function selectText(target: Element) {
  const range = document.createRange()
  range.selectNodeContents(target)
  const selection = getSelection()
  if (!selection) return
  selection.removeAllRanges()
  selection.addRange(range)
}

async function copy(button: Element, target: Element | null, command: string) {
  let text = ''
  if (command === '--copy-link') {
    const canonical = document.querySelector('link[rel="canonical"]')
    const href = canonical?.getAttribute('href')
    text = href ? new URL(href, location.origin).href : location.origin + location.pathname
  } else if (target) {
    text = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
      ? target.value
      : target.textContent ?? ''
  }
  if (!text) return

  try {
    await navigator.clipboard.writeText(text)
    report(button, 'copied')
  } catch {
    if (command === '--copy-link') {
      report(button, 'copy failed. open the paste title to get its link.')
    } else {
      report(button, 'copy failed. copy the selected text.')
      if (target) selectText(target)
    }
  }
}

document.addEventListener(
  'command',
  (event) => {
    const { command, source, target } = event as CopyCommandEvent
    if (!command?.startsWith('--copy') || !source) return
    copy(source, target, command)
  },
  true
)

if (!('CommandEvent' in window)) {
  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Element)) return
    const button = event.target.closest('button[command^="--copy"]')
    if (!button) return
    const commandFor = button.getAttribute('commandfor')
    const target = commandFor ? document.getElementById(commandFor) : null
    copy(button, target, button.getAttribute('command') ?? '')
  })
}
