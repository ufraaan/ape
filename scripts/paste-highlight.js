import { highlight } from './highlight-auto.js'

const block = document.querySelector('[data-highlight]')
if (block) {
  const rendered = highlight(block.textContent ?? '')
  if (rendered) {
    block.innerHTML = rendered.value
    block.dataset.highlighted = rendered.language
  }
}
