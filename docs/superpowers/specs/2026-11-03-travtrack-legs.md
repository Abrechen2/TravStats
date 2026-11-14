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

`/day` and the range views gain `pointDetails: Array<Array<{speedMps, altitudeM, motion}>>` (each
nullable), aligned with `segments` vertex by vertex (as built in S1).

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

| Phase | Side      | Content                                                                                                                          | Status                                                                                                     |
| ----- | --------- | -------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| S1    | Server    | legs + stops on `/day`, range aggregates, point speed/altitude/motion, mode corrections (table, route, export, account delete)   | done — feat/travtrack-legs 7493f1bc2, migration 20261103181313_travtrack_leg_modes                         |
| W1    | Web       | leg list in the day timeline + leg card; map ↔ timeline selection (highlight, fit bounds); stop card with stay review on the map | done — rc.20                                                                                               |
| W2    | Web       | correct a leg's mode inline / reset; point popup speed+altitude; map stay search + status chips; calendar in the date picker     | done — rc.20                                                                                               |
| W3    | Web       | "replay this journey", "show its points"; optional accuracy filter; speed-scale presets                                          | done — fix/travtrack-w3 6d8aa52a4                                                                          |
| C1    | Companion | native TravTrack history map on the existing `/day` + `/stays` contract (date navigation, coverage, bottom-sheet timeline)       | done — Track tab existed (T1); feat/travtrack-legs b25d7ea3 reads legs/stops                               |
| C2    | Companion | legs in the bottom sheet, leg card, tap ↔ highlight, mode correction (needs S1)                                                  | done — companion#118 (feat/travtrack-legs 0a3d91eb); Xiaomi run on rc.21 passed; iOS in the combined build |
| C3    | Companion | stay review from the map marker, point popup, stay filter                                                                        | open                                                                                                       |

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

## As built — S1 (2026-11-03)

- A rental or roadtrip window does not cut legs; it sets the mode only where auto does not clearly say walk/run/cycle.
- `PUT /travtrack/legs/mode` also accepts `mode: "unknown"`; limiter 60/min. A reset (`mode: null`) whose span no longer covers a leg deletes the correction and answers 404 `TRAVTRACK_LEG_NOT_FOUND`.
- `stayRef` is filled only while stay suggestions are on. Range aggregates are per cursor part, exclude flight windows, and cap glitch jumps.

## As built — speed fallback (2026-11-04)

Owner decision 2026-11-04; server only, contract unchanged (`modeSource: "auto"`, `confidence: "low"`).

