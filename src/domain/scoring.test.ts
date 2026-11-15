import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import { calculateGameScore, calculateTieBreak, normalPoint, sideName } from './scoring'
import type { DeuceMode, SessionConfig, Side, TieBreakEqualResolution } from './types'
import { deuces, makeConfig, points, swapSides } from './testUtils'

/*
 * Section numbers refer to "Self-Operated Tennis Score — Product Requirements /
 * UI/UX Specification" (consolidated reference, 10 November 2026).
 */

const singles = makeConfig()
const doubles = makeConfig({ mode: 'double' })
const lastHistory = (history: { text: string }[]) => history.at(-1)?.text

const sideArb = fc.constantFrom<Side>('player', 'opponent')
const eventsArb = fc.array(sideArb, { maxLength: 60 })

describe('names (§3)', () => {
  it('uses single names in Singles and "A / B" team names in Doubles', () => {
    expect(sideName(singles, 'player')).toBe('Ardi')
    expect(sideName(singles, 'opponent')).toBe('Sinner')
    expect(sideName(doubles, 'player')).toBe('Ardi / Max')
    expect(sideName(doubles, 'opponent')).toBe('Sinner / Zac')
  })
})

describe('normal Game scoring (§6)', () => {
  it('maps point counts to 0 / 15 / 30 / 40', () => {
    expect([0, 1, 2, 3, 4, 7, -1].map(normalPoint)).toEqual(['0', '15', '30', '40', '40', '40', '0'])
  })

  it('starts a Game at 0–0 with no winner', () => {
    const score = calculateGameScore(singles, [])
    expect(score).toMatchObject({
      playerDisplay: '0',
      opponentDisplay: '0',
      status: 'normal',
      advantage: null,
      deuceCount: 0,
      suddenDeath: false,
      winner: null,
      history: [],
    })
  })

  it('progresses 0 → 15 → 30 → 40 for each side', () => {
    const displays = ['P', 'PP', 'PPP', 'PPPO', 'PPPOO'].map((seq) => {
      const s = calculateGameScore(singles, points(seq))
      return `${s.playerDisplay}–${s.opponentDisplay}`
    })
    expect(displays).toEqual(['15–0', '30–0', '40–0', '40–15', '40–30'])
  })

  it.each([
    ['40–0', 'PPP'],
    ['40–15', 'PPPO'],
    ['40–30', 'PPPOO'],
  ])('wins the Game from %s with the next point (§6.1)', (_label, seq) => {
    const score = calculateGameScore(singles, points(seq + 'P'))
    expect(score.winner).toBe('player')
    expect(lastHistory(score.history)).toBe('GAME · Ardi')
  })

  it('works the same way for the opponent side', () => {
    const score = calculateGameScore(singles, points('PPOOOO'))
    expect(score.winner).toBe('opponent')
    expect(lastHistory(score.history)).toBe('GAME · Sinner')
  })

  it('records one history entry per point, numbered from 1', () => {
    const score = calculateGameScore(singles, points('POPPP'))
    expect(score.history).toEqual([
      { number: 1, text: '15–0' },
      { number: 2, text: '15–15' },
      { number: 3, text: '30–15' },
      { number: 4, text: '40–15' },
      { number: 5, text: 'GAME · Ardi' },
    ])
  })

  it('ends a completed Game with GAME, never a point score like 15–40 (§11 terminology)', () => {
    const score = calculateGameScore(singles, points('POOOO'))
    expect(lastHistory(score.history)).toBe('GAME · Sinner')
    expect(score.history.map((h) => h.text)).not.toContain('15–40 · GAME')
  })

  it('uses team names in Doubles history', () => {
    const score = calculateGameScore(doubles, points('PPPP'))
    expect(lastHistory(score.history)).toBe('GAME · Ardi / Max')
  })

  it('ignores points recorded after the Game is already won', () => {
    const won = calculateGameScore(singles, points('PPPP'))
    const extra = calculateGameScore(singles, points('PPPP OOOO'))
    expect(extra).toEqual(won)
  })
})

