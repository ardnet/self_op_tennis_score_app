export type PlayMode = 'single' | 'double'
export type Side = 'player' | 'opponent'
export type DeuceMode = 'unlimited' | 'limited'
export type GamesTieResolution = 'draw' | 'tiebreak'
export type TieBreakEqualResolution = 'unlimited' | 'sudden-death' | 'draw'
export type ActiveSegment = 'game' | 'tiebreak' | null

export type Screen =
  | 'welcome'
  | 'mode'
  | 'names'
  | 'deuce'
  | 'games'
  | 'format'
  | 'tiebreak-config'
  | 'server'
  | 'live'
  | 'pause'
  | 'between'
  | 'tiebreak-live'
  | 'result'

export type ServerId = 'player1' | 'player2' | 'opponent1' | 'opponent2'
export type PlayerTeamServerId = 'player1' | 'player2'
export type OpponentTeamServerId = 'opponent1' | 'opponent2'

export interface PlayerNames {
  player1: string
  player2: string
  opponent1: string
  opponent2: string
}

export interface SessionConfig {
  mode: PlayMode
  names: PlayerNames
  deuceMode: DeuceMode
  maxDeuce: number
  totalGames: number
  gameLeadMargin: 1 | 2
  gamesTieResolution: GamesTieResolution
  tieBreakMaxPoint: number
  tieBreakMargin: 1 | 2
  tieBreakEqualResolution: TieBreakEqualResolution
  firstServingSide: Side
  playerFirstServer: PlayerTeamServerId
  opponentFirstServer: OpponentTeamServerId
}

export interface ScoreHistoryItem {
  number: number
  text: string
}

export interface GameScoreState {
  playerPoints: number
  opponentPoints: number
  playerDisplay: string
  opponentDisplay: string
  advantage: Side | null
  status: 'normal' | 'deuce' | 'advantage'
  deuceCount: number
  suddenDeath: boolean
  winner: Side | null
  history: ScoreHistoryItem[]
}

export interface GameRecord {
  gameNumber: number
  server: ServerId
  events: Side[]
  winner: Side
  durationMs: number
}

export interface TieBreakState {
  playerPoints: number
  opponentPoints: number
  winner: Side | null
  draw: boolean
  status: 'normal' | 'at-cap-unlimited' | 'at-cap-sudden-death' | 'draw' | 'complete'
  history: ScoreHistoryItem[]
}

export interface TieBreakRecord {
  events: Side[]
  durationMs: number
  winner: Side | null
  draw: boolean
}

export interface SessionOutcome {
  winner: Side | null
  draw: boolean
  decidedBy: 'games' | 'games-draw' | 'tiebreak' | 'tiebreak-draw'
}

export interface PersistedAppState {
  screen: Screen
  config: SessionConfig
  completedGames: GameRecord[]
  currentGameIndex: number
  currentGameEvents: Side[]
  tieBreakEvents: Side[]
  tieBreakRecord: TieBreakRecord | null
  paused: boolean
  stopConfirm: boolean
  sessionElapsedBeforeRun: number
  segmentElapsedBeforeRun: number
  activeStartedAt: number | null
  activeSegment: ActiveSegment
  outcome: SessionOutcome | null
}
