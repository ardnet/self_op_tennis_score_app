/**
 * Live Scoreboard API: create / update / close a live scoreboard session.
 *
 * Runs as Supabase Edge Functions (Deno). This file has no Deno- or
 * Supabase-specific imports, so the same code is unit-tested with Vitest:
 * the database client and the clock are passed in.
 *
 * Security model (unchanged from the original Netlify Functions):
 * - The scoring phone holds a random controller token; only its SHA-256 hash
 *   is stored, in a table browsers cannot read.
 * - Every write must present the public code + controller token.
 * - Writes use the Supabase secret key, which never reaches the browser.
 */

type AnyRecord = Record<string, any>

/** The small part of the supabase-js client these handlers use. */
export interface AdminClient {
    from(table: string): any
}

export interface Deps {
  getClient: () => AdminClient
  now?: () => Date
}

const SESSIONS = 'live_scoreboard_sessions'
const TOKENS = 'live_scoreboard_controller_tokens'
const DAY_MS = 24 * 60 * 60 * 1000
const ALLOWED_STATUSES = new Set(['waiting', 'live', 'paused', 'between', 'tiebreak', 'finished'])

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

/**
 * The app (on Render) and these functions (on Supabase) are on different
 * domains, so browsers need CORS headers. Auth is the controller token in the
 * request body (no cookies), so allowing any origin is safe here.
 */
export const corsHeaders: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-max-age': '86400',
}

export function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

async function readJson(req: Request): Promise<AnyRecord | null> {
  try {
    const body = await req.json()
    return body && typeof body === 'object' ? body as AnyRecord : null
  } catch {
    return null
  }
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') return error.message
  return fallback
}

/** Wraps a POST handler with CORS preflight, method check and error handling. */
function endpoint(fallbackError: string, handler: (body: AnyRecord | null, req: Request, deps: Deps) => Promise<Response>) {
  return async (req: Request, deps: Deps): Promise<Response> => {
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders })
    if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
    const body = await readJson(req)
    try {
      return await handler(body, req, deps)
    } catch (error) {
      console.error(error)
      return json(500, { error: errorMessage(error, fallbackError) })
    }
  }
}

// ---------------------------------------------------------------------------
// Tokens and codes (Web Crypto; same formats as the original Node version)
// ---------------------------------------------------------------------------

/** SHA-256 as lowercase hex. Same output as Node's createHash('sha256').digest('hex'). */
export async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** 32 random bytes, base64url-encoded (43 characters). */
export function createControllerToken(): string {
  return base64Url(crypto.getRandomValues(new Uint8Array(32)))
}

