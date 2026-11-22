import { appendFileSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import { spawnSync } from 'node:child_process'

const manager = process.env.BENCHMARK_MANAGER
if (!['npm', 'bun', 'yarn', 'pnpm'].includes(manager)) {
  throw new Error('BENCHMARK_MANAGER must be npm, bun, yarn, or pnpm')
}

const lockfile = { bun: 'bun.lock', yarn: 'yarn.lock', pnpm: 'pnpm-lock.yaml' }[manager]
if (lockfile) {
  copyFileSync(new URL(`./fixtures/package-managers/${lockfile}`, import.meta.url), lockfile)
}

const cache = mkdtempSync(join(tmpdir(), `ape-${manager}-cache-`))
const args = {
  npm: ['ci', '--cache', cache],
  bun: ['install', '--frozen-lockfile', '--cache-dir', cache],
  yarn: ['install', '--immutable'],
  pnpm: ['install', '--frozen-lockfile', '--store-dir', cache],
}[manager]
const env = {
  ...process.env,
  YARN_NODE_LINKER: 'node-modules',
  YARN_ENABLE_GLOBAL_CACHE: 'false',
  YARN_CACHE_FOLDER: cache,
}

spawnSync(manager, ['--version'], { stdio: 'inherit' })

try {
  for (const state of ['cold', 'warm']) {
    rmSync('node_modules', { recursive: true, force: true })
    rmSync('.yarn/install-state.gz', { force: true })
    const start = performance.now()
    const result = spawnSync(manager, args, { stdio: 'inherit', env })
    if (result.error) throw result.error
    if (result.status !== 0) process.exit(result.status ?? 1)
    const seconds = ((performance.now() - start) / 1000).toFixed(3)
    console.log(JSON.stringify({ manager, cache: state, seconds: Number(seconds) }))
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${manager} ${state} install: **${seconds}s**\n\n`)
    }
  }
} finally {
  rmSync(cache, { recursive: true, force: true })
}
