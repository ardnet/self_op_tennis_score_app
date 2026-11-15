import { describe, expect, it } from 'vitest'
import { liveApiBaseUrl } from './controller'

describe('Live Scoreboard API address', () => {
  it('defaults to the Supabase project\'s Edge Functions', () => {
    expect(liveApiBaseUrl({ VITE_SUPABASE_URL: 'https://abcxyz.supabase.co' }))
      .toBe('https://abcxyz.supabase.co/functions/v1')
  })

  it('ignores trailing slashes and spaces', () => {
    expect(liveApiBaseUrl({ VITE_SUPABASE_URL: ' https://abcxyz.supabase.co/ ' }))
      .toBe('https://abcxyz.supabase.co/functions/v1')
  })

  it('VITE_LIVE_API_BASE_URL overrides the default (e.g. functions running locally)', () => {
    expect(liveApiBaseUrl({
      VITE_SUPABASE_URL: 'https://abcxyz.supabase.co',
      VITE_LIVE_API_BASE_URL: 'http://127.0.0.1:54321/functions/v1/',
    })).toBe('http://127.0.0.1:54321/functions/v1')
  })

  it('is empty when Supabase is not configured', () => {
    expect(liveApiBaseUrl({})).toBe('')
    expect(liveApiBaseUrl({ VITE_LIVE_API_BASE_URL: '  ' })).toBe('')
  })
})
