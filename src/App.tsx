import { useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { calculateGameScore, calculateTieBreak, sideName } from './domain/scoring'
import {
  changesEndsAfterTieBreakPoint,
  clampWhole,
  gamesTally,
  nextTieBreakEndChangeAt,
  pointWinnerForCall,
  serverForGame,
  serverName,
  servingSideForGame,
  tieBreakCourtSide,
  tieBreakPointNumber,
  tieBreakServerForPoint,
  tieBreakServingOrder,
  tieBreakServingSideForPoint,
} from './domain/session'
import * as flow from './domain/sessionFlow'
import type { FlowEffect, MatchState } from './domain/sessionFlow'
import type {
  ActiveSegment,
  DeuceMode,
  GameRecord,
  GamesTieResolution,
  OpponentTeamServerId,
  PersistedAppState,
  PlayMode,
  PlayerTeamServerId,
  Screen,
  SessionConfig,
  SessionOutcome,
  Side,
  TieBreakEqualResolution,
  TieBreakRecord,
} from './domain/types'
import { clearState, loadState, saveState } from './storage/localStorage'
import { closeLiveScoreboard, createLiveScoreboard, loadControllerSession, saveControllerSession, updateLiveScoreboard } from './live/controller'
import type { LiveControllerSession, LiveScoreboardState, LiveSessionStatus } from './live/types'
import { trackEvent } from './analytics'

const defaultConfig: SessionConfig = {
  mode: 'single',
  names: {
    player1: 'Player',
    player2: 'Partner',
    opponent1: 'Opponent',
    opponent2: 'Opponent 2',
  },
  deuceMode: 'unlimited',
  maxDeuce: 4,
  totalGames: 6,
  gameLeadMargin: 2,
  gamesTieResolution: 'tiebreak',
  tieBreakMaxPoint: 7,
  tieBreakMargin: 2,
  tieBreakEqualResolution: 'sudden-death',
  firstServingSide: 'player',
  playerFirstServer: 'player1',
  opponentFirstServer: 'opponent1',
}

const nowMs = () => Date.now()

function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}

