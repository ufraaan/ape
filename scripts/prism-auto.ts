import Prism from 'prismjs/components/prism-core.js'
import 'prismjs/components/prism-markup.js'
import 'prismjs/components/prism-css.js'
import 'prismjs/components/prism-clike.js'
import 'prismjs/components/prism-javascript.js'
import 'prismjs/components/prism-c.js'
import 'prismjs/components/prism-cpp.js'
import 'prismjs/components/prism-java.js'
import 'prismjs/components/prism-typescript.js'
import 'prismjs/components/prism-jsx.js'
import 'prismjs/components/prism-tsx.js'
import 'prismjs/components/prism-json.js'
import 'prismjs/components/prism-bash.js'
import 'prismjs/components/prism-python.js'
import 'prismjs/components/prism-go.js'
import 'prismjs/components/prism-rust.js'
import 'prismjs/components/prism-sql.js'
import 'prismjs/components/prism-yaml.js'
import 'prismjs/components/prism-diff.js'
import 'prismjs/components/prism-markdown.js'

const SAMPLE_LIMIT = 4000

const HTML_TAG =
  /(^|\n)\s*<(?:!doctype|html|head|body|main|section|article|header|footer|nav|ul|ol|li|table|tr|td|th|form|input|button|script|style|h[1-6]|p|a|span|pre|code|blockquote|img|meta|link|title)\b[^>\n]*>/i

const CSS_RULE =
  /(^|\n)\s*(?:[.#][\w-]+(?:\s*[ >+~]\s*[.#\w-]+)?|[a-z][\w-]*)\s*(?:,\s*[^{}\n]+)?\{[^{}\n]*:[^{}\n]*\}/

const JSX_TAG = /<[A-Z][\w.]*[\s/>]/

const TS_SYNTAX =
  /\b(?:interface|type|enum)\s+\w+|\bimplements\b|:\s*(?:string|number|boolean|void|unknown|any)\b|\bas\s+(?:const|string|number)\b/

const JS_SYNTAX = /\b(?:const|let|var|function|class|import|export|async|await)\b|=>/

const SQL_STATEMENT = /\b(?:SELECT|INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|CREATE\s+(?:TABLE|INDEX)|ALTER\s+TABLE)\b/i
const SQL_CLAUSE = /\b(?:FROM|WHERE|VALUES|SET|JOIN|GROUP\s+BY|ORDER\s+BY)\b/i

const MARKDOWN_SIGNALS = [
  /(^|\n)#{1,6}\s+\S/,
  /(^|\n)\s*[-*+]\s+\S/,
  /(^|\n)\s*\d+\.\s+\S/,
  /\[[^\]]+\]\([^)]+\)/,
  /(^|\n)\s*```/,
  /\*\*[^*\n]+\*\*/,
]

function isJson(code: string): boolean {
  try {
    JSON.parse(code)
    return true
  } catch {
    return false
  }
}

function yamlKeyLines(sample: string): number {
  return sample
    .split('\n')
    .filter((line) => /^\s*(?:-\s+)?[A-Za-z_][\w.-]*:(?:\s|$)/.test(line))
    .length
}

// regex signatures keep untagged pastes predictable; Prism's tokenizer has no
// auto-detection and scoring every grammar misfires on prose and config files
export function detectLanguage(code: string): string | null {
  const sample = code.slice(0, SAMPLE_LIMIT)
  const trimmed = sample.trim()
  if (trimmed.length < 40) return null

  if ((trimmed.startsWith('{') || trimmed.startsWith('[')) && isJson(trimmed)) return 'json'

  if (/(^|\n)@@ -\d/.test(sample) || /(^|\n)--- [^\n]+\n\+\+\+ [^\n]+\n/.test(sample)) return 'diff'

  if (/<!doctype html/i.test(sample) || HTML_TAG.test(sample)) return 'markup'

  if (CSS_RULE.test(sample)) return 'css'

  if (yamlKeyLines(sample) >= 2) return 'yaml'

  if (
    /^#!\s*\/(?:usr\/)?bin\/(?:env\s+)?(?:ba|z|k)?sh\b/m.test(sample) ||
    /(^|\n)\s*(?:if|for|while)\b[^\n]*;\s*then\b/.test(sample) ||
    /(^|\n)\s*(?:fi|done|esac)\s*$/m.test(sample)
  ) {
    return 'bash'
  }

  if (
    /(^|\n)\s*(?:def|class)\s+[A-Za-z_]\w*[^\n]*:\s*(?:#.*)?$/m.test(sample) ||
    /(^|\n)\s*(?:from\s+[\w.]+\s+import\s+|import\s+[A-Za-z_][\w.]*\s*$)/m.test(sample) ||
    /if\s+__name__\s*==/.test(sample)
  ) {
    return 'python'
  }

  if (/\bfn\s+[A-Za-z_]\w*\s*[(<]/.test(sample) && /\blet\s+mut\b|\bprintln!|\buse\s+[\w:]+|->/.test(sample)) return 'rust'

  if (
    /(^|\n)\s*package\s+[A-Za-z_]\w*/m.test(sample) ||
    (/\bfunc\s+(?:\([^)]*\)\s*)?[A-Za-z_]\w*\s*\(/.test(sample) && /:=|\bfmt\.|\bgo\s+func\b/.test(sample))
  ) {
    return 'go'
  }

  if (
    /\b(?:public|protected|private)\s+(?:static\s+)?(?:final\s+)?(?:abstract\s+)?(?:class|interface|enum)\s+\w+/.test(sample) ||
    /\bSystem\.(?:out|err)\.print/.test(sample) ||
    /\bpublic\s+static\s+void\s+main\s*\(/.test(sample)
  ) {
    return 'java'
  }

  if (
    /(^|\n)\s*#\s*(?:include|define|pragma)\b/.test(sample) ||
    /\b(?:int|void|char|float|double|long|short|unsigned)\s+\**\w+\s*\([^;{}]*\)\s*\{/.test(sample)
  ) {
    return /\b(?:std|cout|cin|cerr|endl)\b|::|template\s*<|using\s+namespace/.test(sample) ? 'cpp' : 'c'
  }

  if (JSX_TAG.test(sample)) {
    if (TS_SYNTAX.test(sample)) return 'tsx'
    if (JS_SYNTAX.test(sample)) return 'jsx'
  }

  if (TS_SYNTAX.test(sample)) return 'typescript'
  if (JS_SYNTAX.test(sample) && /[{}=;()[\]<>]/.test(sample)) return 'javascript'

  if (SQL_STATEMENT.test(sample) && SQL_CLAUSE.test(sample)) return 'sql'

  if (MARKDOWN_SIGNALS.filter((signal) => signal.test(sample)).length >= 2) return 'markdown'

  return null
}

export function highlight(code: string): { language: string; value: string } | null {
  const language = detectLanguage(code)
  if (!language) return null
  return { language, value: Prism.highlight(code, Prism.languages[language], language) }
}
