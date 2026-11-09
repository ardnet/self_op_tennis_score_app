import type { PlayMode, SessionConfig, SessionOutcome, Side } from '../domain/types'

export type LiveSessionStatus = 'waiting' | 'live' | 'paused' | 'between' | 'tiebreak' | 'finished' | 'closed'

export interface LiveScoreboardState {
  version: 1
  mode: PlayMode
  teamPlayer: string
  teamOpponent: string
  totalGames: number
  currentGame: number
  gamesPlayer: number
  gamesOpponent: number
  pointPlayer: string
  pointOpponent: string
  advantage: Side | null
  deuceCount: number
  deuceMode: SessionConfig['deuceMode']
  maxDeuce: number
  currentServer: string | null
  servingSide: Side | null
  phase: 'waiting' | 'game' | 'paused' | 'between' | 'tiebreak' | 'finished'
  segmentLabel: string
  sessionElapsedMs: number
  segmentElapsedMs: number
  activeStartedAt: number | null
  tieBreakPlayer: number | null
  tieBreakOpponent: number | null
  tieBreakCourtSide: 'deuce' | 'ad' | null
  tieBreakPointNumber: number | null
  changeEndsAfterThisPoint: boolean
  nextServer: string | null
  message: string | null
  outcome: SessionOutcome | null
}

export interface LiveControllerSession {
  publicCode: string
  scoreboardUrl: string
  controllerToken: string
  createdAt: string
  expiresAt: string
}

export interface LiveScoreboardRow {
  id: string
  public_code: string
  status: LiveSessionStatus
  scoreboard_state: LiveScoreboardState
  created_at: string
  started_at: string | null
  finished_at: string | null
  expires_at: string
  closed_at: string | null
  updated_at: string
}