function App() {
  const restored = useMemo(() => loadState(), [])

  const [config, setConfig] = useState<SessionConfig>(restored?.config ?? defaultConfig)
  const [match, setMatch] = useState<MatchState>(() => flow.restoreMatchState(restored))
  const {
    screen,
    completedGames,
    currentGameIndex,
    currentGameEvents,
    tieBreakEvents,
    tieBreakRecord,
    paused,
    stopConfirm,
    sessionElapsedBeforeRun,
    segmentElapsedBeforeRun,
    activeStartedAt,
    activeSegment,
    outcome,
  } = match
  const setScreen = (next: Screen) => setMatch((current) => ({ ...current, screen: next }))
  const setStopConfirm = (value: boolean) => setMatch((current) => flow.setStopConfirm(current, value))
  const [, setClockTick] = useState(0)
  const [liveSession, setLiveSession] = useState<LiveControllerSession | null>(() => loadControllerSession())
  const [liveBusy, setLiveBusy] = useState(false)
  const [liveError, setLiveError] = useState<string | null>(null)
  const [liveSyncStatus, setLiveSyncStatus] = useState<'idle' | 'syncing' | 'connected' | 'offline'>('idle')
  const [liveRetryTick, setLiveRetryTick] = useState(0)

  const gameScore = useMemo(
    () => calculateGameScore(config, currentGameEvents),
    [config, currentGameEvents],
  )
  const tieBreakScore = useMemo(
    () => calculateTieBreak(config, tieBreakEvents),
    [config, tieBreakEvents],
  )
  const tally = useMemo(() => gamesTally(completedGames), [completedGames])

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((value) => value + 1), 500)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const snapshot: PersistedAppState = { ...match, config }
    saveState(snapshot)
  }, [match, config])

  useEffect(() => {
    if (!liveSession || !['server', 'live', 'pause', 'between', 'tiebreak-live', 'result'].includes(screen)) return

    const timer = window.setTimeout(() => {
      setLiveSyncStatus('syncing')
      updateLiveScoreboard(liveSession, liveStatusForScreen(), buildLiveScoreboardState())
        .then(({ expiresAt }) => {
          const updated = expiresAt === liveSession.expiresAt ? liveSession : { ...liveSession, expiresAt }
          if (updated !== liveSession) {
            setLiveSession(updated)
            saveControllerSession(updated)
          }
          setLiveSyncStatus('connected')
          setLiveError(null)
        })
        .catch((error) => {
          console.warn('Live scoreboard sync failed:', error)
          setLiveSyncStatus('offline')
          setLiveError('Live scoreboard reconnecting. Local scoring is still available.')
        })
    }, 180)

    return () => window.clearTimeout(timer)
  }, [
    liveSession,
    screen,
    config,
    completedGames,
    currentGameIndex,
    currentGameEvents,
    tieBreakEvents,
    tieBreakRecord,
    paused,
    sessionElapsedBeforeRun,
    segmentElapsedBeforeRun,
    activeStartedAt,
    activeSegment,
    outcome,
    liveRetryTick,
  ])

  useEffect(() => {
    if (!liveSession || liveSyncStatus !== 'offline') return
    const retry = window.setInterval(() => setLiveRetryTick((value) => value + 1), 5000)
    const onOnline = () => setLiveRetryTick((value) => value + 1)
    window.addEventListener('online', onOnline)
    return () => {
      window.clearInterval(retry)
      window.removeEventListener('online', onOnline)
    }
  }, [liveSession, liveSyncStatus])

  function sessionElapsed() {
    return flow.sessionElapsed(match, nowMs())
  }

  function segmentElapsed() {
    return flow.segmentElapsed(match, nowMs())
  }

  function livePhase(): LiveScoreboardState['phase'] {
    if (screen === 'server') return 'waiting'
    if (screen === 'live') return 'game'
    if (screen === 'pause') return 'paused'
    if (screen === 'between') return 'between'
    if (screen === 'tiebreak-live') return 'tiebreak'
    if (screen === 'result') return 'finished'
    return 'waiting'
  }

  function buildLiveScoreboardState(): LiveScoreboardState {
    const phase = livePhase()
    const isTieBreakPhase = phase === 'tiebreak' || (phase === 'paused' && activeSegment === 'tiebreak')
    let currentServer: string | null = null
    let servingSide: Side | null = null
    let nextServer: string | null = null

    if (phase === 'waiting') {
      const server = serverForGame(config, 0)
      currentServer = serverName(config, server)
      servingSide = servingSideForGame(config, 0)
    } else if (phase === 'game' || (phase === 'paused' && activeSegment === 'game')) {
      const server = serverForGame(config, currentGameIndex)
      currentServer = serverName(config, server)
      servingSide = servingSideForGame(config, currentGameIndex)
    } else if (isTieBreakPhase) {
      const server = tieBreakServerForPoint(config, completedGames.length, tieBreakEvents.length)
      currentServer = serverName(config, server)
      servingSide = tieBreakServingSideForPoint(config, completedGames.length, tieBreakEvents.length)
    } else if (phase === 'between') {
      const pendingTieBreak = completedGames.length === config.totalGames && tally.player === tally.opponent && config.gamesTieResolution === 'tiebreak'
      if (pendingTieBreak) {
        nextServer = serverName(config, tieBreakServerForPoint(config, completedGames.length, 0))
      } else if (completedGames.length < config.totalGames) {
        nextServer = serverName(config, serverForGame(config, completedGames.length))
      }
    }

    const last = completedGames.at(-1)
    const betweenMessage = phase === 'between' && last
      ? `${sideName(config, last.winner)} ${config.mode === 'double' ? 'win' : 'wins'} Game ${last.gameNumber}`
      : null

    return {
      version: 1,
      mode: config.mode,
      teamPlayer: sideName(config, 'player'),
      teamOpponent: sideName(config, 'opponent'),
      totalGames: config.totalGames,
      currentGame: Math.min(config.totalGames, currentGameIndex + 1),
      gamesPlayer: tally.player,
      gamesOpponent: tally.opponent,
      pointPlayer: gameScore.playerDisplay,
      pointOpponent: gameScore.opponentDisplay,
      advantage: gameScore.advantage,
      deuceCount: gameScore.deuceCount,
      deuceMode: config.deuceMode,
      maxDeuce: config.maxDeuce,
      currentServer,
      servingSide,
      phase,
      segmentLabel: isTieBreakPhase ? 'Final Tie-Break' : phase === 'between' ? 'Between Games' : `Game ${Math.min(config.totalGames, currentGameIndex + 1)} of ${config.totalGames}`,
      sessionElapsedMs: sessionElapsedBeforeRun,
      segmentElapsedMs: segmentElapsedBeforeRun,
      activeStartedAt: (phase === 'game' || phase === 'tiebreak') ? activeStartedAt : null,
      tieBreakPlayer: isTieBreakPhase || tieBreakRecord ? tieBreakScore.playerPoints : null,
      tieBreakOpponent: isTieBreakPhase || tieBreakRecord ? tieBreakScore.opponentPoints : null,
      tieBreakCourtSide: isTieBreakPhase ? tieBreakCourtSide(tieBreakEvents.length) : null,
      tieBreakPointNumber: isTieBreakPhase ? tieBreakPointNumber(tieBreakEvents.length) : null,
      changeEndsAfterThisPoint: isTieBreakPhase ? changesEndsAfterTieBreakPoint(tieBreakEvents.length) : false,
      nextServer,
      message: phase === 'game' ? (gameScore.suddenDeath ? 'FINAL DEUCE • NEXT POINT WINS' : gameScore.status === 'deuce' ? 'DEUCE' : gameScore.status === 'advantage' ? `Advantage ${sideName(config, gameScore.advantage!)}` : null) : betweenMessage,
      outcome: phase === 'finished' ? outcome : null,
    }
  }

  function liveStatusForScreen(): LiveSessionStatus {
    if (screen === 'server') return 'waiting'
    if (screen === 'pause') return 'paused'
    if (screen === 'between') return 'between'
    if (screen === 'tiebreak-live') return 'tiebreak'
    if (screen === 'result') return 'finished'
    return 'live'
  }

  async function handleCreateLiveScoreboard() {
    setLiveBusy(true)
    setLiveError(null)
    try {
      const created = await createLiveScoreboard(buildLiveScoreboardState())
      setLiveSession(created)
      setLiveSyncStatus('connected')
      trackEvent('live_scoreboard_created', { play_mode: config.mode })
    } catch (error) {
      setLiveSyncStatus('offline')
      setLiveError(error instanceof Error ? error.message : 'Unable to create live scoreboard')
    } finally {
      setLiveBusy(false)
    }
  }

  async function handleCloseLiveScoreboard() {
    if (!liveSession) return
    setLiveBusy(true)
    setLiveError(null)
    try {
      await closeLiveScoreboard(liveSession)
      setLiveSession(null)
      setLiveSyncStatus('idle')
      trackEvent('live_scoreboard_closed', { reason: 'manual' })
    } catch (error) {
      setLiveError(error instanceof Error ? error.message : 'Unable to close live scoreboard')
    } finally {
      setLiveBusy(false)
    }
  }

  function reportEffects(effects: FlowEffect[]) {
    for (const effect of effects) {
      if (effect.type === 'game_completed') {
        trackEvent('game_completed', {
          game_number: effect.record.gameNumber,
          winner_side: effect.record.winner,
          had_deuce: effect.deuceCount > 0,
          deuce_count: effect.deuceCount,
        })
      } else if (effect.type === 'match_completed') {
        trackEvent('match_completed', {
          play_mode: config.mode,
          games_played: effect.gamesPlayed,
          used_tiebreak: effect.usedTieBreak,
          draw: effect.draw,
          duration_seconds: Math.floor(effect.durationMs / 1000),
        })
      } else if (effect.type === 'undo') {
        trackEvent('undo_used', { stage: effect.stage })
      }
    }
  }

  function applyResult(result: flow.FlowResult) {
    setMatch(result.state)
    reportEffects(result.effects)
  }

  function resetSessionProgress() {
    setMatch((current) => flow.resetProgress(current))
  }

  function startSession() {
    trackEvent('match_started', {
      play_mode: config.mode,
      total_games: config.totalGames,
      deuce_mode: config.deuceMode,
      live_scoreboard_enabled: Boolean(liveSession),
      tie_resolution: config.gamesTieResolution,
    })
    setMatch((current) => flow.startMatch(current, nowMs()))
  }

  function addGamePoint(side: Side) {
    applyResult(flow.addGamePoint(config, match, side, nowMs()))
  }

  function startNextGame() {
    setMatch((current) => flow.startNextGame(current, nowMs()))
  }

  function startFinalTieBreak() {
    trackEvent('final_tiebreak_started', {
      target_points: config.tieBreakMaxPoint,
      winning_margin: config.tieBreakMargin,
      equal_resolution: config.tieBreakEqualResolution,
    })
    setMatch((current) => flow.startFinalTieBreak(current, nowMs()))
  }

  function addTieBreakPoint(side: Side) {
    applyResult(flow.addTieBreakPoint(config, match, side, nowMs()))
  }

  function pauseActivePlay() {
    trackEvent('pause_used', { stage: activeSegment === 'tiebreak' ? 'tiebreak' : 'game' })
    setMatch((current) => flow.pause(current, nowMs()))
  }

  function resumeActivePlay() {
    setMatch((current) => flow.resume(current, nowMs()))
  }

  function undoCurrentPoint() {
    applyResult(flow.undoPoint(match))
  }

  function reopenLastCompletedGame() {
    setMatch((current) => flow.reopenLastCompletedGame(current, nowMs()))
  }

  function undoFromResult() {
    setMatch((current) => flow.undoFromResult(current, nowMs()))
  }

  function stopSession() {
    if (liveSession) closeLiveScoreboard(liveSession).catch(() => undefined)
    setLiveSession(null)
    saveControllerSession(null)
    resetSessionProgress()
    clearState()
    setScreen('welcome')
  }

  function done() {
    setLiveSession(null)
    saveControllerSession(null)
    resetSessionProgress()
    clearState()
    setScreen('welcome')
  }

  function newSession() {
    setLiveSession(null)
    saveControllerSession(null)
    resetSessionProgress()
    setScreen('server')
  }

  const lastCompletedGame = completedGames.at(-1) ?? null
  const pendingFinalTieBreak = flow.isFinalTieBreakPending(config, match)

  return (
    <main className="app-shell">
      <div className="phone-card">
        {liveSession && screen !== 'server' && <LiveControllerStatus session={liveSession} syncStatus={liveSyncStatus} busy={liveBusy} error={liveError} onClose={handleCloseLiveScoreboard} />}
        {screen === 'welcome' && <Welcome onStart={() => { trackEvent('match_setup_started'); setScreen('mode') }} />}

        {screen === 'mode' && (
          <ModeScreen
            mode={config.mode}
            onSelect={(mode) => { trackEvent('play_mode_selected', { play_mode: mode }); setConfig((current) => ({ ...current, mode })) }}
            onBack={() => setScreen('welcome')}
            onNext={() => setScreen('names')}
          />
        )}

        {screen === 'names' && (
          <NamesScreen
            config={config}
            onChange={(names) => setConfig((current) => ({ ...current, names }))}
            onBack={() => setScreen('mode')}
            onNext={() => setScreen('deuce')}
          />
        )}

        {screen === 'deuce' && (
          <DeuceScreen
            mode={config.deuceMode}
            maxDeuce={config.maxDeuce}
            onMode={(deuceMode) => { trackEvent('deuce_mode_selected', { deuce_mode: deuceMode }); setConfig((current) => ({ ...current, deuceMode })) }}
            onMax={(maxDeuce) => setConfig((current) => ({ ...current, maxDeuce }))}
            onBack={() => setScreen('names')}
            onNext={() => setScreen('games')}
          />
        )}

        {screen === 'games' && (
          <GamesScreen
            totalGames={config.totalGames}
            onTotal={(totalGames) => setConfig((current) => ({ ...current, totalGames }))}
            onBack={() => setScreen('deuce')}
            onNext={() => setScreen('format')}
          />
        )}

        {screen === 'format' && (
          <GamesFormatScreen
            margin={config.gameLeadMargin}
            tieResolution={config.gamesTieResolution}
            onMargin={(gameLeadMargin) => setConfig((current) => ({ ...current, gameLeadMargin }))}
            onTieResolution={(gamesTieResolution) => setConfig((current) => ({ ...current, gamesTieResolution }))}
            onBack={() => setScreen('games')}
            onNext={() => setScreen(config.gamesTieResolution === 'tiebreak' ? 'tiebreak-config' : 'server')}
          />
        )}

        {screen === 'tiebreak-config' && (
          <TieBreakConfigScreen
            maxPoint={config.tieBreakMaxPoint}
            margin={config.tieBreakMargin}
            equalResolution={config.tieBreakEqualResolution}
            onMaxPoint={(tieBreakMaxPoint) => setConfig((current) => ({ ...current, tieBreakMaxPoint }))}
            onMargin={(tieBreakMargin) => setConfig((current) => ({ ...current, tieBreakMargin }))}
            onEqualResolution={(tieBreakEqualResolution) => setConfig((current) => ({ ...current, tieBreakEqualResolution }))}
            onBack={() => setScreen('format')}
            onNext={() => setScreen('server')}
          />
        )}

        {screen === 'server' && (
          <ServerSetupScreen
            config={config}
            onChange={setConfig}
            onBack={() => setScreen(config.gamesTieResolution === 'tiebreak' ? 'tiebreak-config' : 'format')}
            onStart={startSession}
            liveSession={liveSession}
            liveBusy={liveBusy}
            liveError={liveError}
            onCreateLive={handleCreateLiveScoreboard}
            onCloseLive={handleCloseLiveScoreboard}
          />
        )}

        {screen === 'live' && (
          <LiveGameScreen
            config={config}
            score={gameScore}
            currentGameIndex={currentGameIndex}
            completedGames={completedGames}
            sessionElapsed={sessionElapsed()}
            gameElapsed={segmentElapsed()}
            canUndo={currentGameEvents.length > 0}
            onPlayerPoint={() => addGamePoint('player')}
            onOpponentPoint={() => addGamePoint('opponent')}
            onUndo={undoCurrentPoint}
            onPause={pauseActivePlay}
          />
        )}

        {screen === 'pause' && (
          <PauseScreen
            config={config}
            activeSegment={activeSegment}
            gameNumber={currentGameIndex + 1}
            gameScore={gameScore}
            tieBreakScore={tieBreakScore}
            tieBreakPointsPlayed={tieBreakEvents.length}
            sessionElapsed={sessionElapsed()}
            segmentElapsed={segmentElapsed()}
            stopConfirm={stopConfirm}
            onContinue={resumeActivePlay}
            onStopRequest={() => setStopConfirm(true)}
            onStopCancel={() => setStopConfirm(false)}
            onStopConfirm={stopSession}
          />
        )}

        {screen === 'between' && lastCompletedGame && (
          <BetweenGamesScreen
            config={config}
            record={lastCompletedGame}
            tally={tally}
            sessionElapsed={sessionElapsedBeforeRun}
            pendingFinalTieBreak={pendingFinalTieBreak}
            onUndo={reopenLastCompletedGame}
            onContinue={pendingFinalTieBreak ? startFinalTieBreak : startNextGame}
          />
        )}

        {screen === 'tiebreak-live' && (
          <TieBreakLiveScreen
            config={config}
            score={tieBreakScore}
            tally={tally}
            completedGameCount={completedGames.length}
            pointsPlayed={tieBreakEvents.length}
            sessionElapsed={sessionElapsed()}
            tieBreakElapsed={segmentElapsed()}
            canUndo={tieBreakEvents.length > 0}
            onPlayerPoint={() => addTieBreakPoint('player')}
            onOpponentPoint={() => addTieBreakPoint('opponent')}
            onUndo={undoCurrentPoint}
            onPause={pauseActivePlay}
          />
        )}

        {screen === 'result' && outcome && (
          <SessionResultScreen
            config={config}
            games={completedGames}
            tally={tally}
            tieBreakRecord={tieBreakRecord}
            outcome={outcome}
            totalElapsed={sessionElapsedBeforeRun}
            onUndo={undoFromResult}
            onNewSession={newSession}
            onDone={done}
          />
        )}
      </div>
    </main>
  )
}

