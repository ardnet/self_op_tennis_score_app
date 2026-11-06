# Tennis Score Tracker MVP

Mobile-first Phase 1 prototype for recording a single tennis Game.

## Features

- Singles and Doubles
- Player/opponent name setup
- First-server selection
- Standard tennis scoring: 0 → 15 → 30 → 40 → Deuce → Advantage → Game
- Unlimited Deuce
- Limited Deuce (1–10) with sudden-death point on the final Deuce
- Large IN / OUT controls
  - IN = Player / Player Group wins the point
  - OUT = Opponent / Opponent Group wins the point
- Undo last point
- Pause / Continue
- Stop Game confirmation
- Stopwatch + current clock
- Game result summary and score history
- Browser localStorage persistence
- Responsive mobile-first layout

## Technology

- React
- TypeScript
- Vite
- Browser localStorage
- No backend required for Phase 1

## Local Setup

### Requirements

Install a Vite-compatible Node.js version: Node.js 20.19+ or 22.12+. A current Node.js 22 release is a good choice.

Check versions:

```bash
node -v
npm -v
```

### Install

From this project directory:

```bash
npm install
```

### Run locally

```bash
npm run dev
```

Vite will show a local URL, normally:

```text
http://localhost:5173
```

Open that address in your browser.

### Test from a phone on the same Wi-Fi

Run:

```bash
npm run dev -- --host
```

Vite will show a Network URL such as:

```text
http://192.168.1.20:5173
```

Open that Network URL from your phone while the phone and computer are on the same network.

If the page is not reachable, allow Node.js/Vite through your computer firewall for private networks.

## Production Build

```bash
npm run build
```

The deployable static files will be created in:

```text
dist/
```

You can deploy the contents of `dist/` to any static web host, including Nginx/Apache, Netlify, Vercel, Cloudflare Pages, AWS S3 + CloudFront, or similar hosting.

To preview the production build locally:

```bash
npm run preview
```

## Architecture

The scoring logic is intentionally separated from the React interface:

```text
src/domain/scoring.ts    Tennis rules / scoring engine
src/domain/types.ts      Shared domain models
src/storage/             Browser persistence adapter
src/App.tsx              React UI and application flow
src/styles.css           Responsive presentation
```

This makes it easier to reuse the scoring engine later in a native iOS, Android, Apple Watch, Wear OS, or dedicated-device implementation.

## Phase 1 Limitation

This MVP handles one tennis Game only. Sets and Matches are planned for future phases.
