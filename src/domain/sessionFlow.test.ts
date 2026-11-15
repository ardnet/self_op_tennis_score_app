import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  addGamePoint,
  addTieBreakPoint,
  createMatchState,
  isFinalTieBreakPending,
  pause,
  reopenLastCompletedGame,
  resetProgress,
  restoreMatchState,
  resume,
  segmentElapsed,
  sessionElapsed,
  setStopConfirm,
  startFinalTieBreak,
  startMatch,
  startNextGame,
  undoFromResult,
  undoPoint,
} from './sessionFlow'
import type { FlowEffect, FlowResult, MatchState } from './sessionFlow'
import { gamesTally, pointWinnerForCall } from './session'
import type { SessionConfig, Side } from './types'
import { makeConfig, points } from './testUtils'

/*
 * Section numbers refer to "Self-Operated Tennis Score — Product Requirements /
 * UI/UX Specification" (consolidated reference, 10 November 2026).
 *
 * Time is passed in explicitly, so these tests use simple numbers (ms) as the clock.
 */

const SEC = 1000
const LOVE_GAME_P = points('PPPP')
const LOVE_GAME_O = points('OOOO')

/** Plays points into the current Game, each `step` ms after the previous one. */
function play(config: SessionConfig, state: MatchState, events: Side[], start: number, step = 0) {
  let current = state
  const effects: FlowEffect[] = []
  events.forEach((side, i) => {
    const result = addGamePoint(config, current, side, start + i * step)
    current = result.state
    effects.push(...result.effects)
  })
  return { state: current, effects }
}

function playTieBreak(config: SessionConfig, state: MatchState, events: Side[], now: number) {
  let current = state
  const effects: FlowEffect[] = []
  for (const side of events) {
    const result: FlowResult = addTieBreakPoint(config, current, side, now)
    current = result.state
    effects.push(...result.effects)
  }
  return { state: current, effects }
}

/** Plays whole Games (love Games), continuing from the between-Game screen each time. */
function playGames(config: SessionConfig, winners: Side[], now = 0) {
  let state = startMatch(createMatchState('server'), now)
  const effects: FlowEffect[] = []
  winners.forEach((winner, i) => {
    if (i > 0) state = startNextGame(state, now)
    const result = play(config, state, winner === 'player' ? LOVE_GAME_P : LOVE_GAME_O, now)
    state = result.state
    effects.push(...result.effects)
  })
  return { state, effects }
}

describe('IN / OUT (§3, §8.3)', () => {
  it('IN awards the point to the serving side, OUT to the receiving side', () => {
    expect(pointWinnerForCall('player', 'in')).toBe('player')
    expect(pointWinnerForCall('player', 'out')).toBe('opponent')
    expect(pointWinnerForCall('opponent', 'in')).toBe('opponent')
    expect(pointWinnerForCall('opponent', 'out')).toBe('player')
  })
})

describe('starting a match', () => {
  it('LET\'S PLAY starts Game 1 with the timers running from zero', () => {
    const dirty = { ...createMatchState('server'), completedGames: playGames(makeConfig(), ['player']).state.completedGames }
    const state = startMatch(dirty, 5 * SEC)
    expect(state).toMatchObject({
      screen: 'live',
      currentGameIndex: 0,
      completedGames: [],
      currentGameEvents: [],
      activeSegment: 'game',
      activeStartedAt: 5 * SEC,
      sessionElapsedBeforeRun: 0,
      segmentElapsedBeforeRun: 0,
      paused: false,
      outcome: null,
    })
  })

  it('resetProgress clears the match but keeps the current screen', () => {
    const played = playGames(makeConfig(), ['player', 'opponent']).state
    expect(resetProgress(played)).toEqual(createMatchState(played.screen))
  })
})

