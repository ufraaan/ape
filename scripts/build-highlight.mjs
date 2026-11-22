import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

await build({
  entryPoints: [fileURLToPath(new URL('paste-highlight.js', import.meta.url))],
  outfile: fileURLToPath(new URL('../public/vendor/highlight.js', import.meta.url)),
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  legalComments: 'none',
  banner: {
    js: '/*! highlight.js v11.12.0 | BSD-3-Clause | Copyright (c) 2006, Ivan Sagalaev */',
  },
})
