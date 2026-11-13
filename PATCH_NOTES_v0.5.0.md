# Self-Operated Tennis Score v0.5.0 — GA4 Product Analytics

This revision adds Google Analytics 4 integration for the Netlify-hosted web app.

## Environment variable

Set in Netlify:

```text
VITE_GA_MEASUREMENT_ID=G-SYX4DFTVSX
```

The Measurement ID is browser-visible by design and is not a secret.

## Events included

- `match_setup_started`
- `play_mode_selected`
- `deuce_mode_selected`
- `match_started`
- `game_completed`
- `final_tiebreak_started`
- `match_completed`
- `undo_used`
- `pause_used`
- `live_scoreboard_created`
- `live_scoreboard_closed`
- `live_scoreboard_viewed`

No player names, email addresses, public scoreboard codes, or scoreboard URLs are sent to GA4.

## Useful event parameters

Examples include:

- `play_mode`
- `total_games`
- `deuce_mode`
- `live_scoreboard_enabled`
- `game_number`
- `winner_side`
- `had_deuce`
- `target_points`
- `winning_margin`
- `used_tiebreak`
- `duration_seconds`
- `stage`

## Verification

After deploying, open Google Analytics → Reports → Realtime. Start a test match and look for custom events such as `match_started`, `game_completed`, and `match_completed`.
