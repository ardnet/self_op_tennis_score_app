import type { SessionConfig, Side } from './types'

/**
 * Test helpers for the scoring domain. Not imported by the app.
 */

export const NAMES = {
  player1: 'Ardi',
  player2: 'Max',
  opponent1: 'Sinner',
  opponent2: 'Zac',
} as const

export function makeConfig(overrides: Partial<SessionConfig> = {}): SessionConfig {
  return {
    mode: 'single',
    names: { ...NAMES },
    deuceMode: 'unlimited',
    maxDeuce: 3,
    totalGames: 6,
    gameLeadMargin: 2,
    gamesTieResolution: 'tiebreak',
    tieBreakMaxPoint: 7,
    tieBreakMargin: 2,
    tieBreakEqualResolution: 'unlimited',
    firstServingSide: 'player',
    playerFirstServer: 'player1',
    opponentFirstServer: 'opponent1',
    ...overrides,
  }
}

/**
 * Point-winner shorthand: 'P' = player side wins the point, 'O' = opponent side.
 * Spaces are ignored, so 'PPP OOO' reads as 40–40.
 */
export function points(sequence: string): Side[] {
  return [...sequence.replace(/\s+/g, '')].map((char) => {
    if (char === 'P') return 'player'
    if (char === 'O') return 'opponent'
    throw new Error(`Unknown point code "${char}" — use P or O`)
  })
}

/** Alternating points that produce `count` Deuces, starting from 0–0. */
export function deuces(count: number): Side[] {
  if (count < 1) return []
  return points('PPPOOO' + 'PO'.repeat(count - 1))
}

export function swapSides(events: Side[]): Side[] {
  return events.map((side) => (side === 'player' ? 'opponent' : 'player'))
}
