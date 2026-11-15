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

- Frontend: React + TypeScript + Vite, hosted on Netlify.
- Local match state/scoring remains authoritative on the scoring phone.
- Protected live-session writes: Netlify Functions.
- Realtime live-state storage/subscription: Supabase.
- Public scoreboard: `/scoreboard/<MATCH_CODE>`.

The scoring app continues locally if the network disconnects. Live synchronisation retries when connectivity returns.

## Local install

```bash
npm install
npm run dev
```

For full Live Scoreboard testing including Netlify Functions:

```bash
npx netlify-cli dev
```

Copy `.env.example` to a local `.env` and fill in your own Supabase values first. Never commit the secret key.

## Production deployment

The existing Netlify deployment is still used. Supabase is added as the live data/realtime service.

Follow the complete setup guide:

**`SETUP_LIVE_SCOREBOARD.md`**

The SQL to run in Supabase is:

**`supabase/live_scoreboard.sql`**

## Environment variables

Browser/build:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_PUBLISHABLE_KEY
```

Netlify Functions/server only:

```text
SUPABASE_URL
SUPABASE_SECRET_KEY
```

Legacy anon/service-role variable names are supported as fallbacks.

## Build

```bash
npm run build
```

Netlify configuration is included in `netlify.toml`.

## Tests

Unit tests cover the scoring rules in `src/domain/` (Game scoring, Deuce, Final Tie-Break, serving rotation, court side and change of ends) and the match flow in `src/domain/sessionFlow.ts` (session ending, Draw / Final Tie-Break, Undo, Pause and timers). They are grouped by the section numbers of the Product Requirements / UI/UX Specification.

```bash
npm test               # run once
npm run test:watch     # re-run on file changes
npm run test:coverage  # run with a coverage report (HTML in ./coverage)
```

Some tests use [fast-check](https://fast-check.dev/) to play thousands of random point sequences and confirm rules that must always hold, e.g. undoing the last point restores exactly the previous score.
