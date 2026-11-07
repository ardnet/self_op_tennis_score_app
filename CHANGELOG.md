# Changelog

## 0.2.1 - Server-relative IN / OUT scoring fix

- IN now awards the point to the side currently serving.
- OUT now awards the point to the receiving side.
- Button labels update automatically with the current server in both Singles and Doubles.
- Example: if Zac serves, IN = Max / Zac + point; if Sinner serves, IN = Ardi / Sinner + point.

## 0.2.0 — Multi-Game MVP

- Added fixed 2–10 Game sessions.
- Added Games format and tie resolution configuration.
- Added Final Tie-Break configuration and scoring.
- Added session-wide active timer and per-Game timers.
- Added between-Game break state; break time is excluded.
- Added automatic Singles and Doubles server rotation.
- Added per-Game histories and durations to final result.
- Added Final Tie-Break history to final result.
- Preserved Limited/Unlimited Deuce, Undo, Pause and Stop confirmation.
- Added Undo after a completed Game and after the final result.
- Updated localStorage namespace for the multi-Game data model.
