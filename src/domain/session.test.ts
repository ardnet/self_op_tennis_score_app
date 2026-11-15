import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  changesEndsAfterTieBreakPoint,
  clampWhole,
  gamesTally,
  nextTieBreakEndChangeAt,
  otherOpponentServer,
  otherPlayerServer,
  serverForGame,
  serverName,
  servingSideForGame,
  sideForServer,
  tieBreakCourtSide,
  tieBreakPointNumber,
  tieBreakServerForPoint,
  tieBreakServingOrder,
  tieBreakServingSideForPoint,
} from './session'
import type { GameRecord, OpponentTeamServerId, PlayerTeamServerId, ServerId, SessionConfig, Side } from './types'
import { makeConfig } from './testUtils'

/*
 * Section numbers refer to "Self-Operated Tennis Score — Product Requirements /
 * UI/UX Specification" (consolidated reference, 10 November 2026).
 */

const rotation = (config: SessionConfig, games: number) =>
  Array.from({ length: games }, (_, i) => serverForGame(config, i))

const tieBreakServers = (config: SessionConfig, completedGames: number, points: number) =>
  Array.from({ length: points }, (_, p) => tieBreakServerForPoint(config, completedGames, p))

const record = (winner: Side, gameNumber = 1): GameRecord => ({
  gameNumber,
  server: 'player1',
  events: [],
  winner,
  durationMs: 0,
})

const doublesConfigArb = fc.record({
  firstServingSide: fc.constantFrom<Side>('player', 'opponent'),
  playerFirstServer: fc.constantFrom<PlayerTeamServerId>('player1', 'player2'),
  opponentFirstServer: fc.constantFrom<OpponentTeamServerId>('opponent1', 'opponent2'),
}).map((o) => makeConfig({ mode: 'double', ...o }))

describe('Games tally (§7)', () => {
  it('counts Games won by each side', () => {
    expect(gamesTally([])).toEqual({ player: 0, opponent: 0 })
    expect(gamesTally([record('player'), record('opponent'), record('player')])).toEqual({ player: 2, opponent: 1 })
  })
})

describe('helpers', () => {
  it('maps each server to their side', () => {
    expect(sideForServer('player1')).toBe('player')
    expect(sideForServer('player2')).toBe('player')
    expect(sideForServer('opponent1')).toBe('opponent')
    expect(sideForServer('opponent2')).toBe('opponent')
  })

  it('swaps partners within a team', () => {
    expect(otherPlayerServer('player1')).toBe('player2')
    expect(otherPlayerServer('player2')).toBe('player1')
    expect(otherOpponentServer('opponent1')).toBe('opponent2')
    expect(otherOpponentServer('opponent2')).toBe('opponent1')
  })

  it('returns the configured name for a server', () => {
    const config = makeConfig()
    expect(serverName(config, 'player2')).toBe('Max')
    expect(serverName(config, 'opponent1')).toBe('Sinner')
  })

  it('clampWhole rounds, clamps, and falls back to the minimum for non-numbers', () => {
    expect(clampWhole(4.4, 2, 10)).toBe(4)
    expect(clampWhole(4.5, 2, 10)).toBe(5)
    expect(clampWhole(0, 2, 10)).toBe(2)
    expect(clampWhole(99, 2, 10)).toBe(10)
    expect(clampWhole(Number.NaN, 2, 10)).toBe(2)
    expect(clampWhole(Number.POSITIVE_INFINITY, 2, 10)).toBe(2)
  })
})

describe('Singles serving rotation (§8.1)', () => {
  it('the chosen first server serves Game 1, then service alternates every Game', () => {
    expect(rotation(makeConfig({ firstServingSide: 'player' }), 6))
      .toEqual(['player1', 'opponent1', 'player1', 'opponent1', 'player1', 'opponent1'])
    expect(rotation(makeConfig({ firstServingSide: 'opponent' }), 4))
      .toEqual(['opponent1', 'player1', 'opponent1', 'player1'])
  })

  it('ignores the Doubles "first server within team" settings', () => {
    const config = makeConfig({ playerFirstServer: 'player2', opponentFirstServer: 'opponent2' })
    expect(rotation(config, 4)).toEqual(['player1', 'opponent1', 'player1', 'opponent1'])
  })
})

