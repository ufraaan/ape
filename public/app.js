document.documentElement.dataset.enhanced = ''

const reportLink = document.querySelector('[data-report-abuse]')
reportLink?.addEventListener('click', () => {
  const draft = new URL(reportLink.href)
  const subject = draft.searchParams.get('subject') ?? ''
  const body = draft.searchParams.get('body') ?? ''
  const updatedBody = body.replace(/^report timestamp: [^\r\n]*/m, `report timestamp: ${new Date().toISOString()}`)
  reportLink.href = `mailto:${draft.pathname}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(updatedBody)}`
})

const MAX_BYTES = 64 * 1024
const field = document.querySelector('[data-body]')
const count = document.querySelector('[data-count]')
const submit = document.querySelector('[data-submit]')

function renderMeter(value) {
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

const timers = new WeakMap()
function report(button, message) {
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

function selectText(target) {
  const range = document.createRange()
  range.selectNodeContents(target)
  const selection = getSelection()
  if (!selection) return
  selection.removeAllRanges()
  selection.addRange(range)
}

async function copy(button, target, command) {
  let text = ''
  if (command === '--copy-link') {
    const canonical = document.querySelector('link[rel="canonical"]')
    const href = canonical?.getAttribute('href')
    text = href ? new URL(href, location.origin).href : location.origin + location.pathname
  } else if (target) {
    text = target.matches('input, textarea') ? target.value : target.textContent ?? ''
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
      selectText(target)
    }
  }
}

document.addEventListener(
  'command',
  (event) => {
    if (!event.command?.startsWith('--copy')) return
    copy(event.source, event.target, event.command)
  },
  true
)

if (!('CommandEvent' in window)) {
  document.addEventListener('click', (event) => {
    const button = event.target.closest('button[command^="--copy"]')
    if (!button) return
    const target = document.getElementById(button.getAttribute('commandfor'))
    copy(button, target, button.getAttribute('command'))
  })
}
