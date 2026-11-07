# Patch Notes — v0.3.0

## Final Tie-Break serving update

This release adds full serving context to the Final Tie-Break screen.

### Serving rotation

- Point 1 is served by the next scheduled server after the final configured Game.
- After Point 1, servers take two consecutive points.
- Singles: A → B,B → A,A → ...
- Doubles: continues the established four-player Game-serving order.

### IN / OUT

The buttons are now server-relative during the Final Tie-Break:

- IN = current server's side wins the point.
- OUT = receiving side wins the point.

Both the label and the actual scoring action follow the current server.

### Court guidance

The screen shows:

- Current individual server.
- Team/side of the server.
- Deuce Court (Right) or Ad Court (Left).
- Current Tie-Break point number.
- Serving-order preview.
- End-change warning after points 6, 12, 18, etc.

### Pause screen

When pausing during a Final Tie-Break, the current server and court side remain visible.
