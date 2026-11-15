import { createHash } from 'node:crypto'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  CODE_ALPHABET,
  createControllerToken,
  createPublicCode,
  handleClose,
  handleCreate,
  handleUpdate,
  hashToken,
} from './live.ts'
import type { AdminClient } from './live.ts'

/*
 * Unit tests for the Live Scoreboard Edge Functions, using a small in-memory
 * stand-in for the supabase-js query builder.
 */

type Row = Record<string, unknown>
type Result = { data: unknown; error: { code?: string; message: string } | null }

class FakeDb implements AdminClient {
  tables: Record<string, Row[]> = { live_scoreboard_sessions: [], live_scoreboard_controller_tokens: [] }
  /** Force the next N session inserts to fail with this error. */
  failSessionInserts: { code?: string; message: string }[] = []
  failTokenInsert: { message: string } | null = null
  private nextId = 1

  from(table: string) {
    const db = this
    let op: 'select' | 'insert' | 'update' | 'delete' = 'select'
    let payload: Row = {}
    const filters: [string, unknown][] = []

    const matches = () => db.tables[table].filter((row) => filters.every(([k, v]) => row[k] === v))

    const run = (mode: 'many' | 'single' | 'maybe'): Result => {
      if (op === 'insert') {
        if (table === 'live_scoreboard_sessions' && db.failSessionInserts.length) {
          return { data: null, error: db.failSessionInserts.shift()! }
        }
        if (table === 'live_scoreboard_controller_tokens' && db.failTokenInsert) {
          return { data: null, error: db.failTokenInsert }
        }
        if (table === 'live_scoreboard_sessions' && db.tables[table].some((r) => r.public_code === payload.public_code)) {
          return { data: null, error: { code: '23505', message: 'duplicate key' } }
        }
        const row = { id: `id-${db.nextId++}`, created_at: '2026-11-15T00:00:00.000Z', closed_at: null, ...payload }
        db.tables[table].push(row)
        return { data: mode === 'many' ? [row] : row, error: null }
      }
      if (op === 'update') {
        const rows = matches()
        rows.forEach((row) => Object.assign(row, payload))
        return { data: mode === 'many' ? rows : rows[0] ?? null, error: null }
      }
      if (op === 'delete') {
        db.tables[table] = db.tables[table].filter((row) => !matches().includes(row))
        return { data: null, error: null }
      }
      const rows = matches()
      if (mode === 'many') return { data: rows, error: null }
      return { data: rows[0] ?? null, error: null }
    }

    const builder = {
      select: () => builder,
      insert: (row: Row) => { op = 'insert'; payload = row; return builder },
      update: (patch: Row) => { op = 'update'; payload = patch; return builder },
      delete: () => { op = 'delete'; return builder },
      eq: (column: string, value: unknown) => { filters.push([column, value]); return builder },
      single: async () => run('single'),
      maybeSingle: async () => run('maybe'),
      then: (resolve: (r: Result) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(run('many')).then(resolve, reject),
    }
    return builder
  }

  session(code: string) {
    return this.tables.live_scoreboard_sessions.find((r) => r.public_code === code)!
  }
}

const NOW = new Date('2026-11-15T08:00:00.000Z')
const HOUR = 60 * 60 * 1000

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://project.supabase.co/functions/v1/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

let db: FakeDb
let now: Date
const deps = () => ({ getClient: () => db, now: () => now })

async function create(state: unknown = { screen: 'server' }, origin = 'https://tennis.onrender.com') {
  const res = await handleCreate(post({ scoreboardState: state, origin }), deps())
  return { res, body: await res.json() }
}

beforeEach(() => {
  db = new FakeDb()
  now = new Date(NOW)
})

describe('tokens and codes', () => {
  it('hashes exactly like the previous Node version, so links created on Netlify keep working', async () => {
    for (const token of ['abc', createControllerToken(), 'ünïcødé-token']) {
      expect(await hashToken(token)).toBe(createHash('sha256').update(token).digest('hex'))
    }
  })

  it('creates 43-character base64url controller tokens, different every time', () => {
    const tokens = new Set(Array.from({ length: 200 }, createControllerToken))
    expect(tokens.size).toBe(200)
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/)
  })

  it('creates 7-character match codes from the easy-to-read alphabet (no 0/O/1/I)', () => {
    for (let i = 0; i < 200; i += 1) {
      const code = createPublicCode()
      expect(code).toHaveLength(7)
      for (const ch of code) expect(CODE_ALPHABET).toContain(ch)
    }
    expect(CODE_ALPHABET).not.toMatch(/[01OI]/)
  })
})