function Header({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="screen-header">
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  )
}

function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <section className="welcome-screen">
      <div className="ball-mark">🎾</div>
      <div>
        <h1>Self-Operated Tennis Score</h1>
        <p>Keep score while you focus on playing.</p>
      </div>
      <button className="button button-primary button-xl" onClick={onStart}>START</button>
    </section>
  )
}

function ModeScreen({
  mode,
  onSelect,
  onBack,
  onNext,
}: {
  mode: PlayMode
  onSelect: (mode: PlayMode) => void
  onBack: () => void
  onNext: () => void
}) {
  return (
    <section className="screen-stack">
      <Header title="Choose Play Mode" subtitle="How are you playing today?" />
      <Choice selected={mode === 'single'} title="Singles" subtitle="1 player vs 1 opponent" onClick={() => onSelect('single')} />
      <Choice selected={mode === 'double'} title="Doubles" subtitle="2 players vs 2 opponents" onClick={() => onSelect('double')} />
      <NavButtons onBack={onBack} onNext={onNext} nextLabel="NEXT" />
    </section>
  )
}

function NamesScreen({
  config,
  onChange,
  onBack,
  onNext,
}: {
  config: SessionConfig
  onChange: (names: SessionConfig['names']) => void
  onBack: () => void
  onNext: () => void
}) {
  const [draft, setDraft] = useState(config.names)
  const [error, setError] = useState('')

  const required = config.mode === 'single'
    ? [draft.player1, draft.opponent1]
    : [draft.player1, draft.player2, draft.opponent1, draft.opponent2]

  function next() {
    if (required.some((value) => !value.trim())) {
      setError('Please enter all required names.')
      return
    }
    onChange({
      player1: draft.player1.trim(),
      player2: draft.player2.trim(),
      opponent1: draft.opponent1.trim(),
      opponent2: draft.opponent2.trim(),
    })
    onNext()
  }

  return (
    <section className="screen-stack">
      <Header title="Player Names" subtitle={config.mode === 'single' ? 'Enter the two players.' : 'Enter both teams.'} />
      {config.mode === 'single' ? (
        <>
          <TextField label="Your Name" value={draft.player1} onChange={(value) => setDraft({ ...draft, player1: value })} />
          <TextField label="Opponent Name" value={draft.opponent1} onChange={(value) => setDraft({ ...draft, opponent1: value })} />
        </>
      ) : (
        <>
          <div className="panel">
            <h2>Your Team</h2>
            <TextField label="Player 1" value={draft.player1} onChange={(value) => setDraft({ ...draft, player1: value })} />
            <TextField label="Player 2" value={draft.player2} onChange={(value) => setDraft({ ...draft, player2: value })} />
          </div>
          <div className="panel">
            <h2>Opponent Team</h2>
            <TextField label="Opponent 1" value={draft.opponent1} onChange={(value) => setDraft({ ...draft, opponent1: value })} />
            <TextField label="Opponent 2" value={draft.opponent2} onChange={(value) => setDraft({ ...draft, opponent2: value })} />
          </div>
        </>
      )}
      {error && <div className="form-error">{error}</div>}
      <NavButtons onBack={onBack} onNext={next} nextLabel="NEXT" />
    </section>
  )
}

