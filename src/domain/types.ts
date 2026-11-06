export type PlayMode = 'single' | 'double'
export type Side = 'player' | 'opponent'
export type DeuceMode = 'unlimited' | 'limited'
export type Screen = 'welcome' | 'mode' | 'names' | 'config' | 'server' | 'live' | 'pause' | 'result'

export type ServerId = 'player1' | 'player2' | 'opponent1' | 'opponent2'

export interface PlayerNames {
  player1: string
  player2: string
  opponent1: string
  opponent2: string
}

export interface GameConfig {
  mode: PlayMode
  names: PlayerNames
  deuceMode: DeuceMode
  maxDeuce: number
  server: ServerId
}

export interface ScoreHistoryItem {
  number: number
  text: string
}

export interface ScoreState {
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

export interface PersistedAppState {
  screen: Screen
  config: GameConfig
  events: Side[]
  paused: boolean
  stopConfirm: boolean
  elapsedBeforeRun: number
  runStartedAt: number | null
  finishedElapsed: number | null
}
