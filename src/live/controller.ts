import type { LiveControllerSession, LiveScoreboardState, LiveSessionStatus } from './types'

const STORAGE_KEY = 'tennis-score-live-controller-v1'

/**
 * Where the Live Scoreboard API (Supabase Edge Functions) lives.
 * Defaults to <VITE_SUPABASE_URL>/functions/v1; VITE_LIVE_API_BASE_URL overrides it
 * (e.g. http://127.0.0.1:54321/functions/v1 when running functions locally).
 */
export function liveApiBaseUrl(env: Partial<ImportMetaEnv> = import.meta.env): string {
  const override = env.VITE_LIVE_API_BASE_URL?.trim()
  const supabaseUrl = env.VITE_SUPABASE_URL?.trim()
  const base = override || (supabaseUrl ? `${supabaseUrl.replace(/\/+$/, '')}/functions/v1` : '')
  return base.replace(/\/+$/, '')
}

async function postJson<T>(functionName: string, body: unknown): Promise<T> {
  const base = liveApiBaseUrl()
  if (!base) throw new Error('Live Scoreboard is not configured (missing VITE_SUPABASE_URL)')

  const publishableKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || import.meta.env.VITE_SUPABASE_ANON_KEY
  const response = await fetch(`${base}/${functionName}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(publishableKey ? { apikey: publishableKey } : {}),
    },
    body: JSON.stringify(body),
  })

  const payload = await response.json().catch(() => ({})) as { error?: string } & T
  if (!response.ok) throw new Error(payload.error || `Request failed (${response.status})`)
  return payload
}

export function loadControllerSession(): LiveControllerSession | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) as LiveControllerSession : null
  } catch {
    return null
  }
}

export function saveControllerSession(session: LiveControllerSession | null) {
  if (!session) localStorage.removeItem(STORAGE_KEY)
  else localStorage.setItem(STORAGE_KEY, JSON.stringify(session))
}

export async function createLiveScoreboard(initialState: LiveScoreboardState): Promise<LiveControllerSession> {
  const result = await postJson<LiveControllerSession>('live-scoreboard-create', {
    scoreboardState: initialState,
    origin: window.location.origin,
  })
  saveControllerSession(result)
  return result
}

export async function updateLiveScoreboard(
  session: LiveControllerSession,
  status: LiveSessionStatus,
  scoreboardState: LiveScoreboardState,
): Promise<{ expiresAt: string }> {
  return postJson('live-scoreboard-update', {
    publicCode: session.publicCode,
    controllerToken: session.controllerToken,
    status,
    scoreboardState,
  })
}

export async function closeLiveScoreboard(session: LiveControllerSession): Promise<void> {
  await postJson('live-scoreboard-close', {
    publicCode: session.publicCode,
    controllerToken: session.controllerToken,
  })
  saveControllerSession(null)
}
