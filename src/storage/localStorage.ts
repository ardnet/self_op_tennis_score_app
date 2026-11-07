import type { PersistedAppState } from '../domain/types'

const STORAGE_KEY = 'tennis-score-tracker-multigame-v1'

export function saveState(state: PersistedAppState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // MVP: continue when storage is unavailable.
  }
}

export function loadState(): PersistedAppState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    return JSON.parse(raw) as PersistedAppState
  } catch {
    return null
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // MVP: ignore cleanup failures.
  }
}
