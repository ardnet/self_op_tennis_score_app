# v0.4.0 — Optional Live Scoreboard

## Added

- Optional **CREATE LIVE SCOREBOARD** action before LET'S PLAY.
- One unique public scoreboard link per match session.
- Human-friendly match code.
- Copy Link, Open and QR Code controls.
- Separate read-only `/scoreboard/<code>` route optimised for large TV displays.
- Waiting-for-match state before play starts.
- Real-time normal Game score updates.
- Current server display.
- Games tally, Deuce and Advantage display.
- Pause and between-Game states.
- Final Tie-Break score, current server, Deuce/Ad court and Change Ends guidance.
- Completed-match result screen.
- Manual close control.
- Automatic 24-hour expiry rules.
- Local scoring continues during network failure.
- Automatic reconnect/retry for the controller.
- Supabase RLS + separated controller-token table.
- Netlify Functions for privileged writes.

## Infrastructure

- Netlify remains the frontend host.
- Supabase stores/realtime-broadcasts live scoreboard state.
- Browser viewers use a publishable Supabase key and have read-only RLS access.
- Netlify Functions use a secret Supabase key for write operations.

## Setup

Read `SETUP_LIVE_SCOREBOARD.md` before testing the feature in production.
