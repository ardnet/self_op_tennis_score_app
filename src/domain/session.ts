import type {
  GameRecord,
  OpponentTeamServerId,
  PlayerTeamServerId,
  ServerId,
  SessionConfig,
  Side,
} from './types'

export type TieBreakCourtSide = 'deuce' | 'ad'

export function gamesTally(records: GameRecord[]): { player: number; opponent: number } {
  return records.reduce(
    (acc, record) => {
      acc[record.winner] += 1
      return acc
    },
    { player: 0, opponent: 0 },
  )
}

export function otherPlayerServer(id: PlayerTeamServerId): PlayerTeamServerId {
  return id === 'player1' ? 'player2' : 'player1'
}

export function otherOpponentServer(id: OpponentTeamServerId): OpponentTeamServerId {
  return id === 'opponent1' ? 'opponent2' : 'opponent1'
}

export function servingSideForGame(config: SessionConfig, gameIndex: number): Side {
  const even = gameIndex % 2 === 0
  return even
    ? config.firstServingSide
    : config.firstServingSide === 'player' ? 'opponent' : 'player'
}

export function serverForGame(config: SessionConfig, gameIndex: number): ServerId {
  const side = servingSideForGame(config, gameIndex)

  if (config.mode === 'single') {
    return side === 'player' ? 'player1' : 'opponent1'
  }

  let sameSideOccurrence = 0
  for (let index = 0; index < gameIndex; index += 1) {
    if (servingSideForGame(config, index) === side) sameSideOccurrence += 1
  }

  if (side === 'player') {
    return sameSideOccurrence % 2 === 0
      ? config.playerFirstServer
      : otherPlayerServer(config.playerFirstServer)
  }

  return sameSideOccurrence % 2 === 0
    ? config.opponentFirstServer
    : otherOpponentServer(config.opponentFirstServer)
}

export function serverName(config: SessionConfig, server: ServerId): string {
  return config.names[server]
}

export function sideForServer(server: ServerId): Side {
  return server === 'player1' || server === 'player2' ? 'player' : 'opponent'
}

/**
 * Tie-break serving follows the standard 1-then-2 point rhythm.
 * Point 1 is served by the next scheduled Game server.
 * Every subsequent server serves two consecutive points, following the
 * already-established Game serving rotation.
 */
export function tieBreakServerForPoint(
  config: SessionConfig,
  completedGameCount: number,
  pointsPlayed: number,
): ServerId {
  const serverRotationOffset = pointsPlayed === 0
    ? 0
    : 1 + Math.floor((pointsPlayed - 1) / 2)

  return serverForGame(config, completedGameCount + serverRotationOffset)
}

export function tieBreakServingSideForPoint(
  config: SessionConfig,
  completedGameCount: number,
  pointsPlayed: number,
): Side {
  return sideForServer(tieBreakServerForPoint(config, completedGameCount, pointsPlayed))
}

/**
 * Before an even number of tie-break points have been completed, the next
 * serve is from the Deuce court. Before an odd number, it is from the Ad court.
 */
export function tieBreakCourtSide(pointsPlayed: number): TieBreakCourtSide {
  return pointsPlayed % 2 === 0 ? 'deuce' : 'ad'
}

export function tieBreakPointNumber(pointsPlayed: number): number {
  return pointsPlayed + 1
}

export function changesEndsAfterTieBreakPoint(pointsPlayed: number): boolean {
  return tieBreakPointNumber(pointsPlayed) % 6 === 0
}

export function nextTieBreakEndChangeAt(pointsPlayed: number): number {
  return Math.ceil(tieBreakPointNumber(pointsPlayed) / 6) * 6
}

export function tieBreakServingOrder(
  config: SessionConfig,
  completedGameCount: number,
): ServerId[] {
  const cycleLength = config.mode === 'single' ? 2 : 4
  return Array.from(
    { length: cycleLength },
    (_, index) => serverForGame(config, completedGameCount + index),
  )
}

export function clampWhole(value: number, min: number, max: number): number {
  const rounded = Math.round(Number.isFinite(value) ? value : min)
  return Math.max(min, Math.min(max, rounded))
}