function DeuceScreen({
  mode,
  maxDeuce,
  onMode,
  onMax,
  onBack,
  onNext,
}: {
  mode: DeuceMode
  maxDeuce: number
  onMode: (mode: DeuceMode) => void
  onMax: (value: number) => void
  onBack: () => void
  onNext: () => void
}) {
  return (
    <section className="screen-stack">
      <Header title="Deuce Setup" subtitle="This rule applies inside every Game." />
      <Choice selected={mode === 'unlimited'} title="Unlimited Deuce" subtitle="Continue until one side wins by two points." onClick={() => onMode('unlimited')} />
      <Choice selected={mode === 'limited'} title="Limited Deuce" subtitle="Maximum 1–10 Deuces, then next point wins." onClick={() => onMode('limited')} />
      {mode === 'limited' && (
        <SelectField label="Maximum Number of Deuces" value={maxDeuce} onChange={(value) => onMax(clampWhole(value, 1, 10))} values={range(1, 10)} />
      )}
      <NavButtons onBack={onBack} onNext={onNext} nextLabel="NEXT" />
    </section>
  )
}

function GamesScreen({
  totalGames,
  onTotal,
  onBack,
  onNext,
}: {
  totalGames: number
  onTotal: (value: number) => void
  onBack: () => void
  onNext: () => void
}) {
  return (
    <section className="screen-stack">
      <Header title="How many Games do you want to play?" subtitle="Choose a fixed total number of Games for this session." />
      <SelectField label="Number of Games" value={totalGames} onChange={(value) => onTotal(clampWhole(value, 2, 10))} values={range(2, 10)} />
      <div className="panel future-panel">
        <div>
          <strong>Configure Sets instead?</strong>
          <small>Coming in Phase 2</small>
        </div>
        <button className="button button-secondary" disabled>SETS</button>
      </div>
      <NavButtons onBack={onBack} onNext={onNext} nextLabel="NEXT" />
    </section>
  )
}

function GamesFormatScreen({
  margin,
  tieResolution,
  onMargin,
  onTieResolution,
  onBack,
  onNext,
}: {
  margin: 1 | 2
  tieResolution: GamesTieResolution
  onMargin: (value: 1 | 2) => void
  onTieResolution: (value: GamesTieResolution) => void
  onBack: () => void
  onNext: () => void
}) {
  return (
    <section className="screen-stack">
      <Header title="Games Format" subtitle="Configure how the overall Games result is decided." />
      <SelectField label="How many Games must the winner lead by?" value={margin} onChange={(value) => onMargin(value === 1 ? 1 : 2)} values={[1, 2]} />
      <InfoBox>Because the number of Games is fixed, play still ends after the configured total. If the final score is not tied, the side with more Games wins even when this preferred margin is not met.</InfoBox>
      <h2 className="section-question">If the Games score is tied when all configured Games are complete:</h2>
      <Choice selected={tieResolution === 'draw'} title="Finish as DRAW" subtitle="End the session with no winner." onClick={() => onTieResolution('draw')} />
      <Choice selected={tieResolution === 'tiebreak'} title="Use Tie-Break" subtitle="Play a final numeric Tie-Break to decide the session." onClick={() => onTieResolution('tiebreak')} />
      <NavButtons onBack={onBack} onNext={onNext} nextLabel={tieResolution === 'tiebreak' ? 'CONFIGURE TIE-BREAK' : 'PLAY'} />
    </section>
  )
}

function TieBreakConfigScreen({
  maxPoint,
  margin,
  equalResolution,
  onMaxPoint,
  onMargin,
  onEqualResolution,
  onBack,
  onNext,
}: {
  maxPoint: number
  margin: 1 | 2
  equalResolution: TieBreakEqualResolution
  onMaxPoint: (value: number) => void
  onMargin: (value: 1 | 2) => void
  onEqualResolution: (value: TieBreakEqualResolution) => void
  onBack: () => void
  onNext: () => void
}) {
  return (
    <section className="screen-stack">
      <Header title="Tie-Break Setup" subtitle="Used only when the configured Games finish tied." />
      <SelectField label="Maximum Tie-Break Point" value={maxPoint} onChange={(value) => onMaxPoint(clampWhole(value, 5, 10))} values={range(5, 10)} />
      <SelectField label="Tie-Break Winning Margin" value={margin} onChange={(value) => onMargin(value === 1 ? 1 : 2)} values={[1, 2]} />
      <InfoBox>The selected margin applies at the target. For example, with target 7 and margin 2, 7–6 continues; if it reaches 7–7, the selected equal-score resolution applies.</InfoBox>
      <h2 className="section-question">If both sides reach the maximum equally:</h2>
      <Choice selected={equalResolution === 'unlimited'} title="Unlimited Until Margin Reached" subtitle={`Continue until one side leads by ${margin}.`} onClick={() => onEqualResolution('unlimited')} />
      <Choice selected={equalResolution === 'sudden-death'} title="Sudden Death" subtitle="The next point wins." onClick={() => onEqualResolution('sudden-death')} />
      <Choice selected={equalResolution === 'draw'} title="Make it DRAW" subtitle="End the session immediately as a draw." onClick={() => onEqualResolution('draw')} />
      <NavButtons onBack={onBack} onNext={onNext} nextLabel="PLAY" />
    </section>
  )
}

