import type { LiveControllerSession, LiveScoreboardState, LiveSessionStatus } from './types'

const STORAGE_KEY = 'tennis-score-live-controller-v1'

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
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
  const result = await postJson<LiveControllerSession>('/.netlify/functions/live-scoreboard-create', {
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
  return postJson('/.netlify/functions/live-scoreboard-update', {
    publicCode: session.publicCode,
    controllerToken: session.controllerToken,
    status,
    scoreboardState,
  })
}

export async function closeLiveScoreboard(session: LiveControllerSession): Promise<void> {
  await postJson('/.netlify/functions/live-scoreboard-close', {
    publicCode: session.publicCode,
    controllerToken: session.controllerToken,
  })
  saveControllerSession(null)
}