describe('scoring points within a Game', () => {
  it('records each point and stays on the live screen until the Game is won', () => {
    const config = makeConfig()
    const { state, effects } = play(config, startMatch(createMatchState(), 0), points('PPP'), 0)
    expect(state.screen).toBe('live')
    expect(state.currentGameEvents).toEqual(points('PPP'))
    expect(state.completedGames).toEqual([])
    expect(effects).toEqual([])
  })

  it('winning a Game records it with its number, server, points and duration, then shows the break screen', () => {
    const config = makeConfig({ totalGames: 4 })
    const { state, effects } = play(config, startMatch(createMatchState(), 0), LOVE_GAME_O, 0, 10 * SEC)
    expect(state.screen).toBe('between')
    expect(state.completedGames).toEqual([
      { gameNumber: 1, server: 'player1', events: LOVE_GAME_O, winner: 'opponent', durationMs: 30 * SEC },
    ])
    expect(state.activeSegment).toBeNull()
    expect(state.activeStartedAt).toBeNull()
    expect(effects).toEqual([
      { type: 'game_completed', record: state.completedGames[0], deuceCount: 0 },
    ])
  })

  it('reports how many Deuces a completed Game had', () => {
    const config = makeConfig()
    const { effects } = play(config, startMatch(createMatchState(), 0), points('PPPOOO PO PP'), 0)
    expect(effects[0]).toMatchObject({ type: 'game_completed', deuceCount: 2 })
  })

  it('CONTINUE TO GAME N starts the next Game with the next server', () => {
    const config = makeConfig({ totalGames: 4 })
    const afterGame1 = play(config, startMatch(createMatchState(), 0), LOVE_GAME_P, 0).state
    const game2 = startNextGame(afterGame1, 60 * SEC)
    expect(game2).toMatchObject({
      screen: 'live',
      currentGameIndex: 1,
      currentGameEvents: [],
      activeSegment: 'game',
      activeStartedAt: 60 * SEC,
      segmentElapsedBeforeRun: 0,
    })
    const afterGame2 = play(config, game2, LOVE_GAME_P, 60 * SEC).state
    expect(afterGame2.completedGames[1]).toMatchObject({ gameNumber: 2, server: 'opponent1' })
  })
})

describe('session ending (§7, §11.1)', () => {
  it('ends after exactly the configured number of Games, even if the margin is not met (§7.1)', () => {
    const config = makeConfig({ totalGames: 7, gameLeadMargin: 2 })
    const { state } = playGames(config, ['player', 'player', 'player', 'player', 'opponent', 'opponent', 'opponent'])
    expect(gamesTally(state.completedGames)).toEqual({ player: 4, opponent: 3 })
    expect(state.screen).toBe('result')
    expect(state.outcome).toEqual({ winner: 'player', draw: false, decidedBy: 'games' })
  })

  it('does not end early when one side can no longer be caught', () => {
    const config = makeConfig({ totalGames: 4 })
    const { state } = playGames(config, ['opponent', 'opponent', 'opponent'])
    expect(state.screen).toBe('between')
    expect(state.outcome).toBeNull()
  })

  it.each([2, 3, 4, 5, 6, 7, 8, 9, 10])('with %i Games, the result comes after the last Game only', (total) => {
    const config = makeConfig({ totalGames: total, gamesTieResolution: 'draw' })
    const winners = Array.from({ length: total }, (_, i): Side => (i === 0 ? 'player' : 'opponent'))
    for (let n = 1; n <= total; n += 1) {
      const { state } = playGames(config, winners.slice(0, n))
      expect(state.screen).toBe(n < total ? 'between' : 'result')
    }
  })

  it('reports match completion with Games played, Draw flag and active duration', () => {
    const config = makeConfig({ totalGames: 2, gamesTieResolution: 'draw' })
    let state = startMatch(createMatchState(), 0)
    state = play(config, state, LOVE_GAME_P, 0, 5 * SEC).state
    state = startNextGame(state, 100 * SEC)
    const { effects } = play(config, state, LOVE_GAME_O, 100 * SEC, 5 * SEC)
    expect(effects.at(-1)).toEqual({
      type: 'match_completed',
      gamesPlayed: 2,
      usedTieBreak: false,
      draw: true,
      durationMs: 30 * SEC,
    })
  })

  describe('tied Games (§7.2)', () => {
    it('"Finish as DRAW" ends the session as a Draw', () => {
      const config = makeConfig({ totalGames: 4, gamesTieResolution: 'draw' })
      const { state } = playGames(config, ['player', 'opponent', 'player', 'opponent'])
      expect(state.screen).toBe('result')
      expect(state.outcome).toEqual({ winner: null, draw: true, decidedBy: 'games-draw' })
      expect(isFinalTieBreakPending(config, state)).toBe(false)
    })

    it('"Use Tie-Break" waits on the break screen with a Final Tie-Break pending', () => {
      const config = makeConfig({ totalGames: 4, gamesTieResolution: 'tiebreak' })
      const { state, effects } = playGames(config, ['player', 'opponent', 'player', 'opponent'])
      expect(state.screen).toBe('between')
      expect(state.outcome).toBeNull()
      expect(isFinalTieBreakPending(config, state)).toBe(true)
      expect(effects.some((e) => e.type === 'match_completed')).toBe(false)
    })

    it('no Tie-Break is pending while Games remain, or when the Games are not tied', () => {
      const config = makeConfig({ totalGames: 4, gamesTieResolution: 'tiebreak' })
      expect(isFinalTieBreakPending(config, playGames(config, ['player', 'opponent']).state)).toBe(false)
      expect(isFinalTieBreakPending(config, playGames(config, ['player', 'player', 'player', 'opponent']).state)).toBe(false)
    })
  })
})