describe('Unlimited Deuce (§6.2)', () => {
  it('enters Deuce at 40–40 and shows 40 / 40 (§6.4)', () => {
    const score = calculateGameScore(singles, deuces(1))
    expect(score).toMatchObject({
      status: 'deuce',
      playerDisplay: '40',
      opponentDisplay: '40',
      deuceCount: 1,
      advantage: null,
      winner: null,
    })
    expect(lastHistory(score.history)).toBe('40–40 · Deuce #1')
  })

  it('gives Advantage to the side that wins the point after Deuce, keeping 40 / 40 on screen', () => {
    const score = calculateGameScore(singles, [...deuces(1), 'opponent'])
    expect(score).toMatchObject({
      status: 'advantage',
      advantage: 'opponent',
      playerDisplay: '40',
      opponentDisplay: '40',
      winner: null,
    })
    expect(lastHistory(score.history)).toBe('ADV · Sinner')
  })

  it('wins the Game from Advantage', () => {
    const score = calculateGameScore(singles, [...deuces(1), 'player', 'player'])
    expect(score.winner).toBe('player')
  })

  it('returns to Deuce and increments the count when the Advantage side loses the point', () => {
    const score = calculateGameScore(singles, deuces(2))
    expect(score.status).toBe('deuce')
    expect(score.deuceCount).toBe(2)
    expect(lastHistory(score.history)).toBe('40–40 · Deuce #2')
  })

  it('can repeat Deuce indefinitely', () => {
    const score = calculateGameScore(singles, deuces(50))
    expect(score.deuceCount).toBe(50)
    expect(score.winner).toBeNull()
    expect(score.suddenDeath).toBe(false)
    expect(calculateGameScore(singles, [...deuces(50), 'opponent', 'opponent']).winner).toBe('opponent')
  })
})

describe('Limited Deuce (§6.3)', () => {
  const limited = (maxDeuce: number) => makeConfig({ deuceMode: 'limited', maxDeuce })

  it('matches the spec example: max 4 → Deuce #4 → next point wins', () => {
    const config = limited(4)

    const atThird = calculateGameScore(config, deuces(3))
    expect(atThird.suddenDeath).toBe(false)
    expect(calculateGameScore(config, [...deuces(3), 'player']).status).toBe('advantage')

    const atFourth = calculateGameScore(config, deuces(4))
    expect(atFourth.deuceCount).toBe(4)
    expect(atFourth.suddenDeath).toBe(true)
    expect(lastHistory(atFourth.history)).toBe('40–40 · Deuce #4 · Final Deuce')

    const decided = calculateGameScore(config, [...deuces(4), 'opponent'])
    expect(decided.winner).toBe('opponent')
    expect(decided.advantage).toBeNull()
    expect(lastHistory(decided.history)).toBe('GAME · Sinner · Sudden Death')
  })

  it.each(Array.from({ length: 10 }, (_, i) => i + 1))(
    'with max %i Deuce(s): Advantage works before the final Deuce, then the next point wins',
    (max) => {
      const config = limited(max)
      for (let n = 1; n < max; n += 1) {
        const s = calculateGameScore(config, deuces(n))
        expect(s.suddenDeath).toBe(false)
        expect(calculateGameScore(config, [...deuces(n), 'player']).advantage).toBe('player')
      }
      expect(calculateGameScore(config, deuces(max)).suddenDeath).toBe(true)
      for (const side of ['player', 'opponent'] as const) {
        expect(calculateGameScore(config, [...deuces(max), side]).winner).toBe(side)
      }
    },
  )

  it('does not limit anything when the mode is Unlimited, whatever maxDeuce says', () => {
    const config = makeConfig({ deuceMode: 'unlimited', maxDeuce: 1 })
    expect(calculateGameScore(config, deuces(5)).suddenDeath).toBe(false)
  })
})

