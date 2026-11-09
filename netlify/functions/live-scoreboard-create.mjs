import { createControllerToken, createPublicCode, getAdminClient, hashToken, json, readJson } from '../lib/supabase-admin.mjs'

export default async (req) => {
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })
  const body = await readJson(req)
  if (!body?.scoreboardState) return json(400, { error: 'Missing scoreboard state' })

  try {
    const supabase = getAdminClient()
    const controllerToken = createControllerToken()
    const controllerTokenHash = hashToken(controllerToken)
    let inserted = null
    let lastError = null

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const publicCode = createPublicCode()
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
      const { data, error } = await supabase
        .from('live_scoreboard_sessions')
        .insert({
          public_code: publicCode,
          status: 'waiting',
          scoreboard_state: body.scoreboardState,
          expires_at: expiresAt,
        })
        .select('id, public_code, created_at, expires_at')
        .single()

      if (!error && data) { inserted = data; break }
      lastError = error
      if (error?.code !== '23505') break
    }

    if (!inserted) throw lastError || new Error('Unable to create live scoreboard')

    const { error: tokenError } = await supabase
      .from('live_scoreboard_controller_tokens')
      .insert({ session_id: inserted.id, controller_token_hash: controllerTokenHash })
    if (tokenError) {
      await supabase.from('live_scoreboard_sessions').delete().eq('id', inserted.id)
      throw tokenError
    }

    const origin = typeof body.origin === 'string' && /^https?:\/\//.test(body.origin)
      ? body.origin.replace(/\/$/, '')
      : new URL(req.url).origin

    return json(200, {
      publicCode: inserted.public_code,
      scoreboardUrl: `${origin}/scoreboard/${inserted.public_code}`,
      controllerToken,
      createdAt: inserted.created_at,
      expiresAt: inserted.expires_at,
    })
  } catch (error) {
    console.error(error)
    return json(500, { error: error instanceof Error ? error.message : 'Unable to create live scoreboard' })
  }
}
