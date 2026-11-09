# Live Scoreboard Setup — Netlify + Supabase

This project keeps the existing React/Vite scoring app on Netlify and uses Supabase only for live match storage/realtime updates.

## Architecture

- Scoring phone: existing app + local state remains the source of truth.
- Netlify Functions: protected endpoints create/update/close live scoreboard sessions.
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

Do not manually add a public write policy. Writes are intentionally performed only by the Netlify Functions.

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
The secret key must only be used by Netlify Functions.

Never put the secret key in a variable beginning with `VITE_`.

---

## 3. Configure Netlify environment variables

Open the Netlify project that hosts the Self-Operated Tennis Score.

Go to the project's environment variables configuration and add:

### Browser/build variables

`VITE_SUPABASE_URL`

Value: your Supabase project URL.

`VITE_SUPABASE_PUBLISHABLE_KEY`

Value: your `sb_publishable_...` key.

These variables must be available during the Netlify **Build** because Vite embeds `VITE_` variables into the browser bundle.

### Function/server variables

`SUPABASE_URL`

Value: the same Supabase project URL.

`SUPABASE_SECRET_KEY`

Value: your `sb_secret_...` key.

This secret must be available to Netlify **Functions**. Mark it as a secret/sensitive value when Netlify offers that option.

If your Netlify plan does not show variable scopes, using the default/all scopes is acceptable; the important part is that the secret key is never exposed through a `VITE_` variable.

### Legacy Supabase projects

The code also supports legacy key names if required:

- `VITE_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Prefer the newer Publishable/Secret keys for a newly created project.

---

## 4. Redeploy after adding environment variables

Environment variables beginning with `VITE_` are injected at build time, so after setting the Netlify variables trigger a new production deploy.

Expected Netlify build settings are already included in `netlify.toml`:

- Build command: `npm run build`
- Publish directory: `dist`
- Functions directory: `netlify/functions`
- SPA redirect for `/scoreboard/*`

Netlify should deploy these functions:

- `live-scoreboard-create`
- `live-scoreboard-update`
- `live-scoreboard-close`

---

## 5. First production test

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

## 6. Link lifetime

The implemented rules are:

- Created but never started: expires 24 hours after creation.
- Started match: the expiry window is refreshed when the match starts.
- Completed match: expires 24 hours after completion.
- User chooses **CLOSE SCOREBOARD**: closes immediately.

Expired/closed rows are hidden by the public Row Level Security policy.

Old database rows do not need to be deleted immediately to become inaccessible. The SQL includes `cleanup_expired_live_scoreboards()` for optional later housekeeping.

---

## 7. Connection-loss behaviour

The main scoring app continues working locally if internet connectivity is lost.

When a live update fails:

- the scoring screen shows a reconnecting warning,
- normal tennis scoring remains usable,
- the TV keeps the last known score,
- the controller retries approximately every 5 seconds and when the browser reports that it is back online.

When connectivity returns, the latest complete state is synchronised.

---

## 8. Local development

Install dependencies:

```bash
npm install
```

For the normal app only:

```bash
npm run dev
```

The live-scoreboard creation endpoints are Netlify Functions, so for full local testing use Netlify Dev.

Create a local `.env` or configure the same environment variables through Netlify CLI, then run:

```bash
npx netlify-cli dev
```

Do not commit a local `.env` containing the Supabase secret key.

---

## 9. Security model

Public viewers receive only read access to active scoreboard sessions.

The public URL does not contain the controller token.

The scoring phone stores its controller token locally and sends it only to Netlify Functions. Netlify Functions hash/verify the token and use the Supabase server secret to perform writes.

The Supabase secret key never enters the Vite/browser bundle.

---

## 10. Files added for this feature

- `src/live/LiveScoreboard.tsx`
- `src/live/controller.ts`
- `src/live/supabase.ts`
- `src/live/types.ts`
- `src/liveScoreboard.css`
- `netlify/functions/live-scoreboard-create.mjs`
- `netlify/functions/live-scoreboard-update.mjs`
- `netlify/functions/live-scoreboard-close.mjs`
- `netlify/lib/supabase-admin.mjs`
- `supabase/live_scoreboard.sql`
- `.env.example`
