const GA_MEASUREMENT_ID = import.meta.env.VITE_GA_MEASUREMENT_ID?.trim()

const isConfigured = Boolean(GA_MEASUREMENT_ID && /^G-[A-Z0-9]+$/i.test(GA_MEASUREMENT_ID))

type AnalyticsValue = string | number | boolean
export type AnalyticsParams = Record<string, AnalyticsValue | undefined>

declare global {
  interface Window {
    dataLayer?: unknown[]
    gtag?: (...args: unknown[]) => void
  }
}

let initialised = false

export function initAnalytics() {
  if (!isConfigured || initialised || typeof window === 'undefined') return
  initialised = true

  window.dataLayer = window.dataLayer || []
  // Must be a classic function pushing the `arguments` object, exactly like
  // Google's snippet. gtag.js ignores plain arrays (e.g. from `...args`), so
  // an arrow function with rest parameters silently sends nothing.
  window.gtag = function gtag() {
    // eslint-disable-next-line prefer-rest-params
    window.dataLayer!.push(arguments)
  }

  window.gtag('js', new Date())
  window.gtag('config', GA_MEASUREMENT_ID, {
    send_page_view: true,
    anonymize_ip: true,
  })

  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(GA_MEASUREMENT_ID!)}`
  document.head.appendChild(script)
}

export function trackEvent(eventName: string, params: AnalyticsParams = {}) {
  if (!isConfigured || typeof window === 'undefined' || !window.gtag) return

  const cleanParams = Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined),
  )

  window.gtag('event', eventName, cleanParams)
}

export function analyticsConfigured() {
  return isConfigured
}
