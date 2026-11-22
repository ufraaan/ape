import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const options = {
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  legalComments: 'none',
} as const

await build({
  ...options,
  entryPoints: [fileURLToPath(new URL('paste-highlight.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../public/vendor/highlight.js', import.meta.url)),
  banner: {
    js: '/*! highlight.js v11.12.0 | BSD-3-Clause | Copyright (c) 2006, Ivan Sagalaev */',
  },
})

await build({
  ...options,
  minify: false,
  entryPoints: [fileURLToPath(new URL('../src/client/app.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../public/app.js', import.meta.url)),
})
