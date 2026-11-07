import type {
  GameScoreState,
  SessionConfig,
  Side,
  TieBreakState,
} from './types'

export function sideName(config: SessionConfig, side: Side): string {
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

export function calculateGameScore(config: SessionConfig, events: Side[]): GameScoreState {
  let player = 0
  let opponent = 0
  let deuceCount = 0
  let suddenDeath = false
  let winner: Side | null = null
  const history: GameScoreState['history'] = []

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
  let status: GameScoreState['status'] = 'normal'

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

export function calculateTieBreak(config: SessionConfig, events: Side[]): TieBreakState {
  let player = 0
  let opponent = 0
  let winner: Side | null = null
  let draw = false
  let extensionMode = false
  let suddenDeath = false
  let status: TieBreakState['status'] = 'normal'
  const history: TieBreakState['history'] = []

  for (let i = 0; i < events.length; i += 1) {
    const pointWinner = events[i]
    if (winner || draw) break

    if (suddenDeath) {
      if (pointWinner === 'player') player += 1
      else opponent += 1
      winner = pointWinner
      status = 'complete'
      history.push({
        number: i + 1,
        text: `${player}–${opponent} · ${sideName(config, winner)} wins · Sudden Death`,
      })
      break
    }

    if (pointWinner === 'player') player += 1
    else opponent += 1

    if (extensionMode) {
      if (Math.abs(player - opponent) >= config.tieBreakMargin) {
        winner = player > opponent ? 'player' : 'opponent'
        status = 'complete'
        history.push({
          number: i + 1,
          text: `${player}–${opponent} · ${sideName(config, winner)} wins`,
        })
      } else {
        status = 'at-cap-unlimited'
        history.push({ number: i + 1, text: `${player}–${opponent}` })
      }
      continue
    }

    const atOrBeyondTarget = player >= config.tieBreakMaxPoint || opponent >= config.tieBreakMaxPoint

    if (atOrBeyondTarget && player === opponent) {
      if (config.tieBreakEqualResolution === 'draw') {
        draw = true
        status = 'draw'
        history.push({ number: i + 1, text: `${player}–${opponent} · DRAW` })
      } else if (config.tieBreakEqualResolution === 'sudden-death') {
        suddenDeath = true
        status = 'at-cap-sudden-death'
        history.push({ number: i + 1, text: `${player}–${opponent} · Sudden Death · Next point wins` })
      } else {
        extensionMode = true
        status = 'at-cap-unlimited'
        history.push({
          number: i + 1,
          text: `${player}–${opponent} · Continue until ${config.tieBreakMargin}-point margin`,
        })
      }
      continue
    }

    if (atOrBeyondTarget && Math.abs(player - opponent) >= config.tieBreakMargin) {
      winner = player > opponent ? 'player' : 'opponent'
      status = 'complete'
      history.push({
        number: i + 1,
        text: `${player}–${opponent} · ${sideName(config, winner)} wins`,
      })
      break
    }

    history.push({ number: i + 1, text: `${player}–${opponent}` })
  }

  return {
    playerPoints: player,
    opponentPoints: opponent,
    winner,
    draw,
    status,
    history,
  }
}
