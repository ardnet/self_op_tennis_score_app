# Live Scoreboard Setup — Render + Supabase

The React/Vite scoring app is hosted as a Render Static Site. Supabase stores the live match state, sends realtime updates, and runs the Edge Functions that write to it. For the hosting steps see **`DEPLOY_RENDER.md`**.

## Architecture

- Scoring phone: existing app + local state remains the source of truth.
- Supabase Edge Functions: protected endpoints create/update/close live scoreboard sessions.
- Supabase: stores the public live scoreboard state and sends realtime updates.
- TV/spectators: open `/scoreboard/<MATCH_CODE>` and have read-only access.

The live scoreboard is optional. If the user never creates a live scoreboard, the scoring app continues to work as before.

---

## 1. Create a Supabase project

1. Sign in to Supabase and create a project.
2. Wait until the project is ready.
3. Open **SQL Editor**.
4. Open this project's file:

   `supabase/live_scoreboard.sql`

5. Copy the complete SQL into Supabase SQL Editor and run it once.

The SQL creates:

- `live_scoreboard_sessions` — public read-only live state.
- `live_scoreboard_controller_tokens` — controller token hashes; browser users have no access.
- Row Level Security policies.
- Realtime publication for `live_scoreboard_sessions`.
- Indexes and an optional cleanup helper.

### Verify

In Supabase **Table Editor**, you should see both tables.

Do not manually add a public write policy. Writes are intentionally performed only by the Edge Functions.

---

## 2. Copy the Supabase URL and keys

In Supabase, use the project's **Connect** dialog or **Settings > API Keys**.

You need:

1. Project URL, for example:
   `https://abcxyz.supabase.co`
2. Publishable key:
   `sb_publishable_...`
3. Secret key:
   `sb_secret_...`

The publishable key is used by the browser and is protected by Row Level Security.
The secret key is used only by the Edge Functions, which receive it from Supabase automatically. You do not need to copy it anywhere.

Never put the secret key in a variable beginning with `VITE_`.

---

## 3. Deploy the Edge Functions and the app

Follow **`DEPLOY_RENDER.md`**:

1. Deploy `live-scoreboard-create`, `live-scoreboard-update` and `live-scoreboard-close` with the Supabase CLI.
2. Create the Render Static Site and set the build variables:
   - `VITE_SUPABASE_URL` — your Supabase project URL
   - `VITE_SUPABASE_PUBLISHABLE_KEY` — your `sb_publishable_...` key

Vite embeds `VITE_` variables into the browser bundle at build time, so redeploy on Render after changing them.

### Legacy Supabase projects

The code also supports legacy keys: `VITE_SUPABASE_ANON_KEY` in the browser, and the Edge Functions fall back to `SUPABASE_SERVICE_ROLE_KEY` automatically.

Prefer the newer Publishable/Secret keys.

---

## 4. First production test

After deployment:

1. Open the normal Self-Operated Tennis Score URL on Phone A.
2. Configure a Singles or Doubles session.
3. Reach the final server/setup screen.
4. Tap **CREATE LIVE SCOREBOARD**.
5. Confirm the app displays:
   - Match code
   - Unique scoreboard URL
   - Copy Link
   - QR Code
6. Open the scoreboard link on:
   - another phone,
   - an incognito browser,
   - laptop/tablet, or
   - TV browser.
7. The scoreboard should show **Waiting for Match**.
8. On Phone A, tap **LET'S PLAY!**.
9. Record points using IN/OUT.
10. Confirm the remote scoreboard changes automatically without refreshing.

Also test:

- Pause → TV shows Match Paused.
- Complete a Game → TV shows between-Game information.
- Continue → TV returns to live scoring.
- Final Tie-Break → TV shows current Tie-Break server, court side, score and Change Ends alert.
- Finish match → TV shows the final result.
- Close Scoreboard → public link becomes unavailable.

---

## 5. Link lifetime

The implemented rules are:

- Created but never started: expires 24 hours after creation.
- Started match: the expiry window is refreshed when the match starts.
- Completed match: expires 24 hours after completion.
- User chooses **CLOSE SCOREBOARD**: closes immediately.

Expired/closed rows are hidden by the public Row Level Security policy.

Old database rows do not need to be deleted immediately to become inaccessible. The SQL includes `cleanup_expired_live_scoreboards()` for optional later housekeeping.

---

## 6. Connection-loss behaviour

The main scoring app continues working locally if internet connectivity is lost.

When a live update fails:

- the scoring screen shows a reconnecting warning,
- normal tennis scoring remains usable,
- the TV keeps the last known score,
- the controller retries approximately every 5 seconds and when the browser reports that it is back online.

When connectivity returns, the latest complete state is synchronised.

---

## 7. Local development

Install dependencies:

```bash
npm install
```

For the normal app only:

```bash
npm run dev
```

With `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` in a local `.env`, the local app calls the deployed Edge Functions, so the Live Scoreboard works with plain `npm run dev`. See `DEPLOY_RENDER.md` → *Local development* for running the functions locally.

Never put the Supabase secret key in `.env` or in any `VITE_` variable.

---

## 8. Security model

Public viewers receive only read access to active scoreboard sessions.

The public URL does not contain the controller token.

The scoring phone stores its controller token locally and sends it only to the Edge Functions. They hash/verify the token and use the Supabase secret key to perform writes.

The Supabase secret key never enters the Vite/browser bundle.

---

## 9. Files added for this feature

- `src/live/LiveScoreboard.tsx`
- `src/live/controller.ts`
- `src/live/supabase.ts`
- `src/live/types.ts`
- `src/liveScoreboard.css`
- `supabase/functions/live-scoreboard-create/index.ts`
- `supabase/functions/live-scoreboard-update/index.ts`
- `supabase/functions/live-scoreboard-close/index.ts`
- `supabase/functions/_shared/live.ts` (endpoint logic, unit-tested in `live.test.ts`)
- `supabase/functions/_shared/admin.ts`
- `supabase/config.toml`
- `supabase/live_scoreboard.sql`
- `.env.example`