describe('Final Tie-Break flow (§9, §11.1)', () => {
  const config = makeConfig({ totalGames: 2, gamesTieResolution: 'tiebreak', tieBreakMaxPoint: 7, tieBreakMargin: 2 })
  const tiedAfterGames = () => playGames(config, ['player', 'opponent'], 0).state

  it('starts the Tie-Break with its own timer', () => {
    const state = startFinalTieBreak(tiedAfterGames(), 50 * SEC)
    expect(state).toMatchObject({
      screen: 'tiebreak-live',
      activeSegment: 'tiebreak',
      activeStartedAt: 50 * SEC,
      segmentElapsedBeforeRun: 0,
      tieBreakEvents: [],
      tieBreakRecord: null,
    })
  })

  it('a Tie-Break winner wins the session', () => {
    const start = startFinalTieBreak(tiedAfterGames(), 0)
    const { state, effects } = playTieBreak(config, start, points('OOOOOOO'), 20 * SEC)
    expect(state.screen).toBe('result')
    expect(state.outcome).toEqual({ winner: 'opponent', draw: false, decidedBy: 'tiebreak' })
    expect(state.tieBreakRecord).toEqual({ events: points('OOOOOOO'), durationMs: 20 * SEC, winner: 'opponent', draw: false })
    expect(effects).toEqual([
      { type: 'match_completed', gamesPlayed: 2, usedTieBreak: true, draw: false, durationMs: 20 * SEC },
    ])
  })

  it('a Tie-Break Draw ends the session as a Draw', () => {
    const drawConfig = { ...config, tieBreakEqualResolution: 'draw' as const }
    const start = startFinalTieBreak(playGames(drawConfig, ['player', 'opponent']).state, 0)
    const { state } = playTieBreak(drawConfig, start, points('PO'.repeat(7)), 0)
    expect(state.outcome).toEqual({ winner: null, draw: true, decidedBy: 'tiebreak-draw' })
    expect(state.tieBreakRecord?.draw).toBe(true)
  })

  it('stays live until decided', () => {
    const start = startFinalTieBreak(tiedAfterGames(), 0)
    const { state, effects } = playTieBreak(config, start, points('PPPOOO'), 0)
    expect(state.screen).toBe('tiebreak-live')
    expect(state.tieBreakEvents).toHaveLength(6)
    expect(effects).toEqual([])
  })
})

