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
    player1: '',
    player2: '',
    opponent1: '',
    opponent2: '',
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

const SETUP_STEPS = 7

function Header({ title, subtitle, step }: { title: string; subtitle?: string; step?: number }) {
  return (
    <div className="screen-header">
      {step && (
        <div className="setup-progress" role="img" aria-label={`Setup step ${step} of ${SETUP_STEPS}`}>
          {range(1, SETUP_STEPS).map((index) => <span key={index} className={index <= step ? 'done' : ''} />)}
        </div>
      )}
      <h1>{title}</h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  )
}

function Welcome({ onStart }: { onStart: () => void }) {
  return (
    <section className="welcome-screen">
      <div className="court-hero" aria-hidden="true">
        <div className="court-hero-inner">
          <div className="court-hero-net" />
          <BallIcon className="court-hero-ball" />
        </div>
      </div>
      <div>
        <h1>Self-Operated<br />Tennis Score</h1>
        <p>Keep score while you focus on playing.</p>
      </div>
      <button className="button button-primary button-xl" onClick={onStart}>Start</button>
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
      <Header step={1} title="Choose Play Mode" subtitle="How are you playing today?" />
      <Choice selected={mode === 'single'} title="Singles" subtitle="1 player vs 1 opponent" onClick={() => onSelect('single')} />
      <Choice selected={mode === 'double'} title="Doubles" subtitle="2 players vs 2 opponents" onClick={() => onSelect('double')} />
      <NavButtons onBack={onBack} onNext={onNext} nextLabel="Next" />
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
      <Header step={2} title="Player Names" subtitle={config.mode === 'single' ? 'Enter the two players.' : 'Enter both teams.'} />
      {config.mode === 'single' ? (
        <div className="names-card">
          <TextField label="Your Name" placeholder="e.g. Ardi" value={draft.player1} onChange={(value) => setDraft({ ...draft, player1: value })} />
          <div className="vs-divider"><span>vs</span></div>
          <TextField label="Opponent Name" placeholder="e.g. Marcus" value={draft.opponent1} onChange={(value) => setDraft({ ...draft, opponent1: value })} />
        </div>
      ) : (
        <div className="names-card">
          <h2>Your Team</h2>
          <TextField label="Player 1" placeholder="Enter a name" value={draft.player1} onChange={(value) => setDraft({ ...draft, player1: value })} />
          <TextField label="Player 2" placeholder="Enter a name" value={draft.player2} onChange={(value) => setDraft({ ...draft, player2: value })} />
          <div className="vs-divider"><span>vs</span></div>
          <h2>Opponent Team</h2>
          <TextField label="Opponent 1" placeholder="Enter a name" value={draft.opponent1} onChange={(value) => setDraft({ ...draft, opponent1: value })} />
          <TextField label="Opponent 2" placeholder="Enter a name" value={draft.opponent2} onChange={(value) => setDraft({ ...draft, opponent2: value })} />
        </div>
      )}
      {error && <div className="form-error" role="alert">{error}</div>}
      <NavButtons onBack={onBack} onNext={next} nextLabel="Next" />
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
      <Header step={3} title="Deuce Setup" subtitle="This rule applies inside every Game." />
      <Choice selected={mode === 'unlimited'} title="Unlimited Deuce" subtitle="Continue until one side wins by two points." onClick={() => onMode('unlimited')} />
      <div className={`choice-group ${mode === 'limited' ? 'selected' : ''}`}>
        <Choice selected={mode === 'limited'} title="Limited Deuce" subtitle="Maximum 1–10 Deuces, then next point wins." onClick={() => onMode('limited')} />
        {mode === 'limited' && (
          <div className="choice-detail">
            <Stepper label="Maximum Number of Deuces" value={maxDeuce} min={1} max={10} onChange={(value) => onMax(clampWhole(value, 1, 10))} />
          </div>
        )}
      </div>
      <NavButtons onBack={onBack} onNext={onNext} nextLabel="Next" />
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
      <Header step={4} title="How many Games do you want to play?" subtitle="Choose a fixed total number of Games for this session." />
      <Stepper hero label="Number of Games" hint="2 to 10 Games" value={totalGames} min={2} max={10} onChange={(value) => onTotal(clampWhole(value, 2, 10))} />
      <div className="panel future-panel">
        <div>
          <strong>Configure Sets instead?</strong>
          <small>Coming in Phase 2</small>
        </div>
        <button className="button button-secondary" disabled>Sets</button>
      </div>
      <NavButtons onBack={onBack} onNext={onNext} nextLabel="Next" />
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
      <Header step={5} title="Games Format" subtitle="Configure how the overall Games result is decided." />
      <div className="panel">
        <h2>How many Games must the winner lead by?</h2>
        <Segmented label="How many Games must the winner lead by?" value={margin} values={[1, 2]} onChange={(value) => onMargin(value === 1 ? 1 : 2)} />
        <InfoBox>Because the number of Games is fixed, play still ends after the configured total. If the final score is not tied, the side with more Games wins even when this preferred margin is not met.</InfoBox>
      </div>
      <h2 className="section-question">If the Games score is tied when all configured Games are complete:</h2>
      <Choice selected={tieResolution === 'draw'} title="Finish as DRAW" subtitle="End the session with no winner." onClick={() => onTieResolution('draw')} />
      <Choice selected={tieResolution === 'tiebreak'} title="Use Tie-Break" subtitle="Play a final numeric Tie-Break to decide the session." onClick={() => onTieResolution('tiebreak')} />
      <NavButtons onBack={onBack} onNext={onNext} nextLabel={tieResolution === 'tiebreak' ? 'Configure Tie-Break' : 'Play'} />
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
      <Header step={6} title="Tie-Break Setup" subtitle="Used only when the configured Games finish tied." />
      <div className="panel">
        <h2>Maximum Tie-Break Point</h2>
        <ChipRow label="Maximum Tie-Break Point" value={maxPoint} values={range(5, 10)} onChange={(value) => onMaxPoint(clampWhole(value, 5, 10))} />
        <div className="inline-setting">
          <span>Tie-Break Winning Margin</span>
          <Segmented label="Tie-Break Winning Margin" value={margin} values={[1, 2]} onChange={(value) => onMargin(value === 1 ? 1 : 2)} />
        </div>
        <InfoBox>The selected margin applies at the target. For example, with target 7 and margin 2, 7–6 continues; if it reaches 7–7, the selected equal-score resolution applies.</InfoBox>
      </div>
      <h2 className="section-question">If both sides reach the maximum equally:</h2>
      <Choice selected={equalResolution === 'unlimited'} title="Unlimited Until Margin Reached" subtitle={`Continue until one side leads by ${margin}.`} onClick={() => onEqualResolution('unlimited')} />
      <Choice selected={equalResolution === 'sudden-death'} title="Sudden Death" subtitle="The next point wins." onClick={() => onEqualResolution('sudden-death')} />
      <Choice selected={equalResolution === 'draw'} title="Make it DRAW" subtitle="End the session immediately as a draw." onClick={() => onEqualResolution('draw')} />
      <NavButtons onBack={onBack} onNext={onNext} nextLabel="Play" />
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
      <Header step={7} title="Who is going to play first?" subtitle="Set the serving order before Game 1." />

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
      <NavButtons onBack={onBack} onNext={onStart} nextLabel="Let's play!" />
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
      <ScoreBoard
        config={config}
        score={score}
        progress={(
          <div className="game-progress">
            <div><small>Game {currentGameIndex + 1} of {config.totalGames}</small><strong>Games: {tally.player}–{tally.opponent}</strong></div>
            <ServeBadge name={serverName(config, server)} />
          </div>
        )}
      />
      <DeuceBanner config={config} score={score} />
      <PointButtons config={config} inSide={servingSide} onPlayerPoint={onPlayerPoint} onOpponentPoint={onOpponentPoint} />
      <PlayControls canUndo={canUndo} onUndo={onUndo} onPause={onPause} />
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
      <div className="pause-icon" aria-hidden="true"><PauseIcon /></div>
      <Header title={activeSegment === 'tiebreak' ? 'Tie-Break Paused' : `Game ${gameNumber} Paused`} subtitle="Both active timers are stopped." />
      <div className="timer-pair">
        <TimerCard value={formatDuration(sessionElapsed)} label="Session Time" />
        <TimerCard value={formatDuration(segmentElapsed)} label={activeSegment === 'tiebreak' ? 'Tie-Break Time' : `Game ${gameNumber} Time`} />
      </div>
      <div className="panel pause-score">
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
      <button className="button button-primary button-lg" onClick={onContinue}>{activeSegment === 'tiebreak' ? 'Continue Tie-Break' : `Continue Game ${gameNumber}`}</button>
      <button className="button button-secondary" onClick={onStopRequest}>Stop Game</button>
      {stopConfirm && (
        <>
          <div className="sheet-backdrop" onClick={onStopCancel} />
          <div className="sheet confirmation" role="dialog" aria-modal="true" aria-labelledby="stop-title">
            <h2 id="stop-title">Stop this game?</h2>
            <p>The current multi-Game session will be discarded.</p>
            <div className="two-col">
              <button className="button button-secondary" onClick={onStopCancel}>Continue</button>
              <button className="button button-danger" onClick={onStopConfirm}>Stop Game</button>
            </div>
          </div>
        </>
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
      <div className={`result-hero ${pendingFinalTieBreak ? 'tied' : ''}`}>
        <small>{pendingFinalTieBreak ? 'All Games complete' : `Game ${record.gameNumber} complete`}</small>
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
        {!pendingFinalTieBreak && nextServer && <Summary label="Next Server" value={nextServer} ball />}
        <Summary label="Timer Status" value="Stopped during break" />
        <small>Active time resumes only when you continue.</small>
      </div>

      <GameHistory config={config} record={record} score={gameScore} compact />

      <div className="sticky-actions">
        <button className="button button-secondary" onClick={onUndo}><UndoIcon />Undo Last Point</button>
        <button className="button button-primary button-xl" onClick={onContinue}>
          {pendingFinalTieBreak ? 'Start Final Tie-Break' : `Continue to Game ${record.gameNumber + 1}`}
        </button>
      </div>
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
      <div className="result-hero compact-hero"><small>Final Tie-Break</small><p>Games finished {tally.player}–{tally.opponent}</p></div>
      <TimerStrip sessionElapsed={sessionElapsed} segmentElapsed={tieBreakElapsed} segmentLabel="Tie-Break" />

      <div className="tie-score">
        <TieScoreRow name={sideName(config, 'player')} score={score.playerPoints} />
        <TieScoreRow name={sideName(config, 'opponent')} score={score.opponentPoints} />
      </div>

      <div className="panel tie-server-panel">
        <div>
          <small className="eyebrow">Current Server</small>
          <strong className="tie-server-name">{serverName(config, currentServer)} serves</strong>
          <span>{config.mode === 'double' ? `Team: ${sideName(config, servingSide)}` : sideName(config, servingSide)}</span>
        </div>
        <div className="court-side-card">
          <small>Court Side</small>
          <strong>{courtSide === 'deuce' ? 'Deuce court' : 'Ad court'}</strong>
          <span>{courtSide === 'deuce' ? 'Right' : 'Left'}</span>
        </div>
      </div>

      <div className={`panel tie-rotation-panel ${changeEndsAfterThisPoint ? 'ends' : ''}`}>
        <div className="tie-rotation-top">
          <div><small>Tie-Break Point</small><strong>Point {pointNumber}</strong></div>
          <div className="align-right">
            <small>{changeEndsAfterThisPoint ? 'After this point' : 'Next end change'}</small>
            <strong>{changeEndsAfterThisPoint ? 'Change ends' : `At total ${nextEndChange} points`}</strong>
          </div>
        </div>
        {changeEndsAfterThisPoint && <div className="change-ends-banner" role="status"><SwapIcon />Change ends after this point</div>}
        <small className="rotation-order">Serving order: {servingOrder}</small>
      </div>

      <TieBreakBanner config={config} score={score} />
      <PointButtons config={config} inSide={servingSide} onPlayerPoint={onPlayerPoint} onOpponentPoint={onOpponentPoint} />
      <PlayControls canUndo={canUndo} onUndo={onUndo} onPause={onPause} />
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
      <div className={`result-hero ${outcome.draw ? '' : 'winner'}`}>
        <small>Session complete</small>
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
            collapsible
          />
        ))}
        {tieBreakRecord && tieScore && (
          <details className="panel history-card" open>
            <summary className="history-title">
              <div><strong>Final Tie-Break</strong><small>{tieBreakRecord.draw ? 'Draw' : `${sideName(config, tieBreakRecord.winner!)} won`} · {tieScore.history.length} points</small></div>
              <span>{formatDuration(tieBreakRecord.durationMs)}<ChevronIcon /></span>
            </summary>
            <ol className="point-history">
              {tieScore.history.map((item) => <li key={item.number}><span>{item.number}</span><strong>{item.text}</strong></li>)}
            </ol>
          </details>
        )}
      </div>

      <div className="sticky-actions">
        <button className="button button-secondary" onClick={onUndo}><UndoIcon />Undo Last Point</button>
        <div className="two-col nav-buttons nav-buttons-result">
          <button className="button button-primary button-lg" onClick={onNewSession}>New Session</button>
          <button className="button button-secondary button-lg" onClick={onDone}>Done</button>
        </div>
      </div>
    </section>
  )
}

