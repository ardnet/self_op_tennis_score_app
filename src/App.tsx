import { useEffect, useMemo, useState } from 'react'
import { calculateScore, sideName } from './domain/scoring'
import type {
  DeuceMode,
  GameConfig,
  PersistedAppState,
  PlayMode,
  Screen,
  ServerId,
  Side,
} from './domain/types'
import { clearState, loadState, saveState } from './storage/localStorage'

const defaultConfig: GameConfig = {
  mode: 'single',
  names: {
    player1: 'Player',
    player2: 'Partner',
    opponent1: 'Opponent',
    opponent2: 'Opponent 2',
  },
  deuceMode: 'unlimited',
  maxDeuce: 4,
  server: 'player1',
}

function nowMs() {
  return Date.now()
}

function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}

function App() {
  const restored = useMemo(() => loadState(), [])
  const [screen, setScreen] = useState<Screen>(restored?.screen ?? 'welcome')
  const [config, setConfig] = useState<GameConfig>(restored?.config ?? defaultConfig)
  const [events, setEvents] = useState<Side[]>(restored?.events ?? [])
  const [paused, setPaused] = useState(restored?.paused ?? false)
  const [stopConfirm, setStopConfirm] = useState(restored?.stopConfirm ?? false)
  const [elapsedBeforeRun, setElapsedBeforeRun] = useState(restored?.elapsedBeforeRun ?? 0)
  const [runStartedAt, setRunStartedAt] = useState<number | null>(restored?.runStartedAt ?? null)
  const [finishedElapsed, setFinishedElapsed] = useState<number | null>(restored?.finishedElapsed ?? null)
  const [, setClockTick] = useState(0)

  const score = useMemo(() => calculateScore(config, events), [config, events])

  useEffect(() => {
    const timer = window.setInterval(() => setClockTick((n) => n + 1), 500)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    const snapshot: PersistedAppState = {
      screen,
      config,
      events,
      paused,
      stopConfirm,
      elapsedBeforeRun,
      runStartedAt,
      finishedElapsed,
    }
    saveState(snapshot)
  }, [screen, config, events, paused, stopConfirm, elapsedBeforeRun, runStartedAt, finishedElapsed])

  function elapsedMs() {
    if (finishedElapsed !== null) return finishedElapsed
    let total = elapsedBeforeRun
    if (runStartedAt !== null && !paused) total += nowMs() - runStartedAt
    return total
  }

  function resetGame() {
    setEvents([])
    setPaused(false)
    setStopConfirm(false)
    setElapsedBeforeRun(0)
    setRunStartedAt(null)
    setFinishedElapsed(null)
  }

  function startGame() {
    resetGame()
    setRunStartedAt(nowMs())
    setScreen('live')
  }

  function addPoint(side: Side) {
    const nextEvents = [...events, side]
    const nextScore = calculateScore(config, nextEvents)
    setEvents(nextEvents)

    if (nextScore.winner) {
      let total = elapsedBeforeRun
      if (runStartedAt !== null) total += nowMs() - runStartedAt
      setElapsedBeforeRun(total)
      setFinishedElapsed(total)
      setRunStartedAt(null)
      setScreen('result')
    }
  }

  function undoPoint(fromResult = false) {
    if (!events.length) return
    setEvents((current) => current.slice(0, -1))

    if (fromResult) {
      setFinishedElapsed(null)
      setRunStartedAt(nowMs())
      setPaused(false)
      setScreen('live')
    }
  }

  function pauseGame() {
    let total = elapsedBeforeRun
    if (runStartedAt !== null) total += nowMs() - runStartedAt
    setElapsedBeforeRun(total)
    setRunStartedAt(null)
    setPaused(true)
    setScreen('pause')
  }

  function resumeGame() {
    setPaused(false)
    setStopConfirm(false)
    setRunStartedAt(nowMs())
    setScreen('live')
  }

  function stopGame() {
    resetGame()
    clearState()
    setScreen('welcome')
  }

  function done() {
    resetGame()
    clearState()
    setScreen('welcome')
  }

  return (
    <main className="app-shell">
      <div className="phone-card">
        {screen === 'welcome' && <Welcome onStart={() => setScreen('mode')} />}
        {screen === 'mode' && (
          <ModeScreen
            mode={config.mode}
            onSelect={(mode) => setConfig((c) => ({ ...c, mode, server: 'player1' }))}
            onBack={() => setScreen('welcome')}
            onNext={() => setScreen('names')}
          />
        )}
        {screen === 'names' && (
          <NamesScreen
            config={config}
            onChange={(names) => setConfig((c) => ({ ...c, names }))}
            onBack={() => setScreen('mode')}
            onNext={() => setScreen('config')}
          />
        )}
        {screen === 'config' && (
          <DeuceScreen
            mode={config.deuceMode}
            maxDeuce={config.maxDeuce}
            onMode={(deuceMode) => setConfig((c) => ({ ...c, deuceMode }))}
            onMax={(maxDeuce) => setConfig((c) => ({ ...c, maxDeuce }))}
            onBack={() => setScreen('names')}
            onNext={() => setScreen('server')}
          />
        )}
        {screen === 'server' && (
          <ServerScreen
            config={config}
            onSelect={(server) => setConfig((c) => ({ ...c, server }))}
            onBack={() => setScreen('config')}
            onStart={startGame}
          />
        )}
        {screen === 'live' && (
          <LiveScreen
            config={config}
            score={score}
            elapsed={elapsedMs()}
            canUndo={events.length > 0}
            onPlayerPoint={() => addPoint('player')}
            onOpponentPoint={() => addPoint('opponent')}
            onUndo={() => undoPoint(false)}
            onPause={pauseGame}
          />
        )}
        {screen === 'pause' && (
          <PauseScreen
            config={config}
            score={score}
            elapsed={elapsedMs()}
            stopConfirm={stopConfirm}
            onContinue={resumeGame}
            onStopRequest={() => setStopConfirm(true)}
            onStopCancel={() => setStopConfirm(false)}
            onStopConfirm={stopGame}
          />
        )}
        {screen === 'result' && (
          <ResultScreen
            config={config}
            score={score}
            elapsed={elapsedMs()}
            onUndo={() => undoPoint(true)}
            onNewGame={() => {
              resetGame()
              setScreen('server')
            }}
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
        <h1>Tennis Score</h1>
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
  config: GameConfig
  onChange: (names: GameConfig['names']) => void
  onBack: () => void
  onNext: () => void
}) {
  const [draft, setDraft] = useState(config.names)
  const [error, setError] = useState('')

  const required = config.mode === 'single'
    ? [draft.player1, draft.opponent1]
    : [draft.player1, draft.player2, draft.opponent1, draft.opponent2]

  function next() {
    if (required.some((v) => !v.trim())) {
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
      <Header title="Deuce Setup" subtitle="Choose how Deuce should be handled." />
      <Choice selected={mode === 'unlimited'} title="Unlimited Deuce" subtitle="Continue until one side wins by two points." onClick={() => onMode('unlimited')} />
      <Choice selected={mode === 'limited'} title="Limited Deuce" subtitle="Maximum 1–10 Deuces, then next point wins." onClick={() => onMode('limited')} />
      {mode === 'limited' && (
        <label className="field">
          <span>Maximum Number of Deuces</span>
          <select value={maxDeuce} onChange={(e) => onMax(Math.max(1, Math.min(10, Number(e.target.value))))}>
            {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </label>
      )}
      <NavButtons onBack={onBack} onNext={onNext} nextLabel="PLAY" />
    </section>
  )
}

function ServerScreen({
  config,
  onSelect,
  onBack,
  onStart,
}: {
  config: GameConfig
  onSelect: (server: ServerId) => void
  onBack: () => void
  onStart: () => void
}) {
  const options: Array<[ServerId, string, string]> = config.mode === 'single'
    ? [['player1', config.names.player1, 'Player'], ['opponent1', config.names.opponent1, 'Opponent']]
    : [
      ['player1', config.names.player1, 'Player 1'],
      ['player2', config.names.player2, 'Player 2'],
      ['opponent1', config.names.opponent1, 'Opponent 1'],
      ['opponent2', config.names.opponent2, 'Opponent 2'],
    ]

  return (
    <section className="screen-stack">
      <Header title="Who is going to play first?" subtitle="Select the person who will serve for this Game." />
      <div className="server-grid">
        {options.map(([id, name, role]) => (
          <Choice key={id} selected={config.server === id} title={name} subtitle={role} onClick={() => onSelect(id)} />
        ))}
      </div>
      <NavButtons onBack={onBack} onNext={onStart} nextLabel="LET'S PLAY!" />
    </section>
  )
}

function LiveScreen({
  config,
  score,
  elapsed,
  canUndo,
  onPlayerPoint,
  onOpponentPoint,
  onUndo,
  onPause,
}: {
  config: GameConfig
  score: ReturnType<typeof calculateScore>
  elapsed: number
  canUndo: boolean
  onPlayerPoint: () => void
  onOpponentPoint: () => void
  onUndo: () => void
  onPause: () => void
}) {
  return (
    <section className="screen-stack compact">
      <GameMeta elapsed={elapsed} />
      <ScoreBoard config={config} score={score} />
      <DeuceBanner config={config} score={score} />
      <div className="score-buttons">
        <button className="score-action in" onClick={onPlayerPoint}>IN<span>{sideName(config, 'player')} + point</span></button>
        <button className="score-action out" onClick={onOpponentPoint}>OUT<span>{sideName(config, 'opponent')} + point</span></button>
      </div>
      <div className="two-col">
        <button className="button button-secondary" disabled={!canUndo} onClick={onUndo}>↶ UNDO</button>
        <button className="button button-secondary" onClick={onPause}>Ⅱ PAUSE</button>
      </div>
    </section>
  )
}

function PauseScreen({
  config,
  score,
  elapsed,
  stopConfirm,
  onContinue,
  onStopRequest,
  onStopCancel,
  onStopConfirm,
}: {
  config: GameConfig
  score: ReturnType<typeof calculateScore>
  elapsed: number
  stopConfirm: boolean
  onContinue: () => void
  onStopRequest: () => void
  onStopCancel: () => void
  onStopConfirm: () => void
}) {
  return (
    <section className="screen-stack centered">
      <Header title="Game Paused" subtitle="The Game timer is stopped." />
      <div className="paused-time">{formatDuration(elapsed)}</div>
      <div className="panel centered">
        <strong>{sideName(config, 'player')} {score.playerDisplay} — {score.opponentDisplay} {sideName(config, 'opponent')}</strong>
        {score.deuceCount > 0 && <small>Deuce {score.deuceCount}{config.deuceMode === 'limited' ? ` / ${config.maxDeuce}` : ''}</small>}
        <small>Serving: {config.names[config.server]}</small>
      </div>
      <button className="button button-primary button-lg" onClick={onContinue}>CONTINUE</button>
      <button className="button button-secondary" onClick={onStopRequest}>STOP GAME</button>
      {stopConfirm && (
        <div className="panel confirmation">
          <h2>Stop this game?</h2>
          <p>The current Game will be discarded.</p>
          <div className="two-col">
            <button className="button button-secondary" onClick={onStopCancel}>Continue</button>
            <button className="button button-primary" onClick={onStopConfirm}>Stop Game</button>
          </div>
        </div>
      )}
    </section>
  )
}

function ResultScreen({
  config,
  score,
  elapsed,
  onUndo,
  onNewGame,
  onDone,
}: {
  config: GameConfig
  score: ReturnType<typeof calculateScore>
  elapsed: number
  onUndo: () => void
  onNewGame: () => void
  onDone: () => void
}) {
  return (
    <section className="screen-stack">
      <div className="result-hero">
        <small>GAME COMPLETE</small>
        <h1>{sideName(config, score.winner!)} {config.mode === 'double' ? 'Win' : 'Wins'}</h1>
        <p>Duration {formatDuration(elapsed)}</p>
      </div>
      <div className="summary-grid panel">
        <Summary label="Winner" value={sideName(config, score.winner!)} />
        <Summary label="Server" value={config.names[config.server]} />
        <Summary label="Deuce Mode" value={config.deuceMode === 'limited' ? 'Limited' : 'Unlimited'} />
        <Summary label="Deuce Count" value={String(score.deuceCount)} />
      </div>
      <div className="panel history">
        <div className="history-head"><strong>Score History</strong><small>{score.history.length} points</small></div>
        <ol>
          {score.history.map((item) => <li key={item.number}><span>{item.number}</span><strong>{item.text}</strong></li>)}
        </ol>
      </div>
      <button className="button button-secondary" onClick={onUndo}>↶ UNDO LAST POINT</button>
      <div className="two-col">
        <button className="button button-primary button-lg" onClick={onNewGame}>NEW GAME</button>
        <button className="button button-secondary button-lg" onClick={onDone}>DONE</button>
      </div>
    </section>
  )
}

function GameMeta({ elapsed }: { elapsed: number }) {
  return <div className="game-meta"><span><strong>{formatDuration(elapsed)}</strong> Game time</span><span>{new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div>
}

function ScoreBoard({ config, score }: { config: GameConfig; score: ReturnType<typeof calculateScore> }) {
  const serverPlayerSide = config.server === 'player1' || config.server === 'player2'
  return (
    <div className="scoreboard panel no-pad">
      <ScoreRow
        name={sideName(config, 'player')}
        role={config.mode === 'single' ? 'Player' : 'Your Team'}
        score={score.playerDisplay}
        server={serverPlayerSide ? config.names[config.server] : ''}
        advantage={score.advantage === 'player'}
      />
      <ScoreRow
        name={sideName(config, 'opponent')}
        role={config.mode === 'single' ? 'Opponent' : 'Opponent Team'}
        score={score.opponentDisplay}
        server={!serverPlayerSide ? config.names[config.server] : ''}
        advantage={score.advantage === 'opponent'}
      />
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

function DeuceBanner({ config, score }: { config: GameConfig; score: ReturnType<typeof calculateScore> }) {
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

function Choice({ selected, title, subtitle, onClick }: { selected: boolean; title: string; subtitle: string; onClick: () => void }) {
  return <button className={`choice ${selected ? 'selected' : ''}`} onClick={onClick}><strong>{title}</strong><span>{subtitle}</span></button>
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="field"><span>{label}</span><input value={value} onChange={(e) => onChange(e.target.value)} /></label>
}

function NavButtons({ onBack, onNext, nextLabel }: { onBack: () => void; onNext: () => void; nextLabel: string }) {
  return <div className="two-col"><button className="button button-secondary" onClick={onBack}>BACK</button><button className="button button-primary" onClick={onNext}>{nextLabel}</button></div>
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div><small>{label}</small><strong>{value}</strong></div>
}

export default App