describe('timers, pause and breaks (§10.1–10.3)', () => {
  const config = makeConfig({ totalGames: 3 })

  it('Session and Game timers run together during play', () => {
    const state = startMatch(createMatchState(), 0)
    expect(sessionElapsed(state, 90 * SEC)).toBe(90 * SEC)
    expect(segmentElapsed(state, 90 * SEC)).toBe(90 * SEC)
  })

  it('PAUSE freezes both timers; CONTINUE resumes them without counting the pause', () => {
    let state = startMatch(createMatchState(), 0)
    state = pause(state, 60 * SEC)
    expect(state).toMatchObject({ screen: 'pause', paused: true, activeStartedAt: null })
    expect(sessionElapsed(state, 600 * SEC)).toBe(60 * SEC)
    expect(segmentElapsed(state, 600 * SEC)).toBe(60 * SEC)

    state = resume(state, 600 * SEC)
    expect(state).toMatchObject({ screen: 'live', paused: false, activeStartedAt: 600 * SEC })
    expect(sessionElapsed(state, 630 * SEC)).toBe(90 * SEC)
  })

  it('CONTINUE returns to the Tie-Break screen when the Tie-Break was paused', () => {
    const tbConfig = makeConfig({ totalGames: 2 })
    let state = startFinalTieBreak(playGames(tbConfig, ['player', 'opponent']).state, 0)
    state = resume(pause(state, 10 * SEC), 20 * SEC)
    expect(state.screen).toBe('tiebreak-live')
  })

  it('pausing clears a pending Stop confirmation, and Stop can be requested and cancelled', () => {
    let state = startMatch(createMatchState(), 0)
    state = setStopConfirm(pause(state, 0), true)
    expect(state.stopConfirm).toBe(true)
    expect(setStopConfirm(state, false).stopConfirm).toBe(false)
    expect(resume(state, 0).stopConfirm).toBe(false)
  })

  it('the break between Games is not counted in the session time', () => {
    let state = startMatch(createMatchState(), 0)
    state = play(config, state, LOVE_GAME_P, 0, 10 * SEC).state // Game 1 takes 30 s
    expect(sessionElapsed(state, 500 * SEC)).toBe(30 * SEC)
    state = startNextGame(state, 500 * SEC) // 470 s break
    expect(sessionElapsed(state, 520 * SEC)).toBe(50 * SEC)
    expect(segmentElapsed(state, 520 * SEC)).toBe(20 * SEC)
  })

  it('a paused Game still records its active duration when won later', () => {
    let state = startMatch(createMatchState(), 0)
    state = play(config, state, points('PPP'), 0, 10 * SEC).state // last point at 20 s
    state = pause(state, 25 * SEC)
    state = resume(state, 300 * SEC)
    state = addGamePoint(config, state, 'player', 305 * SEC).state
    expect(state.completedGames[0].durationMs).toBe(30 * SEC)
    expect(state.sessionElapsedBeforeRun).toBe(30 * SEC)
  })

  it('the session timer adds up Games and the Tie-Break, excluding breaks', () => {
    const tbConfig = makeConfig({ totalGames: 2 })
    let state = startMatch(createMatchState(), 0)
    state = play(tbConfig, state, LOVE_GAME_P, 0, 10 * SEC).state // 30 s
    state = startNextGame(state, 100 * SEC)
    state = play(tbConfig, state, LOVE_GAME_O, 100 * SEC, 10 * SEC).state // 30 s
    state = startFinalTieBreak(state, 200 * SEC)
    const { state: done, effects } = playTieBreak(tbConfig, state, points('PPPPPPP'), 245 * SEC) // 45 s
    expect(done.tieBreakRecord?.durationMs).toBe(45 * SEC)
    expect(done.sessionElapsedBeforeRun).toBe(105 * SEC)
    expect(effects.at(-1)).toMatchObject({ durationMs: 105 * SEC })
  })
})

