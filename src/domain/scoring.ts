import type { GameConfig, ScoreState, Side } from './types'

export function sideName(config: GameConfig, side: Side): string {
  if (config.mode === 'single') {
    return side === 'player' ? config.names.player1 : config.names.opponent1
  }

  return side === 'player'
    ? `${config.names.player1} / ${config.names.player2}`
    : `${config.names.opponent1} / ${config.names.opponent2}`
}

export function normalPoint(value: number): string {
  if (value <= 0) return '0'
  if (value === 1) return '15'
  if (value === 2) return '30'
  return '40'
}

export function calculateScore(config: GameConfig, events: Side[]): ScoreState {
  let player = 0
  let opponent = 0
  let deuceCount = 0
  let suddenDeath = false
  let winner: Side | null = null
  const history: ScoreState['history'] = []

  for (let i = 0; i < events.length; i += 1) {
    const pointWinner = events[i]
    if (winner) break

    if (suddenDeath) {
      winner = pointWinner
      history.push({
        number: i + 1,
        text: `GAME · ${sideName(config, winner)} · Sudden Death`,
      })
      break
    }

    if (pointWinner === 'player') player += 1
    else opponent += 1

    if ((player >= 4 || opponent >= 4) && Math.abs(player - opponent) >= 2) {
      winner = player > opponent ? 'player' : 'opponent'
      history.push({
        number: i + 1,
        text: `GAME · ${sideName(config, winner)}`,
      })
      break
    }

    if (player === opponent && player >= 3) {
      deuceCount += 1
      if (config.deuceMode === 'limited' && deuceCount >= config.maxDeuce) {
        suddenDeath = true
      }

      history.push({
        number: i + 1,
        text: `40–40 · Deuce #${deuceCount}${suddenDeath ? ' · Final Deuce' : ''}`,
      })
      continue
    }

    if (player >= 3 && opponent >= 3 && Math.abs(player - opponent) === 1) {
      const advantageSide: Side = player > opponent ? 'player' : 'opponent'
      history.push({
        number: i + 1,
        text: `ADV · ${sideName(config, advantageSide)}`,
      })
      continue
    }

    history.push({
      number: i + 1,
      text: `${normalPoint(player)}–${normalPoint(opponent)}`,
    })
  }

  let playerDisplay = normalPoint(player)
  let opponentDisplay = normalPoint(opponent)
  let advantage: Side | null = null
  let status: ScoreState['status'] = 'normal'

  if (!winner && player === opponent && player >= 3) {
    playerDisplay = '40'
    opponentDisplay = '40'
    status = 'deuce'
  } else if (!winner && player >= 3 && opponent >= 3 && Math.abs(player - opponent) === 1) {
    playerDisplay = '40'
    opponentDisplay = '40'
    advantage = player > opponent ? 'player' : 'opponent'
    status = 'advantage'
  }

  return {
    playerPoints: player,
    opponentPoints: opponent,
    playerDisplay,
    opponentDisplay,
    advantage,
    status,
    deuceCount,
    suddenDeath,
    winner,
    history,
  }
}