describe('Game scoring — invariants over random point sequences', () => {
  const configArb = fc.record({
    deuceMode: fc.constantFrom<DeuceMode>('unlimited', 'limited'),
    maxDeuce: fc.integer({ min: 1, max: 10 }),
  }).map((o) => makeConfig(o))

  it('undoing the last point restores exactly the previous state (§10.4)', () => {
    fc.assert(fc.property(configArb, eventsArb, (config, events) => {
      const full = calculateGameScore(config, events)
      const prefixLength = Math.min(events.length, full.history.length)
      for (let k = 0; k < prefixLength; k += 1) {
        const before = calculateGameScore(config, events.slice(0, k))
        expect(before.history).toEqual(full.history.slice(0, k))
        expect(before.deuceCount).toBeLessThanOrEqual(full.deuceCount)
      }
    }))
  })

  it('a won Game always ends with exactly one GAME entry, as the last entry', () => {
    fc.assert(fc.property(configArb, eventsArb, (config, events) => {
      const score = calculateGameScore(config, events)
      const gameEntries = score.history.filter((h) => h.text.startsWith('GAME'))
      if (score.winner) {
        expect(gameEntries).toHaveLength(1)
        expect(lastHistory(score.history)?.startsWith('GAME')).toBe(true)
      } else {
        expect(gameEntries).toHaveLength(0)
      }
    }))
  })

  it('without sudden death, a winner has at least 4 points and leads by at least 2 (exactly 2 after Deuce)', () => {
    fc.assert(fc.property(configArb, eventsArb, (config, events) => {
      const s = calculateGameScore(config, events)
      if (!s.winner || s.suddenDeath) return
      const [mine, theirs] = s.winner === 'player'
        ? [s.playerPoints, s.opponentPoints]
        : [s.opponentPoints, s.playerPoints]
      expect(mine).toBeGreaterThanOrEqual(4)
      expect(mine - theirs).toBeGreaterThanOrEqual(2)
      if (mine > 4) expect(mine - theirs).toBe(2)
    }))
  })

  it('Limited Deuce never exceeds the configured maximum', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 10 }), eventsArb, (maxDeuce, events) => {
      const config = makeConfig({ deuceMode: 'limited', maxDeuce })
      expect(calculateGameScore(config, events).deuceCount).toBeLessThanOrEqual(maxDeuce)
    }))
  })

  it('is symmetric: swapping who won each point swaps the result', () => {
    fc.assert(fc.property(configArb, eventsArb, (config, events) => {
      const a = calculateGameScore(config, events)
      const b = calculateGameScore(config, swapSides(events))
      expect(b.playerPoints).toBe(a.opponentPoints)
      expect(b.opponentPoints).toBe(a.playerPoints)
      expect(b.deuceCount).toBe(a.deuceCount)
      expect(b.status).toBe(a.status)
      expect(b.winner).toBe(a.winner && (a.winner === 'player' ? 'opponent' : 'player'))
    }))
  })
})