function ServerSetupScreen({
  config,
  onChange,
  onBack,
  onStart,
  liveSession,
  liveBusy,
  liveError,
  onCreateLive,
  onCloseLive,
}: {
  config: SessionConfig
  onChange: (config: SessionConfig) => void
  onBack: () => void
  onStart: () => void
  liveSession: LiveControllerSession | null
  liveBusy: boolean
  liveError: string | null
  onCreateLive: () => void
  onCloseLive: () => void
}) {
  const rotation = range(0, Math.min(config.totalGames - 1, 3)).map((gameIndex) => ({
    game: gameIndex + 1,
    server: serverName(config, serverForGame(config, gameIndex)),
  }))

  return (
    <section className="screen-stack">
      <Header title="Who is going to play first?" subtitle="Set the serving order before Game 1." />

      <div className="panel">
        <h2>Which side serves Game 1?</h2>
        <div className="two-col">
          <ChoiceCompact selected={config.firstServingSide === 'player'} title={config.mode === 'single' ? config.names.player1 : 'Your Team'} onClick={() => onChange({ ...config, firstServingSide: 'player' })} />
          <ChoiceCompact selected={config.firstServingSide === 'opponent'} title={config.mode === 'single' ? config.names.opponent1 : 'Opponent Team'} onClick={() => onChange({ ...config, firstServingSide: 'opponent' })} />
        </div>
      </div>

      {config.mode === 'double' && (
        <>
          <div className="panel">
            <h2>First server — Your Team</h2>
            <div className="two-col">
              <ChoiceCompact selected={config.playerFirstServer === 'player1'} title={config.names.player1} subtitle="Player 1" onClick={() => onChange({ ...config, playerFirstServer: 'player1' as PlayerTeamServerId })} />
              <ChoiceCompact selected={config.playerFirstServer === 'player2'} title={config.names.player2} subtitle="Player 2" onClick={() => onChange({ ...config, playerFirstServer: 'player2' as PlayerTeamServerId })} />
            </div>
          </div>
          <div className="panel">
            <h2>First server — Opponent Team</h2>
            <div className="two-col">
              <ChoiceCompact selected={config.opponentFirstServer === 'opponent1'} title={config.names.opponent1} subtitle="Opponent 1" onClick={() => onChange({ ...config, opponentFirstServer: 'opponent1' as OpponentTeamServerId })} />
              <ChoiceCompact selected={config.opponentFirstServer === 'opponent2'} title={config.names.opponent2} subtitle="Opponent 2" onClick={() => onChange({ ...config, opponentFirstServer: 'opponent2' as OpponentTeamServerId })} />
            </div>
          </div>
        </>
      )}

      <div className="panel rotation-preview">
        <h2>Serving preview</h2>
        {rotation.map((item) => <div key={item.game}><span>Game {item.game}</span><strong>{item.server}</strong></div>)}
        {config.totalGames > 4 && <small>Rotation continues automatically for the remaining Games.</small>}
      </div>
      <LiveScoreboardSetupPanel
        session={liveSession}
        busy={liveBusy}
        error={liveError}
        onCreate={onCreateLive}
        onClose={onCloseLive}
      />
      <NavButtons onBack={onBack} onNext={onStart} nextLabel="LET'S PLAY!" />
    </section>
  )
}

function LiveGameScreen({
  config,
  score,
  currentGameIndex,
  completedGames,
  sessionElapsed,
  gameElapsed,
  canUndo,
  onPlayerPoint,
  onOpponentPoint,
  onUndo,
  onPause,
}: {
  config: SessionConfig
  score: ReturnType<typeof calculateGameScore>
  currentGameIndex: number
  completedGames: GameRecord[]
  sessionElapsed: number
  gameElapsed: number
  canUndo: boolean
  onPlayerPoint: () => void
  onOpponentPoint: () => void
  onUndo: () => void
  onPause: () => void
}) {
  const tally = gamesTally(completedGames)
  const server = serverForGame(config, currentGameIndex)
  const servingSide = servingSideForGame(config, currentGameIndex)

  return (
    <section className="screen-stack compact">
      <TimerStrip sessionElapsed={sessionElapsed} segmentElapsed={gameElapsed} segmentLabel={`Game ${currentGameIndex + 1}`} />
      <div className="game-progress panel slim-panel">
        <div><small>GAME {currentGameIndex + 1} OF {config.totalGames}</small><strong>Games: {tally.player}–{tally.opponent}</strong></div>
        <span className="serve-badge">{serverName(config, server)} SERVES</span>
      </div>
      <ScoreBoard config={config} score={score} server={server} />
      <DeuceBanner config={config} score={score} />
      <PointButtons config={config} inSide={servingSide} onPlayerPoint={onPlayerPoint} onOpponentPoint={onOpponentPoint} />
      <div className="two-col">
        <button className="button button-secondary" disabled={!canUndo} onClick={onUndo}>↶ UNDO</button>
        <button className="button button-secondary" onClick={onPause}>Ⅱ PAUSE</button>
      </div>
    </section>
  )
}