describe('Doubles serving rotation (§8.2)', () => {
  it('matches the spec example: P1 → O2 → P2 → O1 → P1 → repeat', () => {
    const config = makeConfig({
      mode: 'double',
      firstServingSide: 'player',
      playerFirstServer: 'player1',
      opponentFirstServer: 'opponent2',
    })
    expect(rotation(config, 8)).toEqual([
      'player1', 'opponent2', 'player2', 'opponent1',
      'player1', 'opponent2', 'player2', 'opponent1',
    ])
  })

  it('works when the opponent team serves first', () => {
    const config = makeConfig({
      mode: 'double',
      firstServingSide: 'opponent',
      playerFirstServer: 'player2',
      opponentFirstServer: 'opponent1',
    })
    expect(rotation(config, 4)).toEqual(['opponent1', 'player2', 'opponent2', 'player1'])
  })

  it('for every setup: teams alternate, partners alternate, and all four serve once per four Games', () => {
    fc.assert(fc.property(doublesConfigArb, fc.integer({ min: 0, max: 40 }), (config, start) => {
      const servers = Array.from({ length: 8 }, (_, i) => serverForGame(config, start + i))
      for (let i = 1; i < servers.length; i += 1) {
        expect(sideForServer(servers[i])).not.toBe(sideForServer(servers[i - 1]))
      }
      for (let i = 2; i < servers.length; i += 1) {
        expect(servers[i]).not.toBe(servers[i - 2])
      }
      expect(new Set(servers.slice(0, 4)).size).toBe(4)
      expect(servers.slice(4)).toEqual(servers.slice(0, 4))
    }))
  })

  it('Game 1 is served by the chosen first server of the chosen team', () => {
    fc.assert(fc.property(doublesConfigArb, (config) => {
      const expected: ServerId = config.firstServingSide === 'player' ? config.playerFirstServer : config.opponentFirstServer
      expect(serverForGame(config, 0)).toBe(expected)
    }))
  })
})

describe('serving side drives IN / OUT (§3, §8.3)', () => {
  // IN = the current server's side wins the point; OUT = the receiving side.
  // These functions supply that serving side to the IN / OUT buttons.
  it('the serving side for a Game matches the side of that Game\'s server', () => {
    fc.assert(fc.property(
      fc.oneof(doublesConfigArb, fc.constantFrom<Side>('player', 'opponent').map((s) => makeConfig({ firstServingSide: s }))),
      fc.integer({ min: 0, max: 20 }),
      (config, gameIndex) => {
        expect(servingSideForGame(config, gameIndex)).toBe(sideForServer(serverForGame(config, gameIndex)))
      },
    ))
  })

  it('the serving side for a Tie-Break point matches the side of that point\'s server', () => {
    fc.assert(fc.property(doublesConfigArb, fc.integer({ min: 2, max: 10 }), fc.integer({ min: 0, max: 40 }), (config, games, played) => {
      expect(tieBreakServingSideForPoint(config, games, played))
        .toBe(sideForServer(tieBreakServerForPoint(config, games, played)))
    }))
  })
})

