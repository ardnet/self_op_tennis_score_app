import type {
  GameRecord,
  OpponentTeamServerId,
  PlayerTeamServerId,
  ServerId,
  SessionConfig,
  Side,
} from './types'

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

export function clampWhole(value: number, min: number, max: number): number {
  const rounded = Math.round(Number.isFinite(value) ? value : min)
  return Math.max(min, Math.min(max, rounded))
}
