import { DurableObject } from 'cloudflare:workers'

const ID_LENGTH = 6
const BASE62 = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
// 248 is the largest multiple of 62 below 256, so rejection keeps the mapping uniform
const BASE62_LIMIT = 248
const RESERVED_IDS = new Set(['pastes'])
const INSERT_ATTEMPTS = 5

export interface Paste {
  id: string
  body: string
  expiresAt: number
}

interface PasteRow extends Record<string, SqlStorageValue> {
  id: string
  body: string
  expires_at: number
}

function randomId(): string {
  for (;;) {
    let id = ''
    while (id.length < ID_LENGTH) {
      const bytes = crypto.getRandomValues(new Uint8Array(ID_LENGTH - id.length))
      for (const byte of bytes) {
        if (byte >= BASE62_LIMIT) continue
        id += BASE62[byte % 62]
        if (id.length === ID_LENGTH) break
      }
    }
    if (!RESERVED_IDS.has(id)) return id
  }
}

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000)
}

// shortcut: one instance serialises every write and holds the whole store within the 1 GB per-object limit; shard by id hashing across several objects if writes or size approach either ceiling
export class PasteStore extends DurableObject {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env)
    ctx.blockConcurrencyWhile(async () => {
      ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS pastes (
        id TEXT PRIMARY KEY NOT NULL,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      )`)
      ctx.storage.sql.exec('CREATE INDEX IF NOT EXISTS idx_pastes_expires_at ON pastes (expires_at)')
    })
  }

  async create(body: string, ttlSeconds: number): Promise<Paste> {
    if (!Number.isFinite(ttlSeconds) || ttlSeconds <= 0) {
      throw new RangeError('ttlSeconds must be a positive number')
    }
    const createdAt = nowSeconds()
    const expiresAt = createdAt + Math.ceil(ttlSeconds)
    for (let attempt = 0; attempt < INSERT_ATTEMPTS; attempt++) {
      const id = randomId()
      const inserted = this.ctx.storage.sql
        .exec(
          'INSERT INTO pastes (id, body, created_at, expires_at) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO NOTHING RETURNING id',
          id,
          body,
          createdAt,
          expiresAt,
        )
        .toArray()
      if (inserted.length > 0) {
        const alarm = await this.ctx.storage.getAlarm()
        if (alarm === null || alarm > expiresAt * 1000) {
          await this.ctx.storage.setAlarm(expiresAt * 1000)
        }
        return { id, body, expiresAt }
      }
    }

    throw new Error('could not allocate a unique paste id')
  }

  async get(id: string): Promise<Paste | null> {
    const [row] = this.ctx.storage.sql
      .exec<PasteRow>(
        'SELECT id, body, expires_at FROM pastes WHERE id = ? AND expires_at > ?',
        id,
        nowSeconds(),
      )
      .toArray()
    if (!row) return null
    return { id: row.id, body: row.body, expiresAt: row.expires_at }
  }

  async alarm(): Promise<void> {
    this.ctx.storage.sql.exec('DELETE FROM pastes WHERE expires_at <= ?', nowSeconds())
    const [next] = this.ctx.storage.sql
      .exec<Record<'expires_at', number>>('SELECT expires_at FROM pastes ORDER BY expires_at LIMIT 1')
      .toArray()
    if (next) await this.ctx.storage.setAlarm(next.expires_at * 1000)
  }
}