- `legs/speedMode.ts`. Applies only to an auto stretch the motion path left `unknown` AND whose points carry no usable motion class (walking/running/cycling/automotive). A stretch where the phone spoke and failed corroboration stays `unknown`. Motion, entry and manual precedence are untouched; a roadtrip/rental window still wins over a low-confidence fallback (it yields only to a high-confidence walk/run/cycle).
- Profile (calibrated 2026-11-04 against a real ~1 Hz iPhone day, no motion): the unit is a WINDOW, not a step (`legs/windowSpeed.ts`). A window runs from one good fix to the first later fix that is >= 30 s away and has moved >= 2x the worse accuracy of its ends (a window that stays small closes at 90 s); its speed is displacement over time, so jitter cancels and a 1 s glitch is diluted. A step that is itself >= 30 s (sparse fixes) is its own window and may use the fix's `speedMps` where plausible and consistent with the deltas. Bad fixes are skipped, a gap > 15 min restarts the window, a window > 500 km/h is dropped. The profile is the time-weighted percentiles of the moving windows (>= 0.3 m/s).
- Abstains below 5 moving windows, 3 min moving time or 300 m moved.
- walk: p50 0.6-2.2 m/s, p95 <= 3.3, p99 <= 6 (percentile, not max: isolated glitches are tolerated). cycle: p50 3.5-7, p95 <= 10.5, p99 <= 13. car: >= 3 windows (>= 2 min) at >= 12 m/s, p50 >= 1.8, and either p50 >= 3 or the fast time is >= 20 % of the moving time (stop-and-go traffic has a low median), and no unbroken run of windows at foot pace (0.6-2.5 m/s) longer than 8 min (a walk is one steady stretch; traffic's slow time is broken by stops). There is no p25 floor any more: a real city drive measured p25 1.2 m/s. Anything else, including a mixed walk-then-drive stretch, is `unknown`. `run`, train, bus, boat and flight are never derived from speed (a jog overlaps slow cycling; the rest come from entries or corrections).
- Measured (6 legs of that day): the 19.6 km / 65 min drive in city traffic is `car`, the 2.2 km / 40 min walk at ~20 m accuracy is `walk`, the walk+drive leg and the car-or-cycle ambiguous leg stay `unknown`, short legs abstain.
- Leg `maxSpeedMps`: the fix-reported top speed (everyday spike rule) where there is one, else the fastest window speed (glitch-safe), so GPX and speed-less days no longer show `null`.
- Not split: one stretch gets one speed verdict, so a walk followed by a drive without a stop in between stays `unknown` until the user corrects it.

## As built — motion from the app (2026-11-04)

- The Companion sends `motion` on each uploaded point (companion feat/travtrack-legs 3fe5cb5f),
  behind the "Bewegungsart erkennen" switch, off until the user grants the motion permission.
  iOS fills it from CMMotionActivity history (up to 7 days back), Android from Activity
  Transition updates logged since the switch was turned on. Only the six server values are sent.
- With motion present, auto legs are corroborated by it; the speed fallback covers points without
  it (older days, imports, the switch off).

## As built — stop places (2026-11-04)

Contract changes are additive. The real day behind it (owner, 4 Nov, iPhone ~1 Hz): two cell/Wi-Fi
fallback fixes of 1907 m and 2662 m accuracy drew 1.3–1.5 km spikes, a 57 m wander in a hotel at
night became a 144 m "unknown" leg that split one overnight stop, and four of six stops had no name.

- **Drawn spikes.** `isBadFix` rejects only an accuracy above 10 km (the evidence pipeline's bound),
  so a 1.9 km fix was never "bad". `legs/stops.ts` `isBadVertex` now also rejects an accuracy above
  `MAX_DRAWN_ACCURACY_M` = 1000 m, and `drawnFixes.ts` `withoutBadVertices` drops such vertices from
  the stretches of `/travtrack/day` (before legs/stops are derived, so `ranges`, `pointIds` and
  `pointDetails` stay aligned) and of the range view. Storage and export keep the raw points.
  Range `aggregates` are still computed from the raw stored points.
- **Wander merge.** `findDwells` joins two dwells whose anchors are < `WANDER_M` (100 m) apart when
  no good fix between them strays ≥ 100 m from the first anchor: one stop, no leg. A real 300 m
  walk away and back stays two stops.
- **`Stop.place`** (additive): `{name, lat, lon, source: "accepted"} | null` — the name the owner
  accepted. Stored in `travtrack_stop_places` (`from_ms`, `until_ms`, `name`, `lat?`, `lon?`; unique
  per user and span; migration `…_travtrack_stop_places`), bound to a span like `travtrack_leg_modes`,
  applied to every derived stop it covers by more than half. It is in the account export
  (`travtrack.stopPlaces`, epoch ms as strings). The day does NOT call a geocoder: unaccepted stops
  carry `place: null`; there is no `suggested` source.
- **`GET /travtrack/stops/place?lat&lon&fromMs&untilMs`** (bare, tier `on`, 60/min per user, 400
  `TRAVTRACK_STOP_INVALID`): `{lat, lon, probable: {name, source: known|nearbyPlace|address|photos,
  photoSupported}|null, known: [{name, kind: place|lodging, distanceM, lat, lon}], address,
  geocoder, candidates[≤5, nearest first], candidatesState, photos}`. Reuses the Dawarich stay
  identity lookup (`stayIdentityView`) with a stop shape: radius 100 m, 20 hits fetched then sorted by
  distance (importance ranking would put a church 90 m away above the Lidl the phone stood in; no
  type is filtered, so supermarkets and charging stations are candidates). The owner's own
  places/lodgings within 100 m come first (`known`, `probable.source = "known"`). A geocoder failure
  is `geocoder` / `candidatesState` = `degraded` with a 200, never an empty success.
- **`PUT /travtrack/stops/place`** `{fromMs, untilMs, place: {name, lat?, lon?} | null}` → the
  recomputed stop. `null` removes the name. 404 `TRAVTRACK_STOP_NOT_FOUND` when no stop lies under
  the span (nothing stored), 400 `TRAVTRACK_STOP_INVALID`.
- **Web.** Every stop row of the day list (and the stop card) shows the accepted name, or — fetched
  lazily when the row is on screen, cached per stop — the probable place with "Übernehmen" and
  "Andere Vorschläge" (each candidate acceptable). A failed request, an unreachable geocoder and
  "no name found" are three different messages.
- The stay-suggestions switch is not consulted for this lookup (it names TravTrack stops, not
  Dawarich stays); only the Immich-evidence switch is read.

## Contract — stop editing and track gap (2.8.0-rc.29, 2026-11-14)

Handed to the Companion on 2026-11-14. Companion phases: (a) dismiss/restore with a dismissed section in the day view, (b) own place search, (c) take a stop into Places; the track gap is an optional settings row.

Source: forgejo/main c43b32009 (2.8.0-rc.30). All paths under `/api/v1`. Bare response family (ADR 0001, no `{success,data}` envelope).
Spec `docs/superpowers/specs/2026-11-03-travtrack-legs.md`: has a "Contract" section (section 2) and "As built - stop places", but it does NOT mention dismiss, track-gap or "to Places". Those are only in OpenAPI (`services/openapi/paths/travtrackLegs.ts`, `paths/trackGap.ts`).

### Versions (first internal RC containing the commit, via `git tag --contains`)
| Commit | Change | First RC |
|---|---|---|
| 19e9eab9e | PUT /travtrack/stops/dismissed + `dismissed` flag | rc.29 |
| 33cc11a67 | restore keeps split sibling dismissed | rc.29 |
| c4957ce80 | search a stop's place yourself | rc.29 (frontend only) |
| 88f4fb6f5 | take stop into Places | rc.29 (frontend only) |
| 87442f862 | folded stop drawn as place point | rc.25 (frontend only) |
| 4cdcb4a0e | /settings/track-gap + gap-only splitting | rc.29 |
| 24356f81b | hide Dawarich rows | rc.29 (frontend only) |
Min server for an app using any server-side item: **2.8.0-rc.29**. Dismiss is additive: an older server just never sends `dismissed`.

### 1. PUT /travtrack/stops/dismissed
Auth: cookie/JWT `authenticate`; `requireWriteScope` (read-only token -> 403); `rejectDemo` (demo -> 403); TravTrack tier `on` (instance must have TravTrack enabled); rate limiter `travTrackStopPlaceLimiter` (429).
Request (JSON):
| Field | Type | Rules |
|---|---|---|
| fromMs | int >= 0 | stop start, epoch ms |
| untilMs | int >= 0 | must be > fromMs, span <= 2 days |
| dismissed | boolean | true = only a wait; false = restore |
Semantics: bound to the span, not a stop id. Applies to every derived stop the span overlaps by > 50%. Idempotent (one row per user/from/until). Points, legs, distances, totals unchanged.
Response 200: the recomputed `Stop` (best-overlap one), see section 4. After `dismissed:true` it carries `dismissed: true`; after `false` the field is absent.
Restore (33cc11a67): drops stored rows overlapping the span; if late points had split one dismissed stop into two, the sibling not covered by the restore span stays dismissed (re-stored under its own span). Restore of a span with no stop under it -> 404.
Errors:
| Status | Code | When |
|---|---|---|
| 400 | TRAVTRACK_STOP_INVALID | bad span / body (message = first zod issue) |
| 401 | (auth) | not signed in |
| 403 | TRAVTRACK_DISABLED | TravTrack off on instance (also read-only token / demo, codes from the generic middleware) |
| 404 | TRAVTRACK_STOP_NOT_FOUND | no stop under the span (also after restore if the points no longer make a stop) |
| 429 | rate limit | |

### 2. Reading dismissed stops
`GET /travtrack/day?date=` -> `stops: Stop[]` (ordered by fromMs). Dismissed stops are NOT removed; they are listed with `dismissed: true` (literal `true`, optional, absent otherwise). The app hides them from the stop list/map by filtering `s.dismissed === true`, and shows them (e.g. in a "dismissed" section with Restore) the same way. `legs` and all aggregates are unaffected. Range views use the same Stop schema where they carry stops (openapi `stopSchema`).

### 2a. A stay across midnight is edited as ONE stay (fix/travtrack-stop-writes, after rc.31)
The day view shows a night as two clipped parts (`openEnd` on the first day, `openStart` on the next). `PUT /travtrack/stops/place` and `PUT /travtrack/stops/dismissed` take exactly the (clipped) `{fromMs, untilMs}` the day returned for a part, from either day. Rule:
- The server resolves the span to the WHOLE stay, derived the way the day view derives it (one shared derivation, `services/travtrack/dayDerivation.ts`: the day +-24 h of evidence, then clipped). The span matches the part it lies on by more than half.
- The name / the dismissal is stored on the whole stay's span (not the clipped one) and read against the UNCLIPPED stay, so BOTH days show it, whichever part was edited. `place: null` and `dismissed: false` from either part undo it for the whole stay (the split-sibling rule of a row that held two stays still applies).
- Response 200: the stay's part on the day the sent span lies in, same shape as a day-view stop (incl. `openStart`/`openEnd`).
- Rows stored earlier (the span of an ordinary within-day stop) keep matching: a stay inside one day is its own whole stay, and a stored span covering more than half of a whole stay applies to it.
- Not changed: `PUT /travtrack/legs/mode`. Legs come from the day alone, so a journey across midnight is one leg per day and a correction applies to the leg of the day it was sent for.

### 3. Search a stop's place yourself (c4957ce80) - no server change
Frontend only (`TrackStopPlaceSearch.tsx`, shared `LocationInput`). Calls:
- `GET /geo/search` (existing, enveloped `{success,data:PlaceSearchResult[]}`) for Photon search.
- Then the existing `PUT /travtrack/stops/place` body `{fromMs, untilMs, place: {name: string 1..200, lat?: number|null (-90..90), lon?: number|null (-180..180)} | null}`; `place:null` removes the accepted name. Same gating/errors as section 1 (TRAVTRACK_STOP_INVALID 400, TRAVTRACK_STOP_NOT_FOUND 404). Response 200: recomputed `Stop` with `place.source = "accepted"`.
- Related read: `GET /travtrack/stops/place?lat&lon&fromMs&untilMs` (tier on, 400 TRAVTRACK_STOP_INVALID) returns the identity candidates (not changed by these commits).

### 4. Stop shape (openapi `stopSchema`, `legs/types.ts`)
| Field | Type | Null/optional |
|---|---|---|
| fromMs, untilMs | int | |
| anchor | {lat:number, lon:number} | |
| stayRef | {id:string, status:string} | nullable |
| place | {name:string, lat:number\|null, lon:number\|null, source:"accepted"\|"fixed"\|"lodging", placeId?:string, lodgingStayId?:string} | nullable. Precedence accepted > fixed > lodging |
| folded | {fixCount:int} | nullable (null when not folded) |
| dismissed | `true` | optional, absent otherwise |
| openStart | `true` | optional, absent otherwise (travtrack-stays, 2.8.0-rc.31): the stay began before this day; `fromMs` is the day's start |
| openEnd | `true` | optional, absent otherwise: the stay goes on past the day (`untilMs` is the day's end) or, on the current day, past the latest fix at a fixed place |

### 5. Take a stop into Places (88f4fb6f5) - no server change, no new field
Frontend only (`TrackStopToPlaces.tsx`, `PlaceFormModal` prefilled with stop name + position). Existing endpoints, enveloped family:
- `GET /places?q=&limit=20` (find own place by stop name; client filters by distance to `anchor`)
- `POST /places` (create via PlaceFormModal; `createPlace`)
- `GET /places/:id` (re-read before adding a visit, to avoid a duplicate)
- `POST /places/:id/visits` body `{visitedAt: "YYYY-MM-DD"}` (optional, only if the user ticks "with visit"; skipped client-side when a visit that day exists)
There is NO link between stop and place on the server: nothing is stored on the stop. The accepted name stays a separate `PUT /travtrack/stops/place`. The app must implement the duplicate-visit check itself.

### 6. Folded stop as place point (87442f862) - no server change
Client-only drawing rule. The stop payload already carries the coordinates: `stop.anchor.{lat,lon}`; for folded stops (`folded != null`) the server sets `anchor` to the fixed place / lodging position (`derive.ts foldedStop`), and `place.lat/lon` equal it. The web replaces the raw fixes with `[fromMs, anchor.lat, anchor.lon, null]` and `[untilMs, ...]` inside the stop's [fromMs, untilMs]; raw `segments` still carry every fix (Points layer / inspector read raw). Use `anchor`, not `place.lat/lon` (`place` may be an accepted name with null coordinates).

### 7. GET/PUT /settings/track-gap (4cdcb4a0e, rc.29)
Auth: normal authenticated settings router; `settingsLimiter`; read-only token and the shared demo account may not PUT (403). Not TravTrack-tier gated.
PUT body (strict, no extra keys): `{ minutes: int }`, 5..720. Else 400 `VALIDATION_FAILED`.
GET and PUT 200 response: `{ minutes:int, default:int (120), min:int (5), max:int (720) }`, all non-null. Unset/invalid stored value reads as the default (clamped).
Consumers (server side, per user): `routes/trips/tripRecording.ts` (`GET /trips/:id/recording`, GPX export) via `trackGapMsFor`; `services/tripRecording/privacySafe.ts` splitting; TravTrack month/read paths (`months/gapChange`, `readSafe`, `shareSnapshot`). A track is cut ONLY where the phone recorded nothing for longer than this gap (the old 50 km distance split is gone). A change invalidates stored month values (`monthsOnTrackGapChanged`); stored points are never changed.
App: need not send it. It only affects how the server splits segments in responses, so the app should just render the segments it gets. Showing/editing is optional (a settings row reading `min/max/default` from GET).

### 8. Hide Dawarich rows (24356f81b)
Frontend only (settings sections `LocationSourceSection.tsx`, `TravTrackSourcesSection.tsx`). No API change. Existing `locationProvider` setting decides it.

## As built — stays across silences and midnight (fix/travtrack-stays, target 2.8.0-rc.31)

A phone at rest sends nothing, so a silence at one spot is a stay. No new endpoint, no field removed; `openStart`/`openEnd` are the only additions (section 4 above).

- **Across midnight.** `GET /travtrack/day` derives its stops from the account's points of the day plus 24 h either side (same privacy cut, deleted ranges, pauses, tombstones, the 500 m zone buffer on a bridge). Stops are clipped to the day. Legs, segments and distances still come from the day alone. If the wider read hits its cap the day falls back to day-only stops.
- **One rule** (`legs/fold.ts` `stationarySilence`): two fixes of one device, 15 min to 24 h apart, both with known accuracy of at most 50 m, and either `<= min(100, max(50, 2 * worse accuracy))` apart or both inside the same fixed place (radius + 100 m band, window holding). Used by dwells, fold runs and the bridge over a track-gap cut. Anything else (478 m at 3 m accuracy, poor accuracy, over 24 h) stays a gap.
- **Named at once.** A stop whose first fix lies in a valid fixed place or booking carries that place (accepted > fixed > lodging); overlapping places: smaller radius, nearer centre, stable id. On the current day the last fixes inside a fixed place already show an open stay (`openEnd`).
- **Coverage / timeline.** Stop spans count as `recorded`; the timeline's Home entries are the Home stops, plus runs inside the Home place's own radius that no stop covers.