describe('Final Tie-Break serving (§9.3–9.5)', () => {
  it('Point 1 is served by the next scheduled server after the last Game', () => {
    const six = makeConfig({ totalGames: 6, firstServingSide: 'player' })
    expect(rotation(six, 6).at(-1)).toBe('opponent1')
    expect(tieBreakServerForPoint(six, 6, 0)).toBe('player1')

    const five = makeConfig({ totalGames: 5, firstServingSide: 'player' })
    expect(rotation(five, 5).at(-1)).toBe('player1')
    expect(tieBreakServerForPoint(five, 5, 0)).toBe('opponent1')
  })

  it('Singles: A → B,B → A,A → B,B (§9.4)', () => {
    const config = makeConfig({ totalGames: 6 })
    const A = 'player1'
    const B = 'opponent1'
    expect(tieBreakServers(config, 6, 9)).toEqual([A, B, B, A, A, B, B, A, A])
  })

  it('Doubles: the spec example A1; B1,B1; A2,A2; B2,B2; A1,A1 (§9.5)', () => {
    // Established Game order A1 → B1 → A2 → B2, and 4 Games played, so A1 is next.
    const config = makeConfig({
      mode: 'double',
      totalGames: 4,
      firstServingSide: 'player',
      playerFirstServer: 'player1',
      opponentFirstServer: 'opponent1',
    })
    expect(rotation(config, 4)).toEqual(['player1', 'opponent1', 'player2', 'opponent2'])
    expect(tieBreakServers(config, 4, 9)).toEqual([
      'player1',
      'opponent1', 'opponent1',
      'player2', 'player2',
      'opponent2', 'opponent2',
      'player1', 'player1',
    ])
  })

  it('Doubles: continues the established order mid-cycle (6 Games played)', () => {
    const config = makeConfig({
      mode: 'double',
      totalGames: 6,
      firstServingSide: 'player',
      playerFirstServer: 'player1',
      opponentFirstServer: 'opponent2',
    })
    // Games: P1 O2 P2 O1 P1 O2 → next is P2
    expect(tieBreakServers(config, 6, 5)).toEqual(['player2', 'opponent1', 'opponent1', 'player1', 'player1'])
  })

  it('for every setup: one point for the first server, then two points each, alternating sides', () => {
    fc.assert(fc.property(doublesConfigArb, fc.integer({ min: 2, max: 10 }), (config, games) => {
      const servers = tieBreakServers(config, games, 25)
      expect(servers[0]).toBe(serverForGame(config, games))
      for (let p = 1; p < servers.length; p += 2) {
        if (p + 1 < servers.length) expect(servers[p + 1]).toBe(servers[p])
        expect(sideForServer(servers[p])).not.toBe(sideForServer(servers[p - 1]))
      }
    }))
  })

  it('previews the serving order starting with the Point 1 server', () => {
    const singles = makeConfig({ totalGames: 6 })
    expect(tieBreakServingOrder(singles, 6)).toEqual(['player1', 'opponent1'])

    const doubles = makeConfig({ mode: 'double', totalGames: 4 })
    expect(tieBreakServingOrder(doubles, 4)).toEqual(['player1', 'opponent1', 'player2', 'opponent2'])
  })
})

describe('Tie-Break court side and change of ends (§9.6–9.7)', () => {
  it('Point 1 is served from the Deuce court, then the court alternates every point', () => {
    expect([0, 1, 2, 3, 4, 5].map(tieBreakCourtSide)).toEqual(['deuce', 'ad', 'deuce', 'ad', 'deuce', 'ad'])
  })

  it('numbers points from 1', () => {
    expect(tieBreakPointNumber(0)).toBe(1)
    expect(tieBreakPointNumber(11)).toBe(12)
  })

  it('flags a change of ends after points 6, 12, 18 … only', () => {
    const flagged = Array.from({ length: 30 }, (_, played) => played)
      .filter(changesEndsAfterTieBreakPoint)
      .map(tieBreakPointNumber)
    expect(flagged).toEqual([6, 12, 18, 24, 30])
  })

  it('tells you the point after which the next change of ends happens', () => {
    expect(nextTieBreakEndChangeAt(0)).toBe(6)
    expect(nextTieBreakEndChangeAt(5)).toBe(6)
    expect(nextTieBreakEndChangeAt(6)).toBe(12)
    expect(nextTieBreakEndChangeAt(11)).toBe(12)
    expect(nextTieBreakEndChangeAt(12)).toBe(18)
  })
})
