import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/*
 * GA4's gtag.js only processes dataLayer entries that are `arguments` objects
 * (as in Google's official snippet). Plain arrays are ignored, so no data is
 * sent. These tests guard that.
 */

type FakeWindow = { dataLayer?: unknown[]; gtag?: (...args: unknown[]) => void }

const isArgumentsObject = (value: unknown) => Object.prototype.toString.call(value) === '[object Arguments]'

let appended: { src?: string; async?: boolean }[]

beforeEach(() => {
  vi.resetModules()
  appended = []
  vi.stubGlobal('window', {} as FakeWindow)
  vi.stubGlobal('document', {
    createElement: () => ({}),
    head: { appendChild: (el: { src?: string; async?: boolean }) => appended.push(el) },
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
})

async function load(measurementId: string | undefined) {
  if (measurementId !== undefined) vi.stubEnv('VITE_GA_MEASUREMENT_ID', measurementId)
  return import('./analytics')
}

describe('analytics (GA4)', () => {
  it('pushes gtag commands as `arguments` objects, which gtag.js requires', async () => {
    const { initAnalytics, trackEvent } = await load('G-TEST1234')
    initAnalytics()
    trackEvent('match_started', { play_mode: 'single', unused: undefined })

    const layer = (window as unknown as FakeWindow).dataLayer!
    expect(layer).toHaveLength(3)
    for (const entry of layer) expect(isArgumentsObject(entry)).toBe(true)

    const [js, config, event] = layer.map((entry) => Array.from(entry as ArrayLike<unknown>))
    expect(js[0]).toBe('js')
    expect(config.slice(0, 2)).toEqual(['config', 'G-TEST1234'])
    expect(event).toEqual(['event', 'match_started', { play_mode: 'single' }])
  })

  it('loads the Google tag script for the configured Measurement ID once', async () => {
    const { initAnalytics } = await load('G-TEST1234')
    initAnalytics()
    initAnalytics()
    expect(appended).toHaveLength(1)
    expect(appended[0]).toMatchObject({ async: true, src: 'https://www.googletagmanager.com/gtag/js?id=G-TEST1234' })
  })

  it('does nothing when no valid Measurement ID is configured', async () => {
    const { initAnalytics, trackEvent, analyticsConfigured } = await load('not-an-id')
    initAnalytics()
    trackEvent('match_started')
    expect(analyticsConfigured()).toBe(false)
    expect((window as unknown as FakeWindow).dataLayer).toBeUndefined()
    expect(appended).toHaveLength(0)
  })
})