describe('HTTP behaviour (all endpoints)', () => {
  it.each([['create', handleCreate], ['update', handleUpdate], ['close', handleClose]] as const)(
    '%s answers the CORS preflight so the app on another domain can call it',
    async (_name, handler) => {
      const res = await handler(new Request('https://x/f', { method: 'OPTIONS' }), deps())
      expect(res.status).toBe(204)
      expect(res.headers.get('access-control-allow-origin')).toBe('*')
      expect(res.headers.get('access-control-allow-headers')).toContain('content-type')
      expect(res.headers.get('access-control-allow-headers')).toContain('apikey')
    },
  )

  it.each([['create', handleCreate], ['update', handleUpdate], ['close', handleClose]] as const)(
    '%s rejects non-POST requests',
    async (_name, handler) => {
      const res = await handler(new Request('https://x/f', { method: 'GET' }), deps())
      expect(res.status).toBe(405)
    },
  )

  it('JSON responses carry CORS and no-store headers', async () => {
    const { res } = await create()
    expect(res.headers.get('access-control-allow-origin')).toBe('*')
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(res.headers.get('content-type')).toContain('application/json')
  })
})

describe('live-scoreboard-create', () => {
  it('creates a waiting session that expires in 24 hours and returns the controller credentials', async () => {
    const { res, body } = await create({ screen: 'server', games: '0-0' })
    expect(res.status).toBe(200)
    expect(body.scoreboardUrl).toBe(`https://tennis.onrender.com/scoreboard/${body.publicCode}`)
    expect(body.expiresAt).toBe(new Date(NOW.getTime() + 24 * HOUR).toISOString())

    const row = db.session(body.publicCode)
    expect(row).toMatchObject({ status: 'waiting', scoreboard_state: { screen: 'server', games: '0-0' } })
  })

  it('stores only the hash of the controller token, never the token itself', async () => {
    const { body } = await create()
    const tokenRow = db.tables.live_scoreboard_controller_tokens[0]
    expect(tokenRow.controller_token_hash).toBe(await hashToken(body.controllerToken))
    expect(JSON.stringify(db.tables)).not.toContain(body.controllerToken)
  })

  it('builds the link from the app origin, ignoring a trailing slash', async () => {
    const { body } = await create({}, 'https://score.example.com/')
    expect(body.scoreboardUrl).toBe(`https://score.example.com/scoreboard/${body.publicCode}`)
  })

  it('falls back to the request Origin header when no valid origin is sent', async () => {
    const res = await handleCreate(post({ scoreboardState: {}, origin: 'javascript:alert(1)' }, { origin: 'https://app.test' }), deps())
    const body = await res.json()
    expect(body.scoreboardUrl).toBe(`https://app.test/scoreboard/${body.publicCode}`)
  })

  it('retries with a new code when the random code already exists', async () => {
    db.failSessionInserts = [{ code: '23505', message: 'duplicate' }, { code: '23505', message: 'duplicate' }]
    const { res } = await create()
    expect(res.status).toBe(200)
    expect(db.tables.live_scoreboard_sessions).toHaveLength(1)
  })

  it('gives up after 5 code collisions', async () => {
    db.failSessionInserts = Array.from({ length: 5 }, () => ({ code: '23505', message: 'duplicate key value' }))
    const { res, body } = await create()
    expect(res.status).toBe(500)
    expect(body.error).toBe('duplicate key value')
  })

  it('does not retry on other database errors', async () => {
    db.failSessionInserts = [{ code: '42501', message: 'permission denied' }]
    const { res, body } = await create()
    expect(res.status).toBe(500)
    expect(body.error).toBe('permission denied')
    expect(db.failSessionInserts).toHaveLength(0)
  })

  it('removes the session again if saving the token fails', async () => {
    db.failTokenInsert = { message: 'token insert failed' }
    const { res, body } = await create()
    expect(res.status).toBe(500)
    expect(body.error).toBe('token insert failed')
    expect(db.tables.live_scoreboard_sessions).toHaveLength(0)
  })

  it('rejects a request without scoreboard state, or with invalid JSON', async () => {
    expect((await handleCreate(post({ origin: 'https://a.b' }), deps())).status).toBe(400)
    expect((await handleCreate(post('{not json'), deps())).status).toBe(400)
  })

  it('returns a clear error when the server is misconfigured', async () => {
    const res = await handleCreate(post({ scoreboardState: {} }), {
      getClient: () => { throw new Error('Missing SUPABASE_URL or a Supabase secret key') },
    })
    expect(res.status).toBe(500)
    expect((await res.json()).error).toContain('Missing SUPABASE_URL')
  })
})

