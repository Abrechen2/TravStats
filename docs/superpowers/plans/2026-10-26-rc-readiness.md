# RC readiness — TravTrack, the Companion redesign and the open issues

Owner, 2026-10-26: "mit den anderen beiden Sessions alles für TravTrack und die
Issues fertig machen im Server und Companion-Redesign, damit wir dann eine
RC-Release machen können."

Coordinator: `travstats-server`. The owner merges, deploys and releases; this
plan ends at "ready for the RC question", asked as one isolated question.

## Sessions

| Session | Owns in this plan |
|---|---|
| `travstats-server` | this plan, integration of `dev/travtrack` and the Beta builds, Companion-redesign server parts (C3), the server issues marked S below, rail tram/metro routing |
| `Travstats` | TravTrack server and web (`dev/travtrack` feature branches), the flight panel, forgejo#316 / forgejo#319 close-out |
| `travstats-companion` | the Companion: TravTrack C8/C9, the redesign phases 2–3, the companion# issues marked A below |

Every branch is handed to `travstats-server` for integration (branch, commits,
red→green tests, Codex result). Nobody else pushes to `dev/travtrack`.

## Scope for the RC

### TravTrack (plan `2026-10-24-travtrack.md`)

| Item | Who | State 2026-10-26 |
|---|---|---|
| Phases 1–5 server + web | Travstats | built, on `dev/travtrack`; Beta 2.7.0-beta.27 |
| Flight panel 2 (whole flight, graph, deep link, climb from take-off) | Travstats | in progress → beta.29 |
| Inbox with track sections | Travstats | done → beta.28 |
| Codex VM test findings F1 (app) / F2 (web) | companion / Travstats | F1 fixed `bd4b265c`, F2 in beta.27 |
| C8 field test | companion + owner | Android done (zone, crash, deleted flight); iOS build 62 + battery day open |
| C9 Shortcuts (Dawarich pattern, upload action) | companion | in progress on `feat/travtrack-shortcuts` |
| Phase 2/3/4 exits: full gates on the integrated branch, one Codex review of `main...dev/travtrack`, browser look | travstats-server | after beta.29 |

### Companion redesign (spec `2026-10-25-companion-redesign.md`)

| Item | Who | State |
|---|---|---|
| Phase 1 Navigation + Start | companion | done |
| C4 stats `?year=` | travstats-server | on `main` |
| Phase 3 Statistik (app) | companion | open |
| C3 inbox findings: `undo` for dismiss/link, then `duplicate`, then `ferryMatch` (owner decision 2026-10-25) | travstats-server | starting |
| Phase 2 Reisen + Track (app, consumes C1–C3) | companion | open, after C3's contract is final |
| C5 server-side trip phase | — | not built; stays out unless the owner asks |

### Issues

S = server (travstats-server), T = TravTrack session, A = app.

| Issue | Who | Plan |
|---|---|---|
| forgejo#316 trip recordings on the server | T | verified end-to-end on beta.27, closed; real-phone proof stays under C8 / companion#73 |
| forgejo#319 stationary GPS jitter | T | filter on main since rc.19 for entry recordings, verified, closed; follow-up after C8: filter TravTrack's drawn line and totals (not the point layer) |
| forgejo#317 share link of an undated trip never ends | S | fix |
| forgejo#320 station labels on the map | S | build |
| forgejo#322 "a logbook, not a live tracker" text | S | rewrite README / Docker Hub / llms.txt copy |
| forgejo#323 route and endpoint details for every domain | S | build |
| forgejo#318 + forgejo#321 settings levels and settings redesign | S | scope with the owner (see Open) |
| Discord "Domain: Bahn" tram/metro routing | S | `feat/rail-tram-routing` in progress |
| companion#76 iOS background-launch crash | A | likely the F1 fix; verify on build 62, close |
| companion#73 trip recording to the server | A | done through C6; close with evidence |
| companion#79 cockpit GPS 0 after lock screen | A | fix |
| companion#78 offline route map never completes | A | fix (download button, region first) |
| companion#74 settings levels in the app | A | with forgejo#318 |

### Proposed out of the RC (owner to confirm)

forgejo#313 mail intake (design), forgejo#303 market analysis (umbrella),
forgejo#301 federation, forgejo#299 country counting redesign, forgejo#59
file-size debt (continuous), forgejo#88 old RC audit (re-check only),
forgejo#280 (question collector), companion#68 usage stats, companion#37
voice notes, companion#9 watch workouts, bus line routes (real line course).

## Order

1. beta.28: `main` + place list + inbox track sections + TravPlan switch.
2. beta.29: flight panel 2, rail tram/metro routing, C3 undo + `duplicate`,
   first S issues.
3. beta.30: remaining S/A issues, C3 `ferryMatch`, Companion phase 2/3 against
   it; C8 iOS + C9 on TestFlight.
4. Exit: full gates, Codex review over `main...dev/travtrack`, UAT on the Beta,
   then the owner's RC question.

## Open for the owner

- The out-of-RC list above.
- forgejo#318/#321: full settings redesign in this RC, or only the levels for
  the first candidate (market/place detection)?
