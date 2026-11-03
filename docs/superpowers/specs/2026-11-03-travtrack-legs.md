# TravTrack legs — map parity with Dawarich (2026-11-03)

Owner, 2026-11-03: recording is on par with Dawarich (iPhone, 30.10.–03.11.), but Dawarich
is easier to read on the map: it shows a day as journeys and stages ("Etappen") with their
figures. "Alles bauen." Gap analysis: Codex over Dawarich `cb8239b` and TravStats rc.19.

What TravTrack already has and keeps: heatmap, fog, speed colouring, replay, date navigation,
coverage states, privacy-safe simplification, the logbook timeline (`dayContext.ts`), the
flight panel. Nothing here replaces those; legs are added beside them.

## 1. Model

A **leg** is a stretch of movement in one mode between two stops, inside one privacy-safe
segment run. A **stop** is a dwell (≥ `STOP_MS` within `STEP_M`, the constants of
`dayMovement.ts`) between legs. Legs are derived on read from the stored points; nothing is
stored except the owner's mode corrections.

Mode, in this order of precedence:

1. `manual` — the owner's correction (§3).
2. `entry` — a logbook entry covers the leg (flight, rail, bus, ferry, cruise, rental,
   roadtrip/tour leg — `dayContext.ts`): the entry's mode, and `entryRef` names it.
3. `auto` — the phone-reported motion folded as in `everyday/fold.ts` /
   `everyday/plausible.ts`, corroborated by speed. When the evidence does not agree, the mode
   is `unknown` — never a guess (abstention is a result).

Figures reuse the everyday rules (speed corroboration, altitude smoothing, plausibility caps).
A figure that cannot be derived is `null`, never 0.

## 2. Contract (additive — no app version breaks)

`GET /api/v1/travtrack/day?date=` gains:

```
legs: Leg[]      // ordered by fromMs; [] when none
stops: Stop[]    // ordered by fromMs

Leg = {
  id: string,                 // `${fromMs}-${untilMs}` — stable for the same points
  fromMs: number, untilMs: number,
  mode: "walk"|"run"|"cycle"|"car"|"bus"|"train"|"boat"|"flight"|"unknown",
  modeSource: "auto"|"entry"|"manual",
  confidence: "high"|"low",   // auto only; entry/manual are "high"
  entryRef: { domain: string, id: string } | null,
  distanceM: number,
  durationMs: number,
  movingMs: number | null,
  avgSpeedMps: number | null, maxSpeedMps: number | null,
  ascentM: number | null, descentM: number | null,
  bounds: [west, south, east, north],
  ranges: Array<{ segment: number, from: number, to: number }>  // vertex index ranges into `segments` (inclusive)
}
Stop = {
  fromMs: number, untilMs: number,
  anchor: { lat: number, lon: number },
  stayRef: { id: string, status: string } | null   // an existing stay suggestion / lodging, if any
}
```

The range views (`GET /travtrack/range…`, `rangeView.ts`) gain
`aggregates: { distanceM, movingMs: number|null, maxSpeedMps: number|null }`, computed from
the stored (privacy-safe) points, NOT from the simplified drawing geometry.

The point details the inspector reads gain nullable `speedMps`, `altitudeM`, `motion`
(already loaded in `readSafe.ts`).

`PUT /api/v1/travtrack/legs/mode` `{ fromMs, untilMs, mode }` stores a correction;
`mode: null` resets to automatic. Answers the recomputed `Leg`, bare (the travtrack routers are the bare family, ADR 0001). A correction applies to every
derived leg it covers by more than half its duration, so it survives a small re-derivation.
Errors: 400 `TRAVTRACK_LEG_INVALID` (span or mode), 404 `TRAVTRACK_LEG_NOT_FOUND` (no leg
under the span). Minimum server: the 2.8.0 RC that ships S1.

## 3. Storage

One table `travtrack_leg_modes (id, user_id, from_ms, until_ms, mode, created_at,
updated_at)`, unique `(user_id, from_ms, until_ms)`. Included in the account export and
deleted with the account; a point/range delete leaves corrections alone (they bind to a time
span, not to points).

## 4. Phases

| Phase | Side      | Content                                                                                                                         | Status  |
| ----- | --------- | ------------------------------------------------------------------------------------------------------------------------------- | ------- |
| S1    | Server    | legs + stops on `/day`, range aggregates, point speed/altitude/motion, mode corrections (table, route, export, account delete) | open    |
| W1    | Web       | leg list in the day timeline + leg card; map ↔ timeline selection (highlight, fit bounds); stop card with stay review on the map | open    |
| W2    | Web       | correct a leg's mode inline / reset; point popup speed+altitude; map stay search + status chips; calendar in the date picker    | open    |
| W3    | Web       | "replay this journey", "show its points"; optional accuracy filter; speed-scale presets                                          | open    |
| C1    | Companion | native TravTrack history map on the existing `/day` + `/stays` contract (date navigation, coverage, bottom-sheet timeline)      | done — Track tab existed (T1); feat/travtrack-legs b25d7ea3 reads legs/stops |
| C2    | Companion | legs in the bottom sheet, leg card, tap ↔ highlight, mode correction (needs S1)                                                 | open    |
| C3    | Companion | stay review from the map marker, point popup, stay filter                                                                       | open    |

UI shape (W1, C1/C2): a clickable mock-up is shown to the owner before W1 and C2 start;
S1 and C1 do not wait for it.

## 5. Risks

- **Mode detection is where Dawarich spent the most code.** Start conservative: `auto` only
  from corroborated motion, `unknown` otherwise; entries and corrections carry the rest.
- **Leg ids from time bounds** change when late points arrive; corrections bind to spans, not
  ids, for that reason.
- **Privacy:** legs and stops are cut from the privacy-safe segments only; a stop inside a
  privacy zone is never emitted (a zone is not a state of its own, `dayView.ts`).

## Open for Companion

- C1 done (2026-11-03). C2 waits for S1 and the owner's OK on the mock-up https://claude.ai/artifact/DG9TL4F9sbF4xQEsRyJVS8.
