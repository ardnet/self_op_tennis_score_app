# GA4 Setup — Self-Operated Tennis Score Web App

## Netlify

Add this environment variable:

```text
VITE_GA_MEASUREMENT_ID=G-SYX4DFTVSX
```

Then trigger a new deployment. Vite injects `VITE_` values at build time, so a redeploy is required after adding/changing the Measurement ID.

## Verify data

1. Deploy the updated source.
2. Open the live app in a normal browser window.
3. Start a match setup, choose Singles/Doubles, start the match, and complete at least one Game.
4. In Google Analytics open **Reports → Realtime**.
5. Look for events including:
   - `match_setup_started`
   - `play_mode_selected`
   - `match_started`
   - `game_completed`
6. If you create a Live Scoreboard and open the public scoreboard link on another device/browser, look for:
   - `live_scoreboard_created`
   - `live_scoreboard_viewed`

## Privacy

The analytics implementation deliberately does not send:

- player names
- emails
- match codes
- live scoreboard URLs
- controller tokens

The events describe product usage only.

## GA4 custom dimensions (optional later)

GA4 collects event parameters, but to use selected parameters conveniently in standard reports/Explorations you can register custom dimensions under **Admin → Custom definitions**. Recommended event-scoped custom dimensions:

- `play_mode`
- `deuce_mode`
- `stage`
- `winner_side`
- `match_status`
- `tie_resolution`

Recommended custom metrics:

- `total_games`
- `game_number`
- `deuce_count`
- `target_points`
- `winning_margin`
- `games_played`
- `duration_seconds`

You do not need to configure these custom definitions for events to start collecting.
