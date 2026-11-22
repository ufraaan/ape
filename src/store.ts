/// <reference lib="dom" />

const ID_BYTES = 16
const PURGE_BATCH_SIZE = 50
const INSERT_ATTEMPTS = 5

export interface PasteStatement {
  bind(...values: unknown[]): PasteStatement
  first<T = unknown>(): Promise<T | null>
  run(): Promise<{ meta: { changes: number } }>
  all<T = unknown>(): Promise<{ results: T[] }>
}

export interface PasteDatabase {
  prepare(query: string): PasteStatement
}

export interface Paste {
  id: string
  body: string
  expiresAt: number
}

interface PasteRow {
  id: string
  body: string
  expires_at: number
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function randomBase64Url(size: number): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(size)))
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

export async function createPaste(
  db: PasteDatabase,
  body: string,
  ttlSeconds: number,
): Promise<Paste> {
  if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
    throw new RangeError('ttlSeconds must be a positive number')
  }
  const createdAt = nowSeconds()
  const expiresAt = createdAt + Math.ceil(ttlSeconds)
  for (let attempt = 0; attempt < INSERT_ATTEMPTS; attempt++) {
    const id = randomBase64Url(ID_BYTES)
    const result = await db
      .prepare(
        'INSERT INTO pastes (id, body, created_at, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING',
      )
      .bind(id, body, createdAt, expiresAt)
      .run()
    if (result.meta.changes > 0) {
      return { id, body, expiresAt }
    }
  }

  throw new Error('could not allocate a unique paste id')
}

export async function getPaste(db: PasteDatabase, id: string): Promise<Paste | null> {
  const row = await db
    .prepare('SELECT id, body, expires_at FROM pastes WHERE id = ? AND expires_at > ?')
    .bind(id, nowSeconds())
    .first<PasteRow>()
  if (!row) return null
  return { id: row.id, body: row.body, expiresAt: row.expires_at }
}

export async function purgeExpired(db: PasteDatabase): Promise<void> {
  const now = nowSeconds()
  for (;;) {
    const { results } = await db
      .prepare('SELECT id FROM pastes WHERE expires_at <= ? LIMIT ?')
      .bind(now, PURGE_BATCH_SIZE)
      .all<{ id: string }>()
    if (results.length === 0) return

    const placeholders = results.map(() => '?').join(', ')
    await db
      .prepare(`DELETE FROM pastes WHERE id IN (${placeholders})`)
      .bind(...results.map((row) => row.id))
      .run()

    if (results.length < PURGE_BATCH_SIZE) return
  }
}