describe('Undo (§10.4)', () => {
  const config = makeConfig({ totalGames: 3 })

  it('removes the last point of the current Game', () => {
    const state = play(config, startMatch(createMatchState(), 0), points('PPO'), 0).state
    const { state: undone, effects } = undoPoint(state)
    expect(undone.currentGameEvents).toEqual(points('PP'))
    expect(effects).toEqual([{ type: 'undo', stage: 'game' }])
  })

  it('does nothing (and reports nothing) when there is no point to undo', () => {
    const state = startMatch(createMatchState(), 0)
    expect(undoPoint(state)).toEqual({ state, effects: [] })
  })

  it('removes the last point of the Tie-Break when the Tie-Break is in progress', () => {
    const tbConfig = makeConfig({ totalGames: 2 })
    let state = startFinalTieBreak(playGames(tbConfig, ['player', 'opponent']).state, 0)
    state = playTieBreak(tbConfig, state, points('PO'), 0).state
    const { state: undone, effects } = undoPoint(state)
    expect(undone.tieBreakEvents).toEqual(points('P'))
    expect(effects).toEqual([{ type: 'undo', stage: 'tiebreak' }])
    expect(undoPoint(startFinalTieBreak(playGames(tbConfig, ['player', 'opponent']).state, 0)).effects).toEqual([])
  })

  it('reopens a just-completed Game without its winning point', () => {
    const won = play(config, startMatch(createMatchState(), 0), points('PPOPP'), 0).state
    expect(won.screen).toBe('between')
    const reopened = reopenLastCompletedGame(won, 10 * SEC)
    expect(reopened).toMatchObject({
      screen: 'live',
      completedGames: [],
      currentGameIndex: 0,
      currentGameEvents: points('PPOP'),
      activeSegment: 'game',
      activeStartedAt: 10 * SEC,
    })
  })

  it('reopening then re-winning a Game gives the same Games result as before', () => {
    const won = play(config, startMatch(createMatchState(), 0), points('OOOO'), 0).state
    const again = addGamePoint(config, reopenLastCompletedGame(won, 0), 'opponent', 0).state
    expect(again.completedGames.map((g) => [g.gameNumber, g.winner])).toEqual([[1, 'opponent']])
    expect(again.screen).toBe('between')
  })

  it('Undo on the result screen reopens the final Game and clears the result', () => {
    const finished = playGames(config, ['player', 'player', 'opponent']).state
    expect(finished.screen).toBe('result')
    const reopened = undoFromResult(finished, 0)
    expect(reopened).toMatchObject({ screen: 'live', outcome: null, currentGameIndex: 2, completedGames: finished.completedGames.slice(0, 2) })
  })

  it('Undo on the result screen reopens the Final Tie-Break without its last point', () => {
    const tbConfig = makeConfig({ totalGames: 2 })
    let state = startFinalTieBreak(playGames(tbConfig, ['player', 'opponent']).state, 0)
    state = playTieBreak(tbConfig, state, points('PPPPPPP'), 0).state
    const reopened = undoFromResult(state, 0)
    expect(reopened).toMatchObject({
      screen: 'tiebreak-live',
      activeSegment: 'tiebreak',
      outcome: null,
      tieBreakRecord: null,
      tieBreakEvents: points('PPPPPP'),
      completedGames: state.completedGames,
    })
  })

  it('reopening with no completed Game changes nothing', () => {
    const state = startMatch(createMatchState(), 0)
    expect(reopenLastCompletedGame(state, 0)).toBe(state)
  })

  it('re-winning a reopened Game counts its time once in both timers', () => {
    const won = play(config, startMatch(createMatchState(), 0), points('PPP'), 0, 10 * SEC).state
    let state = addGamePoint(config, won, 'player', 30 * SEC).state // 30 s Game
    state = reopenLastCompletedGame(state, 100 * SEC)
    state = addGamePoint(config, state, 'player', 105 * SEC).state
    expect(state.completedGames[0].durationMs).toBe(35 * SEC)
    expect(state.sessionElapsedBeforeRun).toBe(35 * SEC)
  })

  it('the reopened Game keeps its earlier duration on the Game timer', () => {
    const won = play(config, startMatch(createMatchState(), 0), LOVE_GAME_P, 0, 10 * SEC).state // 30 s
    const reopened = reopenLastCompletedGame(won, 100 * SEC)
    expect(segmentElapsed(reopened, 110 * SEC)).toBe(40 * SEC)
  })

  it('reopening a Game keeps the session time it already had', () => {
    const won = play(config, startMatch(createMatchState(), 0), LOVE_GAME_P, 0, 10 * SEC).state // 30 s
    expect(sessionElapsed(won, 100 * SEC)).toBe(30 * SEC)
    const reopened = reopenLastCompletedGame(won, 100 * SEC)
    expect(sessionElapsed(reopened, 110 * SEC)).toBe(40 * SEC)
  })

  it('reopening the Final Tie-Break keeps the session time it already had', () => {
    const tbConfig = makeConfig({ totalGames: 2 })
    let state = playGames(tbConfig, ['player', 'opponent'], 0).state // Games take 0 s
    state = startFinalTieBreak(state, 0)
    state = playTieBreak(tbConfig, state, points('PPPPPPP'), 60 * SEC).state // 60 s
    const reopened = undoFromResult(state, 100 * SEC)
    expect(sessionElapsed(reopened, 100 * SEC)).toBe(60 * SEC)
  })
})

