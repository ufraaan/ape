document.documentElement.dataset.enhanced = ''

const MAX_BYTES = 64 * 1024
const field = document.querySelector('[data-body]')
const count = document.querySelector('[data-count]')
const submit = document.querySelector('[data-submit]')

function renderCount(value) {
  const bytes = new TextEncoder().encode(value).length
  const kib = (bytes / 1024).toFixed(1)
  const over = bytes > MAX_BYTES
  count.textContent = over ? `${kib} KiB of 64 KiB (over limit)` : `${kib} KiB of 64 KiB`
  count.toggleAttribute('data-over', over)
  submit.disabled = over
  if (over) field.setAttribute('aria-invalid', 'true')
  else field.removeAttribute('aria-invalid')
}

if (field && count && submit) {
  renderCount(field.value)
  field.addEventListener('input', () => renderCount(field.value))
}

const timers = new WeakMap()
let lastMessage = ''

function report(button, message, ok) {
  const tip = button.parentElement?.querySelector('[role="status"]')
  if (!tip) return
  clearTimeout(timers.get(button))
  button.removeAttribute('data-copied')
  button.removeAttribute('data-failed')
  if (message === lastMessage) message += '\u00A0'
  lastMessage = message
  tip.textContent = ''
  void button.offsetWidth
  button.setAttribute(ok ? 'data-copied' : 'data-failed', '')
  requestAnimationFrame(() => {
    tip.textContent = message
  })
  timers.set(
    button,
    setTimeout(() => {
      button.removeAttribute('data-copied')
      button.removeAttribute('data-failed')
      tip.textContent = ''
    }, 2200)
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
    text = location.origin + location.pathname
  } else if (target) {
    text = target.matches('input, textarea') ? target.value : target.textContent ?? ''
  }
  if (!text) return

  try {
    await navigator.clipboard.writeText(text)
    report(button, 'Copied', true)
  } catch {
    report(
      button,
      command === '--copy-link' ? 'Copy failed. Copy the link from the address bar.' : 'Copy failed. Select the text and copy it.',
      false
    )
    if (target && !target.matches('input, textarea')) selectText(target)
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
