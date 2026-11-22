import { highlight } from './prism-auto.ts'

const block = document.querySelector<HTMLElement>('[data-highlight]')
if (block) {
  const rendered = highlight(block.textContent ?? '')
  if (rendered) {
    block.innerHTML = rendered.value
    block.dataset.highlighted = rendered.language
  }
}