function PauseScreen({
  config,
  activeSegment,
  gameNumber,
  gameScore,
  tieBreakScore,
  tieBreakPointsPlayed,
  sessionElapsed,
  segmentElapsed,
  stopConfirm,
  onContinue,
  onStopRequest,
  onStopCancel,
  onStopConfirm,
}: {
  config: SessionConfig
  activeSegment: ActiveSegment
  gameNumber: number
  gameScore: ReturnType<typeof calculateGameScore>
  tieBreakScore: ReturnType<typeof calculateTieBreak>
  tieBreakPointsPlayed: number
  sessionElapsed: number
  segmentElapsed: number
  stopConfirm: boolean
  onContinue: () => void
  onStopRequest: () => void
  onStopCancel: () => void
  onStopConfirm: () => void
}) {
  return (
    <section className="screen-stack centered">
      <Header title={activeSegment === 'tiebreak' ? 'Tie-Break Paused' : `Game ${gameNumber} Paused`} subtitle="Both active timers are stopped." />
      <div className="timer-pair">
        <TimerCard value={formatDuration(sessionElapsed)} label="Session Time" />
        <TimerCard value={formatDuration(segmentElapsed)} label={activeSegment === 'tiebreak' ? 'Tie-Break Time' : `Game ${gameNumber} Time`} />
      </div>
      <div className="panel centered">
        {activeSegment === 'tiebreak' ? (
          <>
            <strong>{sideName(config, 'player')} {tieBreakScore.playerPoints} — {tieBreakScore.opponentPoints} {sideName(config, 'opponent')}</strong>
            <small>Final Tie-Break</small>
            <small>Serving: {serverName(config, tieBreakServerForPoint(config, config.totalGames, tieBreakPointsPlayed))}</small>
            <small>Court: {tieBreakCourtSide(tieBreakPointsPlayed) === 'deuce' ? 'Deuce (Right)' : 'Ad (Left)'}</small>
          </>
        ) : (
          <>
            <strong>{sideName(config, 'player')} {gameScore.playerDisplay} — {gameScore.opponentDisplay} {sideName(config, 'opponent')}</strong>
            {gameScore.deuceCount > 0 && <small>Deuce {gameScore.deuceCount}{config.deuceMode === 'limited' ? ` / ${config.maxDeuce}` : ''}</small>}
            <small>Serving: {serverName(config, serverForGame(config, gameNumber - 1))}</small>
          </>
        )}
      </div>
      <button className="button button-primary button-lg" onClick={onContinue}>{activeSegment === 'tiebreak' ? 'CONTINUE TIE-BREAK' : `CONTINUE GAME ${gameNumber}`}</button>
      <button className="button button-secondary" onClick={onStopRequest}>STOP GAME</button>
      {stopConfirm && (
        <div className="panel confirmation">
          <h2>Stop this game?</h2>
          <p>The current multi-Game session will be discarded.</p>
          <div className="two-col">
            <button className="button button-secondary" onClick={onStopCancel}>Continue</button>
            <button className="button button-danger" onClick={onStopConfirm}>Stop Game</button>
          </div>
        </div>
      )}
    </section>
  )
}

function BetweenGamesScreen({
  config,
  record,
  tally,
  sessionElapsed,
  pendingFinalTieBreak,
  onUndo,
  onContinue,
}: {
  config: SessionConfig
  record: GameRecord
  tally: { player: number; opponent: number }
  sessionElapsed: number
  pendingFinalTieBreak: boolean
  onUndo: () => void
  onContinue: () => void
}) {
  const gameScore = calculateGameScore(config, record.events)
  const nextGameIndex = record.gameNumber
  const nextServer = !pendingFinalTieBreak && nextGameIndex < config.totalGames
    ? serverName(config, serverForGame(config, nextGameIndex))
    : null

  return (
    <section className="screen-stack">
      <div className="result-hero">
        <small>{pendingFinalTieBreak ? 'ALL GAMES COMPLETE' : `GAME ${record.gameNumber} COMPLETE`}</small>
        {pendingFinalTieBreak ? (
          <>
            <h1>Games Tied {tally.player}–{tally.opponent}</h1>
            <p>Final Tie-Break will decide the session.</p>
          </>
        ) : (
          <>
            <h1>{sideName(config, record.winner)} {config.mode === 'double' ? 'Win' : 'Wins'} Game {record.gameNumber}</h1>
            <p>Games: {tally.player}–{tally.opponent}</p>
          </>
        )}
      </div>

      <div className="timer-pair">
        <TimerCard value={formatDuration(sessionElapsed)} label="Total Active Time" />
        <TimerCard value={formatDuration(record.durationMs)} label={`Game ${record.gameNumber} Duration`} />
      </div>

      <div className="panel">
        {!pendingFinalTieBreak && nextServer && <Summary label="Next Server" value={nextServer} />}
        <Summary label="Timer Status" value="Stopped during break" />
        <small>Active time resumes only when you continue.</small>
      </div>

      <GameHistory config={config} record={record} score={gameScore} compact />

      <button className="button button-secondary" onClick={onUndo}>↶ UNDO LAST POINT</button>
      <button className="button button-primary button-xl" onClick={onContinue}>
        {pendingFinalTieBreak ? 'START FINAL TIE-BREAK' : `CONTINUE TO GAME ${record.gameNumber + 1}`}
      </button>
    </section>
  )
}

function TieBreakLiveScreen({
  config,
  score,
  tally,
  completedGameCount,
  pointsPlayed,
  sessionElapsed,
  tieBreakElapsed,
  canUndo,
  onPlayerPoint,
  onOpponentPoint,
  onUndo,
  onPause,
}: {
  config: SessionConfig
  score: ReturnType<typeof calculateTieBreak>
  tally: { player: number; opponent: number }
  completedGameCount: number
  pointsPlayed: number
  sessionElapsed: number
  tieBreakElapsed: number
  canUndo: boolean
  onPlayerPoint: () => void
  onOpponentPoint: () => void
  onUndo: () => void
  onPause: () => void
}) {
  const currentServer = tieBreakServerForPoint(config, completedGameCount, pointsPlayed)
  const servingSide = tieBreakServingSideForPoint(config, completedGameCount, pointsPlayed)
  const courtSide = tieBreakCourtSide(pointsPlayed)
  const pointNumber = tieBreakPointNumber(pointsPlayed)
  const changeEndsAfterThisPoint = changesEndsAfterTieBreakPoint(pointsPlayed)
  const nextEndChange = nextTieBreakEndChangeAt(pointsPlayed)
  const servingOrder = tieBreakServingOrder(config, completedGameCount)
    .map((server) => serverName(config, server))
    .join(' → ')

  return (
    <section className="screen-stack compact">
      <div className="result-hero compact-hero"><small>FINAL TIE-BREAK</small><p>Games finished {tally.player}–{tally.opponent}</p></div>
      <TimerStrip sessionElapsed={sessionElapsed} segmentElapsed={tieBreakElapsed} segmentLabel="Tie-Break" />

      <div className="tie-score panel no-pad">
        <TieScoreRow name={sideName(config, 'player')} score={score.playerPoints} />
        <TieScoreRow name={sideName(config, 'opponent')} score={score.opponentPoints} />
      </div>

      <div className="panel tie-server-panel">
        <div>
          <small className="eyebrow">CURRENT SERVER</small>
          <strong className="tie-server-name">{serverName(config, currentServer)} SERVES</strong>
          <span>{config.mode === 'double' ? `Team: ${sideName(config, servingSide)}` : sideName(config, servingSide)}</span>
        </div>
        <div className="court-side-card">
          <small>Court Side</small>
          <strong>{courtSide === 'deuce' ? 'DEUCE COURT' : 'AD COURT'}</strong>
          <span>{courtSide === 'deuce' ? 'Right' : 'Left'}</span>
        </div>
      </div>

      <div className="panel tie-rotation-panel">
        <div className="tie-rotation-top">
          <div><small>Tie-Break Point</small><strong>Point {pointNumber}</strong></div>
          <div className="align-right">
            <small>{changeEndsAfterThisPoint ? 'After this point' : 'Next end change'}</small>
            <strong>{changeEndsAfterThisPoint ? 'CHANGE ENDS' : `At total ${nextEndChange} points`}</strong>
          </div>
        </div>
        {changeEndsAfterThisPoint && <div className="change-ends-banner">CHANGE ENDS AFTER THIS POINT</div>}
        <small className="rotation-order">Serving order: {servingOrder}</small>
      </div>

      <TieBreakBanner config={config} score={score} />
      <PointButtons config={config} inSide={servingSide} onPlayerPoint={onPlayerPoint} onOpponentPoint={onOpponentPoint} />
      <div className="two-col">
        <button className="button button-secondary" disabled={!canUndo} onClick={onUndo}>↶ UNDO</button>
        <button className="button button-secondary" onClick={onPause}>Ⅱ PAUSE</button>
      </div>
    </section>
  )
}

