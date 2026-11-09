import { useEffect, useMemo, useState } from 'react'
import type { RealtimeChannel } from '@supabase/supabase-js'
import { liveScoreboardConfigured, supabase } from './supabase'
import type { LiveScoreboardRow, LiveScoreboardState } from './types'
import '../liveScoreboard.css'

function codeFromPath() {
  const parts = window.location.pathname.split('/').filter(Boolean)
  return (parts[1] || '').toUpperCase()
}

function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return [hours, minutes, seconds].map((value) => String(value).padStart(2, '0')).join(':')
}

function liveElapsed(state: LiveScoreboardState, now: number) {
  if (!state.activeStartedAt || state.phase === 'paused' || state.phase === 'between' || state.phase === 'finished' || state.phase === 'waiting') {
    return state.sessionElapsedMs
  }
  return state.sessionElapsedMs + Math.max(0, now - state.activeStartedAt)
}

export default function LiveScoreboard() {
  const publicCode = useMemo(codeFromPath, [])
  const [row, setRow] = useState<LiveScoreboardRow | null>(null)
  const [loading, setLoading] = useState(true)
  const [connection, setConnection] = useState<'connecting' | 'live' | 'offline'>('connecting')
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!publicCode || !supabase) {
      setLoading(false)
      return
    }

    let active = true
    let channel: RealtimeChannel | null = null

    async function load() {
      const { data, error } = await supabase!
        .from('live_scoreboard_sessions')
        .select('id, public_code, status, scoreboard_state, created_at, started_at, finished_at, expires_at, closed_at, updated_at')
        .eq('public_code', publicCode)
        .maybeSingle()

      if (!active) return
      if (!error && data) setRow(data as LiveScoreboardRow)
      setLoading(false)

      channel = supabase!
        .channel(`scoreboard:${publicCode}`)
        .on('postgres_changes', {
          event: 'UPDATE',
          schema: 'public',
          table: 'live_scoreboard_sessions',
          filter: `public_code=eq.${publicCode}`,
        }, (payload) => {
          if (active) setRow(payload.new as LiveScoreboardRow)
        })
        .subscribe((status) => {
          if (!active) return
          if (status === 'SUBSCRIBED') setConnection('live')
          else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT' || status === 'CLOSED') setConnection('offline')
          else setConnection('connecting')
        })
    }

    load()
    return () => {
      active = false
      if (channel && supabase) supabase.removeChannel(channel)
    }
  }, [publicCode])

  if (!liveScoreboardConfigured) {
    return <ScoreboardMessage title="Live scoreboard is not configured" detail="Supabase environment variables are missing on this deployment." />
  }

  if (loading) return <ScoreboardMessage title="Loading live scoreboard…" detail={publicCode ? `Match ${publicCode}` : 'Invalid scoreboard link'} />
  if (!row) return <ScoreboardMessage title="Scoreboard unavailable" detail="This link is invalid, closed, or has expired." />

  const state = row.scoreboard_state
  const expired = new Date(row.expires_at).getTime() <= now
  if (expired || row.closed_at || row.status === 'closed') {
    return <ScoreboardMessage title="This scoreboard has expired" detail="The live match is no longer available." />
  }

  const totalElapsed = liveElapsed(state, now)
  const isWaiting = state.phase === 'waiting'
  const isFinished = state.phase === 'finished'
  const isTieBreak = state.phase === 'tiebreak' || (isFinished && state.tieBreakPlayer !== null)
  const statusText = state.phase === 'paused' ? 'Match Paused'
    : state.phase === 'between' ? 'Between Games'
    : state.phase === 'tiebreak' ? 'Final Tie-Break'
    : state.phase === 'finished' ? 'Match Complete'
    : state.phase === 'waiting' ? 'Waiting for Match'
    : 'Match in Progress'

  const playerScore = isTieBreak ? state.tieBreakPlayer : isWaiting ? '—' : state.pointPlayer
  const opponentScore = isTieBreak ? state.tieBreakOpponent : isWaiting ? '—' : state.pointOpponent

  return (
    <main className="tv-shell">
      <header className="tv-header">
        <h1>{isFinished ? 'MATCH COMPLETE' : 'LIVE SCOREBOARD'}</h1>
        <p>{state.mode === 'double' ? 'Doubles Match' : 'Singles Match'} <span>•</span> Match {publicCode}</p>
      </header>

      <section className="tv-statusbar">
        <div className={`tv-live-pill ${connection}`}><span className="tv-dot" />{connection === 'offline' ? 'Reconnecting…' : statusText}</div>
        <div>{isWaiting ? 'Live scoreboard ready' : isTieBreak ? 'FINAL TIE-BREAK' : state.segmentLabel}</div>
        <div>⏱ {formatDuration(totalElapsed)}</div>
      </section>

      {connection === 'offline' && <div className="tv-connection-note">Connection interrupted — showing the last known score.</div>}

      <section className="tv-main-score">
        <TeamCard
          side="player"
          name={state.teamPlayer}
          score={String(playerScore ?? '—')}
          server={state.servingSide === 'player' ? state.currentServer : null}
          serverLabel={isWaiting ? 'SERVES FIRST' : 'SERVES'}
          advantage={state.advantage === 'player'}
          winner={isFinished && state.outcome?.winner === 'player'}
        />

        <div className="tv-center-score">
          <span>GAMES</span>
          <div className="tv-games"><strong>{isWaiting ? '—' : state.gamesPlayer}</strong><i>–</i><strong>{isWaiting ? '—' : state.gamesOpponent}</strong></div>
          <span>{isTieBreak ? 'TIE-BREAK POINTS' : 'POINTS'}</span>
        </div>

        <TeamCard
          side="opponent"
          name={state.teamOpponent}
          score={String(opponentScore ?? '—')}
          server={state.servingSide === 'opponent' ? state.currentServer : null}
          serverLabel={isWaiting ? 'SERVES FIRST' : 'SERVES'}
          advantage={state.advantage === 'opponent'}
          winner={isFinished && state.outcome?.winner === 'opponent'}
        />
      </section>

      <section className="tv-footerbar">
        {isWaiting && <><strong>Match starting soon</strong><span>First server: {state.currentServer || '—'}</span></>}
        {state.phase === 'between' && <><strong>{state.message || 'Game complete'}</strong><span>Next server: {state.nextServer || '—'}</span></>}
        {state.phase === 'paused' && <><strong>MATCH PAUSED</strong><span>The score remains visible while play is paused.</span></>}
        {state.phase === 'tiebreak' && <>
          <strong>{state.tieBreakCourtSide === 'deuce' ? 'DEUCE COURT' : 'AD COURT'}</strong>
          <span>{state.changeEndsAfterThisPoint ? '↻ CHANGE ENDS AFTER THIS POINT' : `Tie-Break Point ${state.tieBreakPointNumber}`}</span>
        </>}
        {state.phase === 'game' && <><strong>{state.message || `Game ${state.currentGame} of ${state.totalGames}`}</strong><span>{state.deuceCount > 0 ? `Deuce ${state.deuceCount}${state.deuceMode === 'limited' ? ` / ${state.maxDeuce}` : ''}` : 'Live match'}</span></>}
        {isFinished && <><strong>{state.outcome?.draw ? 'DRAW' : `${state.outcome?.winner === 'player' ? state.teamPlayer : state.teamOpponent} WIN`}</strong><span>Final result available • Link expires 24h after finish</span></>}
      </section>

      <footer className="tv-readonly">Read-only audience display</footer>
    </main>
  )
}

function TeamCard({ side, name, score, server, serverLabel, advantage, winner }: { side: 'player' | 'opponent'; name: string; score: string; server: string | null; serverLabel: string; advantage: boolean; winner: boolean }) {
  return (
    <article className={`tv-team-card ${side} ${winner ? 'winner' : ''}`}>
      <h2>{name}</h2>
      {winner && <div className="tv-winner-badge">🏆 WINNER</div>}
      {server && <div className="tv-server-badge">🎾 {server} {serverLabel}</div>}
      <div className="tv-score-value">{score}</div>
      {advantage && <div className="tv-adv">ADVANTAGE</div>}
    </article>
  )
}

function ScoreboardMessage({ title, detail }: { title: string; detail: string }) {
  return <main className="tv-shell tv-message"><div><div className="tv-ball">🎾</div><h1>{title}</h1><p>{detail}</p></div></main>
}