function LiveScoreboardSetupPanel({ session, busy, error, onCreate, onClose }: { session: LiveControllerSession | null; busy: boolean; error: string | null; onCreate: () => void; onClose: () => void }) {
  return (
    <div className={`panel live-setup-panel ${session ? 'ready' : ''}`}>
      <div>
        <small className="eyebrow">Optional</small>
        <h2>Live Scoreboard</h2>
        <small>Show this match live on a TV, tablet, laptop or another phone.</small>
      </div>
      {!session ? (
        <button className="button button-secondary" disabled={busy} onClick={onCreate}>{busy ? 'Creating…' : 'Create Live Scoreboard'}</button>
      ) : (
        <>
          <div className="live-ready-row"><span className="live-dot-small" /><strong>Live Scoreboard ready</strong></div>
          <LiveLinkDetails session={session} />
          <button className="button button-secondary" disabled={busy} onClick={onClose}>Remove Live Scoreboard</button>
        </>
      )}
      {error && <div className="live-error">{error}</div>}
    </div>
  )
}

function LiveControllerStatus({ session, syncStatus, busy, error, onClose }: { session: LiveControllerSession; syncStatus: 'idle' | 'syncing' | 'connected' | 'offline'; busy: boolean; error: string | null; onClose: () => void }) {
  return (
    <details className="live-controller-bar">
      <summary><span className={`live-dot-small ${syncStatus}`} /> Live Scoreboard · {session.publicCode}<span>{syncStatus === 'offline' ? 'Reconnecting…' : syncStatus === 'syncing' ? 'Syncing…' : 'Connected'}</span></summary>
      <div className="live-controller-body">
        <LiveLinkDetails session={session} />
        {error && <div className="live-error">{error}</div>}
        <button className="button button-secondary" disabled={busy} onClick={onClose}>Close Scoreboard</button>
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
        <button className="button button-primary" onClick={copyLink}>Copy Link</button>
        <a className="button button-secondary live-open-link" href={session.scoreboardUrl} target="_blank" rel="noreferrer">Open</a>
      </div>
      <details className="qr-details">
        <summary>Show QR Code</summary>
        <div className="qr-box"><QRCodeSVG value={session.scoreboardUrl} size={180} bgColor="#ffffff" fgColor="#0F2440" /></div>
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

function ScoreBoard({ config, score, progress }: { config: SessionConfig; score: ReturnType<typeof calculateGameScore>; progress: ReactNode }) {
  return (
    <div className="scoreboard">
      {progress}
      <ScoreRow name={sideName(config, 'player')} role={config.mode === 'single' ? 'Player' : 'Your Team'} score={score.playerDisplay} advantage={score.advantage === 'player'} />
      <div className="score-net" aria-hidden="true" />
      <ScoreRow name={sideName(config, 'opponent')} role={config.mode === 'single' ? 'Opponent' : 'Opponent Team'} score={score.opponentDisplay} advantage={score.advantage === 'opponent'} />
    </div>
  )
}

function ScoreRow({ name, role, score, advantage }: { name: string; role: string; score: string; advantage: boolean }) {
  return (
    <div className="score-row">
      <div className="score-name"><strong>{name}</strong><small>{role}</small></div>
      <div className="score-value">{advantage && <span className="adv-tag">ADV</span>}<strong>{score}</strong></div>
    </div>
  )
}

function ServeBadge({ name }: { name: string }) {
  return <span className="serve-badge"><BallIcon className="icon" dark /><span className="serve-name">{name}</span> serves</span>
}

function PlayControls({ canUndo, onUndo, onPause }: { canUndo: boolean; onUndo: () => void; onPause: () => void }) {
  return (
    <div className="two-col">
      <button className="button button-secondary" disabled={!canUndo} onClick={onUndo}><UndoIcon />Undo</button>
      <button className="button button-secondary" onClick={onPause}><PauseIcon />Pause</button>
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

function GameHistory({ config, record, score, compact = false, collapsible = false }: { config: SessionConfig; record: GameRecord; score: ReturnType<typeof calculateGameScore>; compact?: boolean; collapsible?: boolean }) {
  const title = <div><strong>Game {record.gameNumber}</strong><small>{sideName(config, record.winner)} won · Server: {serverName(config, record.server)}{collapsible ? ` · ${score.history.length} points` : ''}</small></div>
  const points = (
    <ol className={`point-history ${compact ? 'compact-history' : ''}`}>
      {score.history.map((item) => <li key={item.number}><span>{item.number}</span><strong>{item.text}</strong></li>)}
    </ol>
  )
  if (collapsible) {
    return (
      <details className="panel history-card">
        <summary className="history-title">{title}<span>{formatDuration(record.durationMs)}<ChevronIcon /></span></summary>
        {points}
      </details>
    )
  }
  return (
    <div className="panel history-card">
      <div className="history-title">{title}<span>{formatDuration(record.durationMs)}</span></div>
      <div className="history-head"><small>Point history</small><small>{score.history.length} points</small></div>
      {points}
    </div>
  )
}

function Choice({ selected, title, subtitle, onClick }: { selected: boolean; title: string; subtitle: string; onClick: () => void }) {
  return (
    <button className={`choice ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={onClick}>
      <span className="choice-radio" aria-hidden="true" />
      <span className="choice-text"><strong>{title}</strong><span>{subtitle}</span></span>
    </button>
  )
}

function ChoiceCompact({ selected, title, subtitle, onClick }: { selected: boolean; title: string; subtitle?: string; onClick: () => void }) {
  return (
    <button className={`choice compact-choice ${selected ? 'selected' : ''}`} aria-pressed={selected} onClick={onClick}>
      <span className="choice-radio" aria-hidden="true" />
      <span className="choice-text"><strong>{selected && <BallIcon className="choice-ball" dark />} {title}</strong>{subtitle && <span>{subtitle}</span>}</span>
    </button>
  )
}

function TextField({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (value: string) => void }) {
  return <label className="field"><span>{label}</span><input value={value} placeholder={placeholder} onChange={(event: { target: { value: string } }) => onChange(event.target.value)} /></label>
}

function Stepper({ label, value, min, max, hint, hero = false, onChange }: { label: string; value: number; min: number; max: number; hint?: string; hero?: boolean; onChange: (value: number) => void }) {
  return (
    <div className={`stepper-field ${hero ? 'stepper-hero' : ''}`} role="group" aria-label={label}>
      <span>{label}</span>
      <div className="stepper">
        <button type="button" aria-label={`Decrease ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>−</button>
        <output aria-live="polite">{value}</output>
        <button type="button" aria-label={`Increase ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>+</button>
      </div>
      {hint && <span className="stepper-hint">{hint}</span>}
    </div>
  )
}

function ChipRow({ label, value, values, onChange }: { label: string; value: number; values: number[]; onChange: (value: number) => void }) {
  return (
    <div className="chip-row" role="group" aria-label={label}>
      {values.map((item) => <button type="button" key={item} className={`chip ${item === value ? 'selected' : ''}`} aria-pressed={item === value} onClick={() => onChange(item)}>{item}</button>)}
    </div>
  )
}

function Segmented({ label, value, values, onChange }: { label: string; value: number; values: number[]; onChange: (value: number) => void }) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {values.map((item) => <button type="button" key={item} className={item === value ? 'selected' : ''} aria-pressed={item === value} onClick={() => onChange(item)}>{item}</button>)}
    </div>
  )
}

function NavButtons({ onBack, onNext, nextLabel }: { onBack: () => void; onNext: () => void; nextLabel: string }) {
  return (
    <div className="sticky-actions">
      <div className="two-col nav-buttons"><button className="button button-secondary" onClick={onBack}>Back</button><button className="button button-primary" onClick={onNext}>{nextLabel}</button></div>
    </div>
  )
}

function BallIcon({ className = 'icon', dark = false }: { className?: string; dark?: boolean }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="10.5" fill={dark ? '#0F2440' : '#DFF04A'} />
      <path d="M3.5 7c4.5 2.2 4.5 7.8 0 10M20.5 7c-4.5 2.2-4.5 7.8 0 10" fill="none" stroke={dark ? '#DFF04A' : '#FFFFFF'} strokeWidth="1.5" />
    </svg>
  )
}

function UndoIcon() {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></svg>
}

function PauseIcon() {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" aria-hidden="true"><path d="M8 5v14M16 5v14" /></svg>
}

function SwapIcon() {
  return <svg className="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" aria-hidden="true"><path d="M4 9h13l-3-3M20 15H7l3 3" /></svg>
}

function ChevronIcon() {
  return <svg className="icon history-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M6 9l6 6 6-6" /></svg>
}

function Summary({ label, value, ball = false }: { label: string; value: string; ball?: boolean }) {
  return <div className="summary-item"><small>{label}</small><strong>{ball && <BallIcon className="icon" />} {value}</strong></div>
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