function SessionResultScreen({
  config,
  games,
  tally,
  tieBreakRecord,
  outcome,
  totalElapsed,
  onUndo,
  onNewSession,
  onDone,
}: {
  config: SessionConfig
  games: GameRecord[]
  tally: { player: number; opponent: number }
  tieBreakRecord: TieBreakRecord | null
  outcome: SessionOutcome
  totalElapsed: number
  onUndo: () => void
  onNewSession: () => void
  onDone: () => void
}) {
  const tieScore = tieBreakRecord ? calculateTieBreak(config, tieBreakRecord.events) : null

  return (
    <section className="screen-stack">
      <div className="result-hero">
        <small>SESSION COMPLETE</small>
        <h1>{outcome.draw ? 'DRAW' : `${sideName(config, outcome.winner!)} ${config.mode === 'double' ? 'Win' : 'Wins'}`}</h1>
        <p>
          Games: {tally.player}–{tally.opponent}
          {tieScore && ` · Tie-Break: ${tieScore.playerPoints}–${tieScore.opponentPoints}`}
        </p>
      </div>

      <div className="timer-pair">
        <TimerCard value={formatDuration(totalElapsed)} label="Total Active Time" />
        <TimerCard value={String(games.length)} label="Games Played" />
      </div>

      <div className="panel result-summary">
        <Summary label="Result" value={outcome.draw ? 'Draw' : sideName(config, outcome.winner!)} />
        <Summary label="Games" value={`${tally.player}–${tally.opponent}`} />
        <Summary label="Winning Margin Setting" value={String(config.gameLeadMargin)} />
        <Summary label="Tie Resolution" value={resultResolutionLabel(outcome)} />
      </div>

      <div className="history-list">
        {games.map((record) => (
          <GameHistory
            key={record.gameNumber}
            config={config}
            record={record}
            score={calculateGameScore(config, record.events)}
          />
        ))}
        {tieBreakRecord && tieScore && (
          <div className="panel history-card">
            <div className="history-title">
              <div><strong>Final Tie-Break</strong><small>{tieBreakRecord.draw ? 'Draw' : `${sideName(config, tieBreakRecord.winner!)} won`}</small></div>
              <span>{formatDuration(tieBreakRecord.durationMs)}</span>
            </div>
            <div className="history-head"><small>Point history</small><small>{tieScore.history.length} points</small></div>
            <ol className="point-history">
              {tieScore.history.map((item) => <li key={item.number}><span>{item.number}</span><strong>{item.text}</strong></li>)}
            </ol>
          </div>
        )}
      </div>

      <button className="button button-secondary" onClick={onUndo}>↶ UNDO LAST POINT</button>
      <div className="two-col">
        <button className="button button-primary button-lg" onClick={onNewSession}>NEW SESSION</button>
        <button className="button button-secondary button-lg" onClick={onDone}>DONE</button>
      </div>
    </section>
  )
}

function LiveScoreboardSetupPanel({ session, busy, error, onCreate, onClose }: { session: LiveControllerSession | null; busy: boolean; error: string | null; onCreate: () => void; onClose: () => void }) {
  return (
    <div className="panel live-setup-panel">
      <div>
        <small className="eyebrow">OPTIONAL</small>
        <h2>Live Scoreboard</h2>
        <small>Show this match live on a TV, tablet, laptop or another phone.</small>
      </div>
      {!session ? (
        <button className="button button-secondary" disabled={busy} onClick={onCreate}>{busy ? 'CREATING…' : 'CREATE LIVE SCOREBOARD'}</button>
      ) : (
        <>
          <div className="live-ready-row"><span className="live-dot-small" /><strong>LIVE SCOREBOARD READY</strong></div>
          <LiveLinkDetails session={session} />
          <button className="button button-secondary" disabled={busy} onClick={onClose}>REMOVE LIVE SCOREBOARD</button>
        </>
      )}
      {error && <div className="live-error">{error}</div>}
    </div>
  )
}

function LiveControllerStatus({ session, syncStatus, busy, error, onClose }: { session: LiveControllerSession; syncStatus: 'idle' | 'syncing' | 'connected' | 'offline'; busy: boolean; error: string | null; onClose: () => void }) {
  return (
    <details className="live-controller-bar">
      <summary><span className={`live-dot-small ${syncStatus}`} /> LIVE SCOREBOARD · {session.publicCode}<span>{syncStatus === 'offline' ? 'Reconnecting…' : syncStatus === 'syncing' ? 'Syncing…' : 'Connected'}</span></summary>
      <div className="live-controller-body">
        <LiveLinkDetails session={session} />
        {error && <div className="live-error">{error}</div>}
        <button className="button button-secondary" disabled={busy} onClick={onClose}>CLOSE SCOREBOARD</button>
      </div>
    </details>
  )
}

function LiveLinkDetails({ session }: { session: LiveControllerSession }) {
  const copyLink = async () => {
    try { await navigator.clipboard.writeText(session.scoreboardUrl) } catch { window.prompt('Copy this scoreboard link:', session.scoreboardUrl) }
  }

  return (
    <div className="live-link-details">
      <div className="live-code"><small>Match Code</small><strong>{session.publicCode}</strong></div>
      <div className="live-url" title={session.scoreboardUrl}>{session.scoreboardUrl}</div>
      <div className="two-col">
        <button className="button button-primary" onClick={copyLink}>COPY LINK</button>
        <a className="button button-secondary live-open-link" href={session.scoreboardUrl} target="_blank" rel="noreferrer">OPEN</a>
      </div>
      <details className="qr-details">
        <summary>SHOW QR CODE</summary>
        <div className="qr-box"><QRCodeSVG value={session.scoreboardUrl} size={180} bgColor="#ffffff" fgColor="#0f172a" /></div>
      </details>
      <small>Link expires automatically 24 hours after the match ends, or 24 hours after creation if the match never starts.</small>
    </div>
  )
}

function TimerStrip({ sessionElapsed, segmentElapsed, segmentLabel }: { sessionElapsed: number; segmentElapsed: number; segmentLabel: string }) {
  return (
    <div className="timer-strip">
      <div><strong>{formatDuration(sessionElapsed)}</strong><span>Session</span></div>
      <div><strong>{formatDuration(segmentElapsed)}</strong><span>{segmentLabel}</span></div>
      <div><strong>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong><span>Clock</span></div>
    </div>
  )
}