/** Easy-to-read match code: no 0/O or 1/I. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

export function createPublicCode(length = 7): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length))
  return Array.from(bytes, (byte) => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('')
}

// ---------------------------------------------------------------------------
// Controller verification
// ---------------------------------------------------------------------------

interface VerifiedSession {
  id: string
  public_code: string
  status: string
  expires_at: string
  closed_at: string | null
}

export async function verifyController(
  supabase: AdminClient,
  publicCode: unknown,
  controllerToken: unknown,
  now: Date,
): Promise<{ row: VerifiedSession | null; error: string | null }> {
  if (!publicCode || !controllerToken) return { row: null, error: 'Missing live scoreboard credentials' }

  const { data, error } = await supabase
    .from(SESSIONS)
    .select('id, public_code, status, expires_at, closed_at')
    .eq('public_code', String(publicCode).toUpperCase())
    .maybeSingle()

  if (error || !data) return { row: null, error: 'Live scoreboard session not found' }
  if (data.closed_at || data.status === 'closed') return { row: null, error: 'Live scoreboard session is closed' }
  if (new Date(data.expires_at).getTime() <= now.getTime()) return { row: null, error: 'Live scoreboard session has expired' }

  const { data: tokenRow, error: tokenError } = await supabase
    .from(TOKENS)
    .select('controller_token_hash')
    .eq('session_id', data.id)
    .maybeSingle()

  if (tokenError || !tokenRow || (await hashToken(String(controllerToken))) !== tokenRow.controller_token_hash) {
    return { row: null, error: 'Invalid controller token' }
  }
  return { row: data as VerifiedSession, error: null }
}

// ---------------------------------------------------------------------------
// Endpoints
// ---------------------------------------------------------------------------

/** POST live-scoreboard-create  { scoreboardState, origin } */
export const handleCreate = endpoint('Unable to create live scoreboard', async (body, req, deps) => {
  if (!body?.scoreboardState) return json(400, { error: 'Missing scoreboard state' })

  const supabase = deps.getClient()
  const now = deps.now ?? (() => new Date())
  const controllerToken = createControllerToken()
  const controllerTokenHash = await hashToken(controllerToken)
  let inserted: AnyRecord | null = null
  let lastError: unknown = null

  // Retry if a random code collides with an existing one (unique violation 23505).
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const { data, error } = await supabase
      .from(SESSIONS)
      .insert({
        public_code: createPublicCode(),
        status: 'waiting',
        scoreboard_state: body.scoreboardState,
        expires_at: new Date(now().getTime() + DAY_MS).toISOString(),
      })
      .select('id, public_code, created_at, expires_at')
      .single()

    if (!error && data) {
      inserted = data
      break
    }
    lastError = error
    if (error?.code !== '23505') break
  }

  if (!inserted) throw lastError || new Error('Unable to create live scoreboard')

  const { error: tokenError } = await supabase
    .from(TOKENS)
    .insert({ session_id: inserted.id, controller_token_hash: controllerTokenHash })
  if (tokenError) {
    await supabase.from(SESSIONS).delete().eq('id', inserted.id)
    throw tokenError
  }

  // The scoreboard link must point at the app, not at this function's domain.
  const origin = typeof body.origin === 'string' && /^https?:\/\//.test(body.origin)
    ? body.origin.replace(/\/$/, '')
    : (req.headers.get('origin') ?? new URL(req.url).origin)

  return json(200, {
    publicCode: inserted.public_code,
    scoreboardUrl: `${origin}/scoreboard/${inserted.public_code}`,
    controllerToken,
    createdAt: inserted.created_at,
    expiresAt: inserted.expires_at,
  })
})

/** POST live-scoreboard-update  { publicCode, controllerToken, status, scoreboardState } */
export const handleUpdate = endpoint('Unable to update live scoreboard', async (body, _req, deps) => {
  if (!body?.scoreboardState || !ALLOWED_STATUSES.has(body.status)) {
    return json(400, { error: 'Invalid live scoreboard update' })
  }

  const supabase = deps.getClient()
  const now = (deps.now ?? (() => new Date()))()
  const verified = await verifyController(supabase, body.publicCode, body.controllerToken, now)
  if (!verified.row) return json(403, { error: verified.error })

  const patch: AnyRecord = {
    status: body.status,
    scoreboard_state: body.scoreboardState,
    updated_at: now.toISOString(),
  }

  // Links expire 24 hours after the match starts or finishes.
  if (body.status === 'live' && verified.row.status === 'waiting') {
    patch.started_at = now.toISOString()
    patch.expires_at = new Date(now.getTime() + DAY_MS).toISOString()
  }
  if (body.status === 'finished') {
    patch.finished_at = now.toISOString()
    patch.expires_at = new Date(now.getTime() + DAY_MS).toISOString()
  }

  const { data, error } = await supabase
    .from(SESSIONS)
    .update(patch)
    .eq('id', verified.row.id)
    .select('expires_at')
    .single()

  if (error) throw error
  return json(200, { expiresAt: data.expires_at })
})

/** POST live-scoreboard-close  { publicCode, controllerToken } */
export const handleClose = endpoint('Unable to close live scoreboard', async (body, _req, deps) => {
  const supabase = deps.getClient()
  const now = (deps.now ?? (() => new Date()))()
  const verified = await verifyController(supabase, body?.publicCode, body?.controllerToken, now)
  if (!verified.row) return json(403, { error: verified.error })

  const iso = now.toISOString()
  const { error } = await supabase
    .from(SESSIONS)
    .update({ status: 'closed', closed_at: iso, expires_at: iso, updated_at: iso })
    .eq('id', verified.row.id)

  if (error) throw error
  return json(200, { ok: true })
})
