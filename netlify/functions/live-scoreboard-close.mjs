import { getAdminClient, json, readJson, verifyController } from '../lib/supabase-admin.mjs'

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const body = await readJson(req)

  try {
    const supabase = getAdminClient()
    const verified = await verifyController(supabase, body?.publicCode, body?.controllerToken)
    if (!verified.row) return json(403, { error: verified.error })

    const now = new Date().toISOString()
    const { error } = await supabase
      .from('live_scoreboard_sessions')
      .update({ status: 'closed', closed_at: now, expires_at: now, updated_at: now })
      .eq('id', verified.row.id)

    if (error) throw error
    return json(200, { ok: true })
  } catch (error) {
    console.error(error)
    return json(500, { error: error instanceof Error ? error.message : 'Unable to close live scoreboard' })
  }
}