function TimerCard({ value, label }: { value: string; label: string }) {
  return <div className="timer-card"><strong>{value}</strong><span>{label}</span></div>
}

function ScoreBoard({ config, score, server }: { config: SessionConfig; score: ReturnType<typeof calculateGameScore>; server: keyof SessionConfig['names'] }) {
  const playerSideServer = server === 'player1' || server === 'player2'
  return (
    <div className="scoreboard panel no-pad">
      <ScoreRow name={sideName(config, 'player')} role={config.mode === 'single' ? 'Player' : 'Your Team'} score={score.playerDisplay} server={playerSideServer ? config.names[server] : ''} advantage={score.advantage === 'player'} />
      <ScoreRow name={sideName(config, 'opponent')} role={config.mode === 'single' ? 'Opponent' : 'Opponent Team'} score={score.opponentDisplay} server={!playerSideServer ? config.names[server] : ''} advantage={score.advantage === 'opponent'} />
    </div>
  )
}

function ScoreRow({ name, role, score, server, advantage }: { name: string; role: string; score: string; server: string; advantage: boolean }) {
  return (
    <div className="score-row">
      <div className="score-name"><strong>{name}</strong><small>{role}</small></div>
      <div>{server && <span className="serve-badge">{server} SERVES</span>}</div>
      <div className="score-value"><strong>{score}</strong>{advantage && <small>ADV</small>}</div>
    </div>
  )
}

function TieScoreRow({ name, score }: { name: string; score: number }) {
  return <div className="tie-score-row"><strong>{name}</strong><span>{score}</span></div>
}

function PointButtons({
  config,
  inSide = 'player',
  onPlayerPoint,
  onOpponentPoint,
}: {
  config: SessionConfig
  inSide?: Side
  onPlayerPoint: () => void
  onOpponentPoint: () => void
}) {
  const outSide = pointWinnerForCall(inSide, 'out')
  const award = (side: Side) => (side === 'player' ? onPlayerPoint : onOpponentPoint)
  const onInPoint = award(pointWinnerForCall(inSide, 'in'))
  const onOutPoint = award(outSide)

  return (
    <div className="score-buttons">
      <button className="score-action in" onClick={onInPoint}>
        IN<span>{sideName(config, inSide)} + point</span>
      </button>
      <button className="score-action out" onClick={onOutPoint}>
        OUT<span>{sideName(config, outSide)} + point</span>
      </button>
    </div>
  )
}

function DeuceBanner({ config, score }: { config: SessionConfig; score: ReturnType<typeof calculateGameScore> }) {
  if (score.suddenDeath) {
    return <div className="deuce-banner"><strong>FINAL DEUCE</strong><span>NEXT POINT WINS</span><small>Deuce {score.deuceCount} / {config.maxDeuce}</small></div>
  }
  if (score.status === 'deuce') {
    return <div className="deuce-banner"><strong>DEUCE</strong>{config.deuceMode === 'limited' && <small>Deuce {score.deuceCount} / {config.maxDeuce}</small>}</div>
  }
  if (score.status === 'advantage') {
    return <div className="deuce-banner small"><strong>Advantage {sideName(config, score.advantage!)}</strong></div>
  }
  return null
}

function TieBreakBanner({ config, score }: { config: SessionConfig; score: ReturnType<typeof calculateTieBreak> }) {
  if (score.status === 'at-cap-sudden-death') {
    return <div className="deuce-banner"><strong>MAXIMUM REACHED</strong><span>NEXT POINT WINS</span><small>Sudden Death</small></div>
  }
  if (score.status === 'at-cap-unlimited') {
    return <div className="deuce-banner"><strong>MAXIMUM REACHED</strong><span>PLAY CONTINUES</span><small>Win by {config.tieBreakMargin}</small></div>
  }
  return <div className="deuce-banner small"><strong>First to {config.tieBreakMaxPoint}</strong><small>Equal at maximum: {tieBreakEqualLabel(config.tieBreakEqualResolution)}</small></div>
}

function GameHistory({ config, record, score, compact = false }: { config: SessionConfig; record: GameRecord; score: ReturnType<typeof calculateGameScore>; compact?: boolean }) {
  return (
    <div className="panel history-card">
      <div className="history-title">
        <div><strong>Game {record.gameNumber}</strong><small>{sideName(config, record.winner)} {config.mode === 'double' ? 'won' : 'won'} · Server: {serverName(config, record.server)}</small></div>
        <span>{formatDuration(record.durationMs)}</span>
      </div>
      <div className="history-head"><small>Point history</small><small>{score.history.length} points</small></div>
      <ol className={`point-history ${compact ? 'compact-history' : ''}`}>
        {score.history.map((item) => <li key={item.number}><span>{item.number}</span><strong>{item.text}</strong></li>)}
      </ol>
    </div>
  )
}

function Choice({ selected, title, subtitle, onClick }: { selected: boolean; title: string; subtitle: string; onClick: () => void }) {
  return <button className={`choice ${selected ? 'selected' : ''}`} onClick={onClick}><strong>{title}</strong><span>{subtitle}</span></button>
}

function ChoiceCompact({ selected, title, subtitle, onClick }: { selected: boolean; title: string; subtitle?: string; onClick: () => void }) {
  return <button className={`choice compact-choice ${selected ? 'selected' : ''}`} onClick={onClick}><strong>{title}</strong>{subtitle && <span>{subtitle}</span>}</button>
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="field"><span>{label}</span><input value={value} onChange={(event: { target: { value: string } }) => onChange(event.target.value)} /></label>
}

function SelectField({ label, value, values, onChange }: { label: string; value: number; values: number[]; onChange: (value: number) => void }) {
  return <label className="field"><span>{label}</span><select value={value} onChange={(event: { target: { value: string } }) => onChange(Number(event.target.value))}>{values.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
}

function NavButtons({ onBack, onNext, nextLabel }: { onBack: () => void; onNext: () => void; nextLabel: string }) {
  return <div className="two-col"><button className="button button-secondary" onClick={onBack}>BACK</button><button className="button button-primary" onClick={onNext}>{nextLabel}</button></div>
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div><small>{label}</small><strong>{value}</strong></div>
}

function InfoBox({ children }: { children: ReactNode }) {
  return <div className="info-box">{children}</div>
}

function range(min: number, max: number) {
  return Array.from({ length: max - min + 1 }, (_, index) => min + index)
}

function tieBreakEqualLabel(value: TieBreakEqualResolution) {
  if (value === 'draw') return 'Make it DRAW'
  if (value === 'sudden-death') return 'Sudden Death'
  return 'Unlimited until margin reached'
}

function resultResolutionLabel(outcome: SessionOutcome) {
  if (outcome.decidedBy === 'games') return 'Games result'
  if (outcome.decidedBy === 'games-draw') return 'Games tied → Draw'
  if (outcome.decidedBy === 'tiebreak-draw') return 'Tie-Break → Draw'
  return 'Final Tie-Break'
}

export default App
