import { createClient } from '@supabase/supabase-js'
import { createHash, randomBytes } from 'node:crypto'

export function getAdminClient() {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Missing SUPABASE_URL or SUPABASE_SECRET_KEY/SUPABASE_SERVICE_ROLE_KEY')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export function json(statusCode, body) {
  return new Response(JSON.stringify(body), {
    status: statusCode,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export function hashToken(token) {
  return createHash('sha256').update(token).digest('hex')
}

export function createControllerToken() {
  return randomBytes(32).toString('base64url')
}

const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export function createPublicCode(length = 7) {
  const bytes = randomBytes(length)
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('')
}

export async function readJson(req) {
  try { return await req.json() } catch { return null }
}

export async function verifyController(supabase, publicCode, controllerToken) {
  if (!publicCode || !controllerToken) return { row: null, error: 'Missing live scoreboard credentials' }
  const { data, error } = await supabase
    .from('live_scoreboard_sessions')
    .select('id, public_code, status, expires_at, closed_at')
    .eq('public_code', String(publicCode).toUpperCase())
    .maybeSingle()

  if (error || !data) return { row: null, error: 'Live scoreboard session not found' }
  if (data.closed_at || data.status === 'closed') return { row: null, error: 'Live scoreboard session is closed' }
  if (new Date(data.expires_at).getTime() <= Date.now()) return { row: null, error: 'Live scoreboard session has expired' }
  const { data: tokenRow, error: tokenError } = await supabase
    .from('live_scoreboard_controller_tokens')
    .select('controller_token_hash')
    .eq('session_id', data.id)
    .maybeSingle()
  if (tokenError || !tokenRow || hashToken(controllerToken) !== tokenRow.controller_token_hash) return { row: null, error: 'Invalid controller token' }
  return { row: data, error: null }
}
