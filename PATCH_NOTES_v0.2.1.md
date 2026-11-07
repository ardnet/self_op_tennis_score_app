# v0.2.1 – Server-relative IN / OUT fix

## Fixed behaviour

During a normal Game, IN and OUT now follow the side currently serving.

- If the Player / Player Group is serving:
  - IN → Player / Player Group gets the point.
  - OUT → Opponent / Opponent Group gets the point.
- If the Opponent / Opponent Group is serving:
  - IN → Opponent / Opponent Group gets the point.
  - OUT → Player / Player Group gets the point.

The subtitle beneath each button updates to the same side that will actually receive the point.

### Doubles example

- Zac serving: IN = `Max / Zac + point`; OUT = `Ardi / Sinner + point`.
- Sinner serving: IN = `Ardi / Sinner + point`; OUT = `Max / Zac + point`.

The same server-relative behaviour applies to Singles.

## Scope

This fix applies to normal Game scoring. Final Tie-Break serving rotation has not been changed in this patch because a Tie-Break serving sequence has not yet been defined in the product requirements.