describe('Final Tie-Break (§9)', () => {
  const tb = (
    tieBreakMaxPoint: number,
    tieBreakMargin: 1 | 2,
    tieBreakEqualResolution: TieBreakEqualResolution = 'unlimited',
    mode: SessionConfig['mode'] = 'single',
  ) => makeConfig({ tieBreakMaxPoint, tieBreakMargin, tieBreakEqualResolution, mode })

  /** Alternating points to reach n–n, starting with the player. */
  const level = (n: number) => points('PO'.repeat(n))

  it('counts numeric points from 0–0', () => {
    const score = calculateTieBreak(tb(7, 2), points('PPO'))
    expect(score).toMatchObject({ playerPoints: 2, opponentPoints: 1, winner: null, draw: false, status: 'normal' })
    expect(score.history.map((h) => h.text)).toEqual(['1–0', '2–0', '2–1'])
  })

  it('target 7, margin 1: 7–6 wins (§9.2)', () => {
    const score = calculateTieBreak(tb(7, 1), [...level(6), 'player'])
    expect(score).toMatchObject({ playerPoints: 7, opponentPoints: 6, winner: 'player', status: 'complete' })
    expect(lastHistory(score.history)).toBe('7–6 · Ardi wins')
  })

  it('target 7, margin 2: 7–6 continues to 7–7 (§9.2, margin is binding at the target)', () => {
    const at76 = calculateTieBreak(tb(7, 2), [...level(6), 'player'])
    expect(at76.winner).toBeNull()
    expect(at76.status).toBe('normal')
    expect(calculateTieBreak(tb(7, 2), level(7)).winner).toBeNull()
  })

  it('target 7, margin 2: 7–5 wins, and 8–6 after 7–6 wins', () => {
    expect(calculateTieBreak(tb(7, 2), points('PPPPP OOOOO PP')).winner).toBe('player')
    expect(calculateTieBreak(tb(7, 2), [...level(6), 'opponent', 'opponent']).winner).toBe('opponent')
  })

  it('a clean 7–0 wins for either side', () => {
    expect(calculateTieBreak(tb(7, 2), points('PPPPPPP')).winner).toBe('player')
    expect(calculateTieBreak(tb(7, 2), points('OOOOOOO')).winner).toBe('opponent')
  })

  describe('equal at the target (§9.1)', () => {
    it('Unlimited: continues until the margin is reached', () => {
      const config = tb(7, 2, 'unlimited')
      const at77 = calculateTieBreak(config, level(7))
      expect(at77.status).toBe('at-cap-unlimited')
      expect(lastHistory(at77.history)).toBe('7–7 · Continue until 2-point margin')

      const at87 = calculateTieBreak(config, [...level(7), 'player'])
      expect(at87.winner).toBeNull()
      expect(at87.status).toBe('at-cap-unlimited')

      const back88 = calculateTieBreak(config, [...level(8)])
      expect(back88.winner).toBeNull()

      const long = calculateTieBreak(config, [...level(20), 'opponent', 'opponent'])
      expect(long).toMatchObject({ playerPoints: 20, opponentPoints: 22, winner: 'opponent', status: 'complete' })
    })

    it('Sudden Death: the next point wins and is counted in the score', () => {
      const config = tb(7, 2, 'sudden-death')
      const at77 = calculateTieBreak(config, level(7))
      expect(at77.status).toBe('at-cap-sudden-death')
      expect(lastHistory(at77.history)).toBe('7–7 · Sudden Death · Next point wins')

      const decided = calculateTieBreak(config, [...level(7), 'opponent'])
      expect(decided).toMatchObject({ playerPoints: 7, opponentPoints: 8, winner: 'opponent', status: 'complete' })
      expect(lastHistory(decided.history)).toBe('7–8 · Sinner wins · Sudden Death')
    })

    it('Make it Draw: ends as a Draw at the target', () => {
      const score = calculateTieBreak(tb(7, 2, 'draw'), level(7))
      expect(score).toMatchObject({ draw: true, winner: null, status: 'draw', playerPoints: 7, opponentPoints: 7 })
      expect(lastHistory(score.history)).toBe('7–7 · DRAW')
    })

    it.each<TieBreakEqualResolution>(['unlimited', 'sudden-death', 'draw'])(
      'with margin 1, the "%s" choice is never reached because target–(target-1) already wins',
      (resolution) => {
        const config = tb(7, 1, resolution)
        expect(calculateTieBreak(config, [...level(6), 'opponent']).winner).toBe('opponent')
        expect(calculateTieBreak(config, level(7)).status).toBe('complete')
      },
    )
  })

  describe.each([5, 6, 7, 8, 9, 10])('target %i', (target) => {
    it.each<1 | 2>([1, 2])('margin %i: first to the target with the margin wins', (margin) => {
      const config = tb(target, margin, 'draw')
      const clean = calculateTieBreak(config, points('P'.repeat(target)))
      expect(clean.winner).toBe('player')
      expect(clean.playerPoints).toBe(target)

      const close = calculateTieBreak(config, [...level(target - 1), 'player'])
      if (margin === 1) {
        expect(close.winner).toBe('player')
      } else {
        expect(close.winner).toBeNull()
        expect(calculateTieBreak(config, level(target)).draw).toBe(true)
      }
    })
  })

  it('ignores points recorded after the Tie-Break is decided', () => {
    const config = tb(7, 2, 'draw')
    expect(calculateTieBreak(config, [...level(7), 'player', 'player'])).toEqual(calculateTieBreak(config, level(7)))
    const won = points('PPPPPPP')
    expect(calculateTieBreak(config, [...won, 'opponent'])).toEqual(calculateTieBreak(config, won))
  })

  it('uses team names in Doubles', () => {
    const score = calculateTieBreak(tb(5, 2, 'unlimited', 'double'), points('PPPPP'))
    expect(lastHistory(score.history)).toBe('5–0 · Ardi / Max wins')
  })

  describe('invariants over random point sequences', () => {
    const tbConfigArb = fc.record({
      tieBreakMaxPoint: fc.integer({ min: 5, max: 10 }),
      tieBreakMargin: fc.constantFrom<1 | 2>(1, 2),
      tieBreakEqualResolution: fc.constantFrom<TieBreakEqualResolution>('unlimited', 'sudden-death', 'draw'),
    }).map((o) => makeConfig(o))

    it('undoing the last point restores exactly the previous state (§10.4)', () => {
      fc.assert(fc.property(tbConfigArb, eventsArb, (config, events) => {
        const full = calculateTieBreak(config, events)
        for (let k = 0; k < full.history.length; k += 1) {
          expect(calculateTieBreak(config, events.slice(0, k)).history).toEqual(full.history.slice(0, k))
        }
      }))
    })

    it('a winner has reached the target and leads by the margin (or won a sudden-death point)', () => {
      fc.assert(fc.property(tbConfigArb, eventsArb, (config, events) => {
        const s = calculateTieBreak(config, events)
        if (!s.winner) return
        const [mine, theirs] = s.winner === 'player'
          ? [s.playerPoints, s.opponentPoints]
          : [s.opponentPoints, s.playerPoints]
        expect(mine).toBeGreaterThanOrEqual(config.tieBreakMaxPoint)
        const suddenDeathWin = config.tieBreakEqualResolution === 'sudden-death'
          && theirs === config.tieBreakMaxPoint && mine === theirs + 1
        if (!suddenDeathWin) expect(mine - theirs).toBeGreaterThanOrEqual(config.tieBreakMargin)
        expect(s.draw).toBe(false)
      }))
    })

    it('a Draw only happens with "Make it Draw", level exactly at the target', () => {
      fc.assert(fc.property(tbConfigArb, eventsArb, (config, events) => {
        const s = calculateTieBreak(config, events)
        if (!s.draw) return
        expect(config.tieBreakEqualResolution).toBe('draw')
        expect(s.playerPoints).toBe(config.tieBreakMaxPoint)
        expect(s.opponentPoints).toBe(config.tieBreakMaxPoint)
      }))
    })

    it('is symmetric: swapping who won each point swaps the result', () => {
      fc.assert(fc.property(tbConfigArb, eventsArb, (config, events) => {
        const a = calculateTieBreak(config, events)
        const b = calculateTieBreak(config, swapSides(events))
        expect([b.playerPoints, b.opponentPoints]).toEqual([a.opponentPoints, a.playerPoints])
        expect(b.draw).toBe(a.draw)
        expect(b.status).toBe(a.status)
      }))
    })
  })
})
