import { calculateGameScore, calculateTieBreak } from './scoring'
import { gamesTally, serverForGame } from './session'
import type {
  ActiveSegment,
  GameRecord,
  PersistedAppState,
  Screen,
  SessionConfig,
  SessionOutcome,
  Side,
  TieBreakRecord,
} from './types'

/**
 * Match flow: how a session moves between Games, the Final Tie-Break and the
 * result, plus Undo, Pause and the active-play timers.
 *
 * Every function here is pure: it takes the current state (and the current
 * time where timers are involved) and returns the next state. The React UI
 * holds the state and calls these functions; it does not decide tennis rules.
 *
 * The state has the same shape as what is saved to localStorage
 * (PersistedAppState, minus the setup config), so saved matches keep working.
 */
export type MatchState = Omit<PersistedAppState, 'config'>

/** Things that happened during a transition, for the UI to report (e.g. analytics). */
export type FlowEffect =
  | { type: 'game_completed'; record: GameRecord; deuceCount: number }
  | { type: 'match_completed'; gamesPlayed: number; usedTieBreak: boolean; draw: boolean; durationMs: number }
  | { type: 'undo'; stage: 'game' | 'tiebreak' }

export interface FlowResult {
  state: MatchState
  effects: FlowEffect[]
}

const noEffects = (state: MatchState): FlowResult => ({ state, effects: [] })

export function createMatchState(screen: Screen = 'welcome'): MatchState {
  return {
    screen,
    completedGames: [],
    currentGameIndex: 0,
    currentGameEvents: [],
    tieBreakEvents: [],
    tieBreakRecord: null,
    paused: false,
    stopConfirm: false,
    sessionElapsedBeforeRun: 0,
    segmentElapsedBeforeRun: 0,
    activeStartedAt: null,
    activeSegment: null,
    outcome: null,
  }
}

/**
 * Rebuilds match state from what was saved in localStorage. Missing fields
 * (e.g. from an older saved version) fall back to a fresh match.
 */
export function restoreMatchState(saved: Partial<PersistedAppState> | null | undefined): MatchState {
  const fresh = createMatchState()
  if (!saved) return fresh
  return {
    screen: saved.screen ?? fresh.screen,
    completedGames: saved.completedGames ?? fresh.completedGames,
    currentGameIndex: saved.currentGameIndex ?? fresh.currentGameIndex,
    currentGameEvents: saved.currentGameEvents ?? fresh.currentGameEvents,
    tieBreakEvents: saved.tieBreakEvents ?? fresh.tieBreakEvents,
    tieBreakRecord: saved.tieBreakRecord ?? fresh.tieBreakRecord,
    paused: saved.paused ?? fresh.paused,
    stopConfirm: saved.stopConfirm ?? fresh.stopConfirm,
    sessionElapsedBeforeRun: saved.sessionElapsedBeforeRun ?? fresh.sessionElapsedBeforeRun,
    segmentElapsedBeforeRun: saved.segmentElapsedBeforeRun ?? fresh.segmentElapsedBeforeRun,
    activeStartedAt: saved.activeStartedAt ?? fresh.activeStartedAt,
    activeSegment: saved.activeSegment ?? fresh.activeSegment,
    outcome: saved.outcome ?? fresh.outcome,
  }
}

// ---------------------------------------------------------------------------
// Timers (§10.1)
// ---------------------------------------------------------------------------

/** Active time since the current run started; 0 while paused or between segments. */
export function runningDelta(state: MatchState, now: number): number {
  if (state.activeStartedAt === null || state.paused || state.activeSegment === null) return 0
  return now - state.activeStartedAt
}

/** Total active playing time for the session. Excludes pauses and between-Game breaks. */
export function sessionElapsed(state: MatchState, now: number): number {
  return state.sessionElapsedBeforeRun + runningDelta(state, now)
}

/** Active time of the current Game or Final Tie-Break. */
export function segmentElapsed(state: MatchState, now: number): number {
  return state.segmentElapsedBeforeRun + runningDelta(state, now)
}

// ---------------------------------------------------------------------------
// Derived session status (§7)
// ---------------------------------------------------------------------------

export function allGamesComplete(config: SessionConfig, state: MatchState): boolean {
  return state.completedGames.length === config.totalGames
}

/** All Games are done, the Games score is level, and the user chose a Final Tie-Break that has not been played yet. */
export function isFinalTieBreakPending(config: SessionConfig, state: MatchState): boolean {
  const tally = gamesTally(state.completedGames)
  return allGamesComplete(config, state)
    && tally.player === tally.opponent
    && config.gamesTieResolution === 'tiebreak'
    && !state.tieBreakRecord
    && !state.outcome
}

