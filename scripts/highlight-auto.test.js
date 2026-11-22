import test from 'node:test'
import assert from 'node:assert/strict'
import { detectLanguage, highlight } from './highlight-auto.js'

const python = `import json
from pathlib import Path


def load(path: Path) -> dict:
    # read the config
    with path.open() as handle:
        data = json.load(handle)
    total = sum(item["count"] for item in data["items"])
    print(f"loaded {len(data['items'])} items, total {total}")
    if total > 100:
        print("<script>alert('nope')</script>")
    return data
`

const javascript = `const cache = new Map()
export async function get(key) {
  if (cache.has(key)) return cache.get(key)
  const value = await fetch('/api/' + key).then((response) => response.json())
  cache.set(key, value)
  return value
}
`

const typescript = `interface User { id: number; name: string }
export function greet(user: User): string {
  return \`hello \${user.name}\`
}
`

const html = `<!doctype html>
<html>
  <body>
    <h1 class="title">Hello</h1>
    <script>console.log('hi')</script>
  </body>
</html>
`

const css = `.card { display: flex; gap: 0.5rem; color: #333; }
@media (min-width: 40em) { .card { padding: 1rem; } }
`

const json = `{
  "name": "ape",
  "scripts": {
    "dev": "wrangler dev",
    "build": "wrangler deploy --dry-run --outdir dist"
  },
  "dependencies": {
    "hono": "^4.13.20"
  }
}
`

const bash = `#!/bin/bash
set -euo pipefail
for file in *.txt; do
  echo "processing $file"
  wc -l "$file"
done
`

const sql = `SELECT id, body, created_at FROM pastes
WHERE expires_at > ? AND body LIKE '%todo%'
ORDER BY created_at DESC
LIMIT 20;
`

const go = `package main

import (
\t"fmt"
\t"os"
)

func main() {
\tif len(os.Args) < 2 {
\t\tfmt.Println("usage: greet <name>")
\t\tos.Exit(1)
\t}
\tname := os.Args[1]
\tfmt.Printf("hello, %s!\\n", name)
}
`

const rust = `use std::collections::HashMap;

fn main() {
    let mut counts = HashMap::new();
    for word in "a b a".split_whitespace() {
        *counts.entry(word).or_insert(0) += 1;
    }
    println!("{:?}", counts);
}
`

test('detects supported languages', () => {
  const cases = { python, javascript, typescript, xml: html, css, json, bash, sql, go, rust }
  for (const [language, code] of Object.entries(cases)) {
    assert.equal(detectLanguage(code), language, language)
  }
})

test('leaves prose and short snippets plain', () => {
  assert.equal(
    detectLanguage('Please review the draft before Friday. The meeting notes and budget numbers are attached, and Sam will send the invoice tomorrow.'),
    null,
  )
  assert.equal(detectLanguage('const x = [1, 2, 3].map((n) => n * 2)'), null)
  assert.equal(detectLanguage('hello world'), null)
})

test('leaves unsupported or ambiguous documents plain', () => {
  assert.equal(
    detectLanguage('name = "ape"\nmain = "src/index.ts"\n\n[build]\ncommand = "node scripts/build.mjs"'),
    null,
  )
})

test('escapes pasted markup in highlighted output', () => {
  const rendered = highlight(python)
  assert.equal(rendered?.language, 'python')
  assert.ok(rendered.value.includes('&lt;script&gt;'))
  assert.ok(!rendered.value.includes('<script>'))
})