describe('live-scoreboard-update', () => {
  async function update(code: string, token: string, status: string, scoreboardState: unknown = { s: status }) {
    const res = await handleUpdate(post({ publicCode: code, controllerToken: token, status, scoreboardState }), deps())
    return { res, body: await res.json() }
  }

  it('saves the new state and status', async () => {
    const { body: created } = await create()
    now = new Date(NOW.getTime() + 60_000)
    const { res } = await update(created.publicCode, created.controllerToken, 'paused', { games: '1-0' })
    expect(res.status).toBe(200)
    expect(db.session(created.publicCode)).toMatchObject({
      status: 'paused',
      scoreboard_state: { games: '1-0' },
      updated_at: now.toISOString(),
    })
  })

  it('accepts the match code in lower case', async () => {
    const { body: created } = await create()
    const { res } = await update(created.publicCode.toLowerCase(), created.controllerToken, 'live')
    expect(res.status).toBe(200)
  })

  it('starting the match (waiting → live) sets started_at and restarts the 24-hour expiry', async () => {
    const { body: created } = await create()
    now = new Date(NOW.getTime() + 2 * HOUR)
    const { body } = await update(created.publicCode, created.controllerToken, 'live')
    const expected = new Date(now.getTime() + 24 * HOUR).toISOString()
    expect(body.expiresAt).toBe(expected)
    expect(db.session(created.publicCode)).toMatchObject({ started_at: now.toISOString(), expires_at: expected })
  })

  it('later updates do not move the expiry, until the match finishes', async () => {
    const { body: created } = await create()
    await update(created.publicCode, created.controllerToken, 'live')
    const afterStart = db.session(created.publicCode).expires_at

    now = new Date(NOW.getTime() + 1 * HOUR)
    await update(created.publicCode, created.controllerToken, 'between')
    expect(db.session(created.publicCode).expires_at).toBe(afterStart)

    now = new Date(NOW.getTime() + 2 * HOUR)
    const { body } = await update(created.publicCode, created.controllerToken, 'finished')
    expect(body.expiresAt).toBe(new Date(now.getTime() + 24 * HOUR).toISOString())
    expect(db.session(created.publicCode).finished_at).toBe(now.toISOString())
  })

  it.each(['waiting', 'live', 'paused', 'between', 'tiebreak', 'finished'])('accepts status "%s"', async (status) => {
    const { body: created } = await create()
    expect((await update(created.publicCode, created.controllerToken, status)).res.status).toBe(200)
  })

  it.each(['closed', 'LIVE', '', 'deleted'])('rejects status "%s"', async (status) => {
    const { body: created } = await create()
    expect((await update(created.publicCode, created.controllerToken, status)).res.status).toBe(400)
  })

  it('rejects a wrong controller token', async () => {
    const { body: created } = await create()
    const { res, body } = await update(created.publicCode, createControllerToken(), 'live')
    expect(res.status).toBe(403)
    expect(body.error).toBe('Invalid controller token')
    expect(db.session(created.publicCode).status).toBe('waiting')
  })

  it('rejects another session\'s token', async () => {
    const { body: a } = await create()
    const { body: b } = await create()
    expect((await update(a.publicCode, b.controllerToken, 'live')).res.status).toBe(403)
  })

  it('rejects unknown codes and missing credentials', async () => {
    expect((await update('ZZZZZZZ', 'x', 'live')).body.error).toBe('Live scoreboard session not found')
    expect((await update('', '', 'live')).body.error).toBe('Missing live scoreboard credentials')
  })

  it('rejects updates after the link has expired', async () => {
    const { body: created } = await create()
    now = new Date(NOW.getTime() + 25 * HOUR)
    const { res, body } = await update(created.publicCode, created.controllerToken, 'live')
    expect(res.status).toBe(403)
    expect(body.error).toBe('Live scoreboard session has expired')
  })
})

describe('live-scoreboard-close', () => {
  async function close(code: string, token: string) {
    const res = await handleClose(post({ publicCode: code, controllerToken: token }), deps())
    return { res, body: await res.json() }
  }

  it('closes the session and expires it immediately', async () => {
    const { body: created } = await create()
    now = new Date(NOW.getTime() + HOUR)
    const { res, body } = await close(created.publicCode, created.controllerToken)
    expect(res.status).toBe(200)
    expect(body).toEqual({ ok: true })
    expect(db.session(created.publicCode)).toMatchObject({
      status: 'closed',
      closed_at: now.toISOString(),
      expires_at: now.toISOString(),
    })
  })

  it('a closed session can no longer be updated or closed again', async () => {
    const { body: created } = await create()
    await close(created.publicCode, created.controllerToken)
    const again = await close(created.publicCode, created.controllerToken)
    expect(again.res.status).toBe(403)
    expect(again.body.error).toBe('Live scoreboard session is closed')
    const res = await handleUpdate(post({ publicCode: created.publicCode, controllerToken: created.controllerToken, status: 'live', scoreboardState: {} }), deps())
    expect(res.status).toBe(403)
  })

  it('rejects a wrong token', async () => {
    const { body: created } = await create()
    expect((await close(created.publicCode, 'wrong')).res.status).toBe(403)
    expect(db.session(created.publicCode).status).toBe('waiting')
  })
})
