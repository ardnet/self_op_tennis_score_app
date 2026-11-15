# Self-Operated Tennis Score — Multi-Game MVP v0.5.0

**v0.5.0 adds Google Analytics 4 product-usage analytics. See `GA4_SETUP.md`.**

Mobile-first React + TypeScript tennis scoring app for recreational Singles and Doubles, now with an optional realtime Live Scoreboard that can be opened on a TV, tablet, laptop or another phone.

## Core scoring features

- Singles and Doubles.
- Standard tennis scoring: 0, 15, 30, 40, Deuce, Advantage, Game.
- Unlimited or limited Deuce.
- Fixed 2–10 Game sessions.
- Draw or configurable Final Tie-Break when Games finish tied.
- Singles and Doubles serving rotation.
- Final Tie-Break 1-then-2-point serving rotation.
- Dynamic IN/OUT buttons based on the current server.
- Tie-Break Deuce/Ad court guidance and Change Ends alerts.
- Session/Game/Tie-Break active timers.
- Pause, between-Game breaks and Undo.
- Point history and final result summary.
- Local browser persistence.

## Live Scoreboard v0.5.0

Before LET'S PLAY, the user can optionally create a unique live scoreboard.

The controller receives:

- unique public match code,
- scoreboard URL,
- Copy Link,
- Open link,
- QR code.

The public scoreboard is read-only and shows:

- waiting state before the match,
- team/player names,
- Games and point score,
- current server,
- Deuce/Advantage,
- paused and between-Game states,
- Final Tie-Break score,
- Tie-Break server,
- Deuce/Ad court,
- Change Ends guidance,
- elapsed active time,
- final result.

Live links expire automatically 24 hours after match completion, or 24 hours after creation if never started. The controller can also close the link manually.

## Architecture

- Frontend: React + TypeScript + Vite, hosted as a Render Static Site.
- Local match state/scoring remains authoritative on the scoring phone.
- Protected live-session writes: Supabase Edge Functions (`supabase/functions/`).
- Realtime live-state storage/subscription: Supabase.
- Public scoreboard: `/scoreboard/<MATCH_CODE>`.

The scoring app continues locally if the network disconnects. Live synchronisation retries when connectivity returns.

## Local install

```bash
npm install
npm run dev
```

Copy `.env.example` to a local `.env` and fill in your Supabase URL and publishable key. The local app then uses the deployed Live Scoreboard functions.

## Production deployment

- App: Render Static Site, defined in `render.yaml`.
- Live Scoreboard API: Supabase Edge Functions, deployed with the Supabase CLI.

Step-by-step guide (including moving from Netlify): **`DEPLOY_RENDER.md`**

Live Scoreboard database setup: **`SETUP_LIVE_SCOREBOARD.md`** and **`supabase/live_scoreboard.sql`**

## Environment variables

Render build (browser-safe):

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
VITE_GA_MEASUREMENT_ID
```

The Edge Functions need no variables of their own: Supabase provides `SUPABASE_URL` and the secret key to them automatically.

## Build

```bash
npm run build
```

## Tests

Unit tests cover the scoring rules in `src/domain/` (Game scoring, Deuce, Final Tie-Break, serving rotation, court side and change of ends) and the match flow in `src/domain/sessionFlow.ts` (session ending, Draw / Final Tie-Break, Undo, Pause and timers). They are grouped by the section numbers of the Product Requirements / UI/UX Specification.

```bash
npm test               # run once
npm run test:watch     # re-run on file changes
npm run test:coverage  # run with a coverage report (HTML in ./coverage)
```

Some tests use [fast-check](https://fast-check.dev/) to play thousands of random point sequences and confirm rules that must always hold, e.g. undoing the last point restores exactly the previous score.