// ---------------------------------------------------------------------------
// Starting and moving between segments
// ---------------------------------------------------------------------------

/** Clears all match progress (keeps the current screen). */
export function resetProgress(state: MatchState): MatchState {
  return { ...createMatchState(state.screen) }
}

/** LET'S PLAY: start Game 1 with fresh timers. */
export function startMatch(state: MatchState, now: number): MatchState {
  return {
    ...resetProgress(state),
    currentGameIndex: 0,
    activeStartedAt: now,
    activeSegment: 'game',
    screen: 'live',
  }
}

export function beginGame(state: MatchState, gameIndex: number, now: number): MatchState {
  return {
    ...state,
    currentGameIndex: gameIndex,
    currentGameEvents: [],
    segmentElapsedBeforeRun: 0,
    paused: false,
    stopConfirm: false,
    activeStartedAt: now,
    activeSegment: 'game',
    screen: 'live',
  }
}

/** CONTINUE TO GAME N from the between-Game screen (§10.3). */
export function startNextGame(state: MatchState, now: number): MatchState {
  return beginGame(state, state.completedGames.length, now)
}

export function startFinalTieBreak(state: MatchState, now: number): MatchState {
  return {
    ...state,
    tieBreakEvents: [],
    tieBreakRecord: null,
    segmentElapsedBeforeRun: 0,
    paused: false,
    stopConfirm: false,
    activeStartedAt: now,
    activeSegment: 'tiebreak',
    screen: 'tiebreak-live',
  }
}

// ---------------------------------------------------------------------------
// Scoring points
// ---------------------------------------------------------------------------

/** Freezes the timers at the end of a Game or Tie-Break. */
function stopSegment(state: MatchState, now: number) {
  const delta = runningDelta(state, now)
  return {
    segmentDuration: state.segmentElapsedBeforeRun + delta,
    sessionTotal: state.sessionElapsedBeforeRun + delta,
    stopped: {
      sessionElapsedBeforeRun: state.sessionElapsedBeforeRun + delta,
      segmentElapsedBeforeRun: 0,
      activeStartedAt: null,
      activeSegment: null as ActiveSegment,
      paused: false,
    },
  }
}

/**
 * Records a point in the current Game (§6–§7). When the point wins the Game,
 * the Game is recorded and the session either goes to the between-Game
 * screen, ends with a winner or Draw, or waits for the Final Tie-Break.
 */
export function addGamePoint(config: SessionConfig, state: MatchState, side: Side, now: number): FlowResult {
  const nextEvents = [...state.currentGameEvents, side]
  const nextScore = calculateGameScore(config, nextEvents)

  if (!nextScore.winner) return noEffects({ ...state, currentGameEvents: nextEvents })

  const { segmentDuration, sessionTotal, stopped } = stopSegment(state, now)
  const record: GameRecord = {
    gameNumber: state.currentGameIndex + 1,
    server: serverForGame(config, state.currentGameIndex),
    events: nextEvents,
    winner: nextScore.winner,
    durationMs: segmentDuration,
  }
  const completedGames = [...state.completedGames, record]
  const tally = gamesTally(completedGames)
  const afterGame: MatchState = { ...state, ...stopped, currentGameEvents: nextEvents, completedGames }
  const effects: FlowEffect[] = [{ type: 'game_completed', record, deuceCount: nextScore.deuceCount }]

  // More Games to play — the session never ends early, whatever the margin (§7.1).
  if (completedGames.length < config.totalGames) {
    return { state: { ...afterGame, screen: 'between' }, effects }
  }

  const finish = (outcome: SessionOutcome): FlowResult => ({
    state: { ...afterGame, outcome, screen: 'result' },
    effects: [...effects, {
      type: 'match_completed',
      gamesPlayed: completedGames.length,
      usedTieBreak: false,
      draw: outcome.draw,
      durationMs: sessionTotal,
    }],
  })

  if (tally.player !== tally.opponent) {
    return finish({ winner: tally.player > tally.opponent ? 'player' : 'opponent', draw: false, decidedBy: 'games' })
  }

  if (config.gamesTieResolution === 'draw') {
    return finish({ winner: null, draw: true, decidedBy: 'games-draw' })
  }

  // Games tied and a Final Tie-Break was chosen: the between-Game screen offers it (§7.2).
  return { state: { ...afterGame, screen: 'between' }, effects }
}

