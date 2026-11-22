import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'

const languages = { bash, css, go, javascript, json, python, rust, sql, typescript, xml }
for (const name of Object.keys(languages)) hljs.registerLanguage(name, languages[name])

const SAMPLE_LIMIT = 4000
const MIN_RELEVANCE = 7
const SIMILAR = new Set(['javascript', 'typescript'])
const CODE_PUNCTUATION = /[{}[\]();=<>$#]/g

export function detectLanguage(code) {
  const sample = code.slice(0, SAMPLE_LIMIT)
  const trimmed = sample.trim()
  if (trimmed.length < 40) return null

  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && sample.length === code.length) {
    try {
      JSON.parse(trimmed)
      return 'json'
    } catch {}
  }

  if ((sample.match(CODE_PUNCTUATION) ?? []).length < 2) return null

  // bounded auto-detection stays conservative so prose and ambiguous snippets remain plain
  const result = hljs.highlightAuto(sample, Object.keys(languages))
  if (!result.language || result.relevance < MIN_RELEVANCE) return null
  const runnerUp = result.secondBest
  if (runnerUp && result.relevance - runnerUp.relevance < 1) {
    if (!SIMILAR.has(result.language) || !SIMILAR.has(runnerUp.language)) return null
  }
  return result.language
}

export function highlight(code) {
  const language = detectLanguage(code)
  if (!language) return null
  return { language, value: hljs.highlight(code, { language, ignoreIllegals: true }).value }
}