describe('saved state (localStorage)', () => {
  it('restores a saved match exactly', () => {
    const saved = playGames(makeConfig({ totalGames: 3 }), ['player', 'opponent']).state
    expect(restoreMatchState({ ...saved, config: makeConfig() })).toEqual(saved)
  })

  it('starts fresh when nothing was saved, and fills in missing fields', () => {
    expect(restoreMatchState(null)).toEqual(createMatchState())
    expect(restoreMatchState({ screen: 'games' })).toEqual(createMatchState('games'))
  })
})

describe('whole-session invariants over random matches', () => {
  const configArb = fc.record({
    totalGames: fc.integer({ min: 2, max: 10 }),
    gamesTieResolution: fc.constantFrom<'draw' | 'tiebreak'>('draw', 'tiebreak'),
    deuceMode: fc.constantFrom<'unlimited' | 'limited'>('unlimited', 'limited'),
    maxDeuce: fc.integer({ min: 1, max: 10 }),
    tieBreakMaxPoint: fc.integer({ min: 5, max: 10 }),
    tieBreakMargin: fc.constantFrom<1 | 2>(1, 2),
    tieBreakEqualResolution: fc.constantFrom<'unlimited' | 'sudden-death' | 'draw'>('unlimited', 'sudden-death', 'draw'),
  }).map((o) => makeConfig(o))

  /** Drives a whole session from point winners, pressing Continue whenever the break screen appears. */
  function simulate(config: SessionConfig, winners: Side[]) {
    let state = startMatch(createMatchState(), 0)
    let gameCompletions = 0
    let matchCompletions = 0
    for (const side of winners) {
      if (state.screen === 'result') break
      if (state.screen === 'between') {
        state = isFinalTieBreakPending(config, state) ? startFinalTieBreak(state, 0) : startNextGame(state, 0)
      }
      const result = state.screen === 'tiebreak-live'
        ? addTieBreakPoint(config, state, side, 0)
        : addGamePoint(config, state, side, 0)
      state = result.state
      gameCompletions += result.effects.filter((e) => e.type === 'game_completed').length
      matchCompletions += result.effects.filter((e) => e.type === 'match_completed').length
    }
    return { state, gameCompletions, matchCompletions }
  }

  it('never plays more than the configured Games, and reports each Game and the match exactly once', () => {
    fc.assert(fc.property(configArb, fc.array(fc.constantFrom<Side>('player', 'opponent'), { maxLength: 400 }), (config, winners) => {
      const { state, gameCompletions, matchCompletions } = simulate(config, winners)
      expect(state.completedGames.length).toBeLessThanOrEqual(config.totalGames)
      expect(gameCompletions).toBe(state.completedGames.length)
      expect(state.completedGames.map((g) => g.gameNumber)).toEqual(state.completedGames.map((_, i) => i + 1))
      expect(matchCompletions).toBe(state.outcome ? 1 : 0)
    }))
  })

  it('a finished session\'s result agrees with the Games score and the Tie-Break', () => {
    fc.assert(fc.property(configArb, fc.array(fc.constantFrom<Side>('player', 'opponent'), { minLength: 400, maxLength: 400 }), (config, winners) => {
      const { state } = simulate(config, winners)
      if (!state.outcome) return
      const tally = gamesTally(state.completedGames)
      expect(state.completedGames).toHaveLength(config.totalGames)
      if (tally.player !== tally.opponent) {
        expect(state.outcome.decidedBy).toBe('games')
        expect(state.outcome.winner).toBe(tally.player > tally.opponent ? 'player' : 'opponent')
      } else if (config.gamesTieResolution === 'draw') {
        expect(state.outcome).toEqual({ winner: null, draw: true, decidedBy: 'games-draw' })
      } else {
        expect(state.tieBreakRecord).not.toBeNull()
        expect(state.outcome.decidedBy).toBe(state.tieBreakRecord?.draw ? 'tiebreak-draw' : 'tiebreak')
        expect(state.outcome.winner).toBe(state.tieBreakRecord?.winner ?? null)
      }
    }))
  })
})
