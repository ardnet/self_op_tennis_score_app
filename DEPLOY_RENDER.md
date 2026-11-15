# Deploying to Render + Supabase

The app is hosted as a free **Render Static Site** (served from Render's CDN, never sleeps).
The Live Scoreboard API runs as three **Supabase Edge Functions** in the same Supabase project that stores the live scores.

```text
Phone (scoring app)  ──HTTPS──▶  Supabase Edge Functions  ──▶  Supabase Postgres
   served by Render              live-scoreboard-create              │
                                 live-scoreboard-update              │ realtime
                                 live-scoreboard-close               ▼
TV / spectators  ◀───────────────────────────────────────  Supabase Realtime
```

Nothing in this setup runs on a Render server, so the Render free plan's spin-down does not apply.

---

## Moving from Netlify (one-time)

Do the steps in this order. The Netlify site keeps working until step 6, so there is no downtime.

### 1. Deploy the Edge Functions to Supabase

Run from the repo root (Node 22+). You need your project ref: the `abcxyz` part of `https://abcxyz.supabase.co`.

```bash
npx supabase@3 login
npx supabase@3 link --project-ref YOUR_PROJECT_REF
npx supabase@3 functions deploy --use-api
```

`--use-api` bundles the functions on Supabase's side, so Docker is not needed.
`supabase/config.toml` turns off the platform JWT check for these three functions (they check the controller token themselves).

**Nothing to configure:** Supabase gives every Edge Function `SUPABASE_URL` and the project's secret key automatically. The `SUPABASE_SECRET_KEY` you set on Netlify is no longer needed.

Check in **Supabase Dashboard → Edge Functions** that the three functions are listed and show **Verify JWT: off**.

### 2. Create the Render Static Site

1. In the Render Dashboard choose **New → Blueprint** and connect the GitHub repo `ardnet/self_op_tennis_score_app`.
   Render reads `render.yaml` and creates the Static Site (build `npm ci && npm run build`, publish `./dist`, SPA rewrite).
2. Render asks for the three environment variables marked `sync: false`. Use the same values as on Netlify:

   | Variable | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://YOUR_PROJECT_REF.supabase.co` |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | your `sb_publishable_...` key |
   | `VITE_GA_MEASUREMENT_ID` | your `G-...` Measurement ID |

3. Apply. The first deploy takes about a minute.

Alternative without a Blueprint: **New → Static Site**, same repo, build command `npm ci && npm run build`, publish directory `dist`, add the variables above, and add a rewrite rule `/*` → `/index.html` under **Redirects/Rewrites**.

The deployed branch is `main` (see `branch:` in `render.yaml`). The Node version comes from `.node-version`.

### 3. Test on the `.onrender.com` address

Open the new site and run the checks in `SETUP_LIVE_SCOREBOARD.md` → *First production test*:
create a Live Scoreboard, open it on a second device, score a few points, pause, finish, close.
In GA4 → **Realtime**, confirm events arrive (add the `onrender.com` domain to any GA4 data filters if you use them).

### 4. Update links

- Landing page "Open Web App" button → the new address.
- Custom domain (optional): Render Static Site → **Settings → Custom Domains**, then update your DNS as Render shows.

### 5. Switch over when no match is in progress

Saved matches and open Live Scoreboard links belong to the old address, so pick a quiet time.
Live Scoreboard links created on the old site keep working until they expire (the new functions accept them), but they open the old address.

### 6. Retire Netlify

Keep the Netlify site for a week or two as a fallback. It no longer has its functions after this change, so redeploying it from `main` would break its Live Scoreboard: delete it, or stop its auto-deploys.

---

## Day-to-day

- **App changes:** push to `main` → Render rebuilds and deploys automatically.
- **Function changes** (`supabase/functions/**`): run `npx supabase@3 functions deploy --use-api` again.
- **Changed a `VITE_` variable:** trigger a manual deploy on Render; Vite bakes these in at build time.
- **Function logs:** Supabase Dashboard → Edge Functions → select a function → Logs.

## Local development

```bash
cp .env.example .env    # fill in VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY
npm install
npm run dev
```

The local app calls the deployed Edge Functions (CORS allows any origin), so the Live Scoreboard works locally without extra tools.
To work on the functions themselves: `npx supabase@3 functions serve` (needs Docker), and set `VITE_LIVE_API_BASE_URL=http://127.0.0.1:54321/functions/v1`.

Unit tests for the functions run with the rest: `npm test`.
