# Changelog

## 0.3.0 - Final Tie-Break serving rotation + court guidance

- Final Tie-Break now starts with the next scheduled server from the established Game rotation.
- Implements the standard 1-then-2-point serving rhythm (A → BB → AA → ...).
- Doubles continues through the established four-player serving sequence.
- Final Tie-Break IN / OUT buttons now follow the current server side.
- Shows the current individual server and team/side.
- Shows Deuce Court (Right) / Ad Court (Left) for the upcoming serve.
- Shows the current Tie-Break point number and serving-order preview.
- Flags end changes after points 6, 12, 18, etc.
- Tie-Break Pause screen also shows the current server and court side.

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