/** Records a point in the Final Tie-Break (§9). When it is decided, the session ends. */
export function addTieBreakPoint(config: SessionConfig, state: MatchState, side: Side, now: number): FlowResult {
  const nextEvents = [...state.tieBreakEvents, side]
  const nextScore = calculateTieBreak(config, nextEvents)

  if (!nextScore.winner && !nextScore.draw) return noEffects({ ...state, tieBreakEvents: nextEvents })

  const { segmentDuration, sessionTotal, stopped } = stopSegment(state, now)
  const tieBreakRecord: TieBreakRecord = {
    events: nextEvents,
    durationMs: segmentDuration,
    winner: nextScore.winner,
    draw: nextScore.draw,
  }
  const outcome: SessionOutcome = nextScore.draw
    ? { winner: null, draw: true, decidedBy: 'tiebreak-draw' }
    : { winner: nextScore.winner, draw: false, decidedBy: 'tiebreak' }

  return {
    state: { ...state, ...stopped, tieBreakEvents: nextEvents, tieBreakRecord, outcome, screen: 'result' },
    effects: [{
      type: 'match_completed',
      gamesPlayed: state.completedGames.length,
      usedTieBreak: true,
      draw: nextScore.draw,
      durationMs: sessionTotal,
    }],
  }
}

// ---------------------------------------------------------------------------
// Pause / Continue (§10.2)
// ---------------------------------------------------------------------------

export function pause(state: MatchState, now: number): MatchState {
  const delta = runningDelta(state, now)
  return {
    ...state,
    sessionElapsedBeforeRun: state.sessionElapsedBeforeRun + delta,
    segmentElapsedBeforeRun: state.segmentElapsedBeforeRun + delta,
    activeStartedAt: null,
    paused: true,
    stopConfirm: false,
    screen: 'pause',
  }
}

export function resume(state: MatchState, now: number): MatchState {
  return {
    ...state,
    paused: false,
    stopConfirm: false,
    activeStartedAt: now,
    screen: state.activeSegment === 'tiebreak' ? 'tiebreak-live' : 'live',
  }
}

export function setStopConfirm(state: MatchState, stopConfirm: boolean): MatchState {
  return { ...state, stopConfirm }
}

// ---------------------------------------------------------------------------
// Undo (§10.4)
// ---------------------------------------------------------------------------

/** Removes the last point of the Game or Tie-Break in progress. */
export function undoPoint(state: MatchState): FlowResult {
  if (state.activeSegment === 'tiebreak') {
    if (!state.tieBreakEvents.length) return noEffects(state)
    return {
      state: { ...state, tieBreakEvents: state.tieBreakEvents.slice(0, -1) },
      effects: [{ type: 'undo', stage: 'tiebreak' }],
    }
  }
  if (!state.currentGameEvents.length) return noEffects(state)
  return {
    state: { ...state, currentGameEvents: state.currentGameEvents.slice(0, -1) },
    effects: [{ type: 'undo', stage: 'game' }],
  }
}

/**
 * Undo on the between-Game (or result) screen: reopens the Game that was just
 * won, without its winning point, and restarts its timer.
 */
export function reopenLastCompletedGame(state: MatchState, now: number): MatchState {
  const last = state.completedGames.at(-1)
  if (!last) return state

  return {
    ...state,
    completedGames: state.completedGames.slice(0, -1),
    currentGameIndex: last.gameNumber - 1,
    currentGameEvents: last.events.slice(0, -1),
    tieBreakEvents: [],
    tieBreakRecord: null,
    outcome: null,
    // The session timer already includes this Game's time; keep it and resume.
    segmentElapsedBeforeRun: last.durationMs,
    activeStartedAt: now,
    activeSegment: 'game',
    paused: false,
    stopConfirm: false,
    screen: 'live',
  }
}

/** Undo on the result screen: reopens the Final Tie-Break if there was one, otherwise the last Game. */
export function undoFromResult(state: MatchState, now: number): MatchState {
  const record = state.tieBreakRecord
  if (!record) return reopenLastCompletedGame(state, now)

  return {
    ...state,
    tieBreakEvents: record.events.slice(0, -1),
    // The session timer already includes the Tie-Break's time; keep it and resume.
    segmentElapsedBeforeRun: record.durationMs,
    tieBreakRecord: null,
    outcome: null,
    activeStartedAt: now,
    activeSegment: 'tiebreak',
    paused: false,
    screen: 'tiebreak-live',
  }
}
