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
  outfile: fileURLToPath(new URL('../public/vendor/prism.js', import.meta.url)),
  banner: {
    js: '/*! PrismJS v1.30.0 | MIT | Copyright (c) 2012-2025 Lea Verou and contributors */',
  },
})

await build({
  ...options,
  minify: false,
  loader: { '.txt': 'text' },
  entryPoints: [fileURLToPath(new URL('../src/client/app.ts', import.meta.url))],
  outfile: fileURLToPath(new URL('../public/app.js', import.meta.url)),
})
