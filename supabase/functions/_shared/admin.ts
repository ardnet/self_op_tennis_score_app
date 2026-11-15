import { createClient } from 'npm:@supabase/supabase-js@2.119.0'
import type { AdminClient } from './live.ts'

/**
 * Server-side Supabase client using the project's secret key.
 *
 * Supabase provides these to every Edge Function automatically:
 * - SUPABASE_URL
 * - SUPABASE_SECRET_KEYS (JSON, new sb_secret_ keys; the key named "default" is used)
 * - SUPABASE_SERVICE_ROLE_KEY (legacy key, used as a fallback)
 */
let client: AdminClient | null = null

export function getAdminClient(): AdminClient {
  if (client) return client

  const url = Deno.env.get('SUPABASE_URL')
  let key: string | undefined
  try {
    const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>
    key = secretKeys.default
  } catch {
    key = undefined
  }
  key ||= Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')

  if (!url || !key) throw new Error('Missing SUPABASE_URL or a Supabase secret key')
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
  return client
}
