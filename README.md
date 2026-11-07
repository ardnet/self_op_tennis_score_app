# Tennis Score Tracker — Multi-Game MVP

React + TypeScript + Vite implementation of the extended Phase 1 Tennis Score Tracker.

## What changed from the single-Game MVP

This version supports a fixed session of **2–10 Games** while retaining all existing Game-level scoring behaviour.

### Setup

- Singles or Doubles
- Player names
- Unlimited or Limited Deuce (1–10)
- Fixed total Games: 2–10
- Preferred Games winning margin: 1 or 2
- If the final Games score is tied:
  - Finish as DRAW, or
  - Use a Final Tie-Break
- Final Tie-Break configuration:
  - Target / maximum point: 5–10
  - Winning margin: 1 or 2
  - If both sides reach the target equally:
    - Unlimited until margin is reached
    - Sudden Death
    - Make it DRAW

### Serving

Singles alternates the server by Game.

For Doubles, setup captures:

- Which team serves Game 1
- First server on the Player team
- First server on the Opponent team

The app then rotates servers automatically. Example:

```text
Player 1 → Opponent 2 → Player 2 → Opponent 1 → repeat
```

### During play

- Standard tennis scoring: 0 → 15 → 30 → 40 → Deuce → Advantage → Game
- IN = the **current serving side** wins the point
- OUT = the **receiving side** wins the point
- Large scoring controls for on-court use
- Undo
- Pause / Continue
- Stop confirmation behind Pause
- Session timer
- Individual Game timer
- Current clock
- Current Game number and overall Games score

### Between Games

Each Game stops automatically when won.

- Session timer stops
- Game timer stops
- Break time is not counted
- Shows Game winner, duration, Games tally and next server
- `UNDO LAST POINT` can reopen the completed Game
- `CONTINUE TO GAME N` starts the next Game and resumes active timing

### Final Tie-Break

If all configured Games finish tied and Final Tie-Break is selected, the app pauses before starting the Tie-Break.

The Tie-Break has its own active timer and point history. It also follows tennis Tie-Break serving rotation:

- Point 1 is served by the **next scheduled server** from the existing Game rotation.
- After Point 1, each subsequent server serves **two consecutive points**.
- Singles follows `A → B,B → A,A → B,B → ...`.
- Doubles continues the established four-player order, for example `Max → Ardi → Zac → Sinner`, using the same 1-then-2-point rhythm.
- The Tie-Break screen shows the current individual server and team/side.
- **IN** awards the point to the current server's side; **OUT** awards it to the receiving side.
- The upcoming serve is labelled **Deuce Court (Right)** or **Ad Court (Left)**.
- The UI warns when players should change ends after Tie-Break points **6, 12, 18, ...**.

### Session Result

The final result screen includes:

- Winner or DRAW
- Games score
- Final Tie-Break score when applicable
- Total active playing time
- Per-Game winner
- Per-Game server
- Per-Game duration
- Full point history for every Game
- Full Final Tie-Break point history
- Undo last point

## Important Tie-Break interpretation

There was one logical conflict in the discussed requirements:

- `7–6 should finish even when the configured margin is 2`
- but also `7–7 should trigger the configured equal-at-maximum resolution`

Those two rules cannot both occur naturally because if 7–6 ends immediately, 7–7 can never be reached.

To keep the approved **7–7 resolution options functional**, this implementation makes the selected margin binding at the target:

- Target 7, margin 1: `7–6` wins.
- Target 7, margin 2: `7–6` continues.
- If it becomes `7–7`, the selected resolution is applied:
  - Unlimited
  - Sudden Death
  - DRAW

This behaviour is isolated in `src/domain/scoring.ts`, so it is easy to change later if desired.

## Technology

- React
- TypeScript
- Vite
- Browser `localStorage`
- No backend required

The tennis scoring logic and serving rotation are kept outside React so they can be reused later for native iOS, Android, Apple Watch, Wear OS, or a dedicated scoring device.

## Project structure

```text
src/
├── domain/
│   ├── scoring.ts       Game + Tie-Break scoring engines
│   ├── session.ts       Game tally + server rotation
│   └── types.ts         Domain models
├── storage/
│   └── localStorage.ts  Browser persistence adapter
├── App.tsx              Application workflow + UI
├── main.tsx
└── styles.css
```

## Local setup

Use Node.js 22 (recommended) or another Node.js version supported by your installed Vite version.

```bash
npm install
npm run dev
```

Open the local URL shown by Vite, normally:

```text
http://localhost:5173
```

### Test on a phone on the same Wi-Fi

```bash
npm run dev -- --host
```

Open the `Network` URL shown by Vite from your phone.

## Production build

```bash
npm run build
```

The deployable files will be generated in:

```text
dist/
```

## Netlify

This repository includes `netlify.toml`.

For a manual Netlify configuration use:

- Build command: `npm run build`
- Publish directory: `dist`

## Persistence

The app stores the active setup/session in browser `localStorage` under a new multi-Game storage key. This avoids collisions with the earlier single-Game MVP.

No user account, cloud database, authentication, or API is required in this version.


## IN / OUT behaviour

During both normal Games and the Final Tie-Break, the large scoring buttons follow the **current server**:

- **IN** = the serving side wins the point.
- **OUT** = the receiving side wins the point.

The labels and actual point-award action switch automatically as service rotates. This applies to both Singles and Doubles, including Tie-Break service changes.

Example in Doubles:

- Zac serving → IN = Max / Zac + point; OUT = Ardi / Sinner + point.
- Sinner serving → IN = Ardi / Sinner + point; OUT = Max / Zac + point.

