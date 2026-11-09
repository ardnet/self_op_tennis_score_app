import { getAdminClient, json, readJson, verifyController } from '../lib/supabase-admin.mjs'

const allowedStatuses = new Set(['waiting', 'live', 'paused', 'between', 'tiebreak', 'finished'])

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const body = await readJson(req)
  if (!body?.scoreboardState || !allowedStatuses.has(body.status)) return json(400, { error: 'Invalid live scoreboard update' })

  try {
    const supabase = getAdminClient()
    const verified = await verifyController(supabase, body.publicCode, body.controllerToken)
    if (!verified.row) return json(403, { error: verified.error })

    const now = new Date()
    const patch = {
      status: body.status,
      scoreboard_state: body.scoreboardState,
      updated_at: now.toISOString(),
    }

    if (body.status === 'live' && verified.row.status === 'waiting') {
      patch.started_at = now.toISOString()
      patch.expires_at = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
    }

    if (body.status === 'finished') {
      patch.finished_at = now.toISOString()
      patch.expires_at = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString()
    }

    const { data, error } = await supabase
      .from('live_scoreboard_sessions')
      .update(patch)
      .eq('id', verified.row.id)
      .select('expires_at')
      .single()

    if (error) throw error
    return json(200, { expiresAt: data.expires_at })
  } catch (error) {
    console.error(error)
    return json(500, { error: error instanceof Error ? error.message : 'Unable to update live scoreboard' })
  }
}
