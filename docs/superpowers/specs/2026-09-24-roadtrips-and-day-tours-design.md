# Roadtrips and day tours — design

- **Status:** approved by the owner on 2026-09-24 ("Alles so bauen"), in progress
- **Target line:** 2.7.0, behind the beta switch (`roadtrips`)
- **Branch:** `dev/roadtrips`, off `fix/alex-beta13-feedback` @ `31ba5800`
  (the standalone-tour work it builds on is only there)
- **Origin:** #dev-talk, 2026-09-24 — the owner asked for hikes and bike rides
  inside a trip, and for motorhome trips with campsites; Alex proposed splitting
  them into two things. Planning page with mock-ups:
  https://claude.ai/artifact/HsAMWzEz5JCdtctLrjici8
- **Revises:** `2026-08-29-tour-route-sections-design.md` §1–2 ("not a fifth
  domain"). The two principles that decision protected are kept — see §2.
- **Board:** `roadtrips-domain`, `tours-rework-day-trips`, `tours-import-sources`;
  Companion half is `companion#9`.

## 1. Decision

The one tour system becomes two things that share one engine:

| | Roadtrip | Tour |
|---|---|---|
| What | several days, hundreds of km, cruise-like | a day trip inside a trip (or on its own) |
| Anchor | stations — each one a night, or a pass-through | the recording |
| Transport | a vehicle: motorhome, car, motorcycle, bicycle, rail, … | an activity: hike, bike, run, … |
| Domain | **yes** — `roadtrip` in `DOMAIN_KEYS` | no — part of the trip, like the diary |
| Geometry | legs between stations (straight / drawn / routed / track) | the track; legs only if the user adds points |

Both are rows of `TripRoute`, told apart by a new `kind` column.

## 2. What the 2026-08-29 decision protected, and how it still holds

That design refused a fifth domain because a second stop model would give
three competing answers to "where did this trip go?" and because a night must
be counted exactly once. Both hold here:

1. **One engine.** A roadtrip is a `TripRoute` with `kind = "roadtrip"`. Its
   stations are `TripStop` rows, its legs `TripRouteLeg`, its recordings
   `TripRouteTrack`. No table is duplicated; every leg feature (routing
   providers, drawn lines, track adoption, Dawarich) works on a roadtrip on day
   one because it is the same code.
2. **The stay owns the night.** A station links to a `LodgingStay`; the stay
   never points back. Roadtrip nights are the linked stays' nights plus the
   station's own nights only where NO stay is linked (a free pitch). A night is
   therefore never in both the lodging statistics and the roadtrip figure as two
   rows.

What changes is only the product surface: a roadtrip gets its own list, detail
page, dashboard presence and domain colour, because the owner and the tester
both see it as a kind of travel next to flights and cruises, not as scaffolding
inside a trip.

## 3. Data model

One migration, `roadtrips_and_day_tours`, additive except for the data
classification in §3.4.

### 3.1 `TripRoute`

```prisma
/// "tour" | "roadtrip". Decides which page owns the row and which fields mean
/// anything. Every leg/track feature is kind-agnostic.
kind      String  @default("tour")
/// Tour only: hike | walk | run | bike | mtb | ski | paddle | climb | other.
activity  String?
/// Roadtrip only: motorhome | campervan | caravan | car | motorcycle |
/// bicycle | rail | other. A free field, not a catalog, on purpose (owner,
/// 2026-09-24): a vehicle entity waits until someone asks for per-vehicle stats.
vehicle     String?
vehicleName String? @map("vehicle_name")
/// Tour only: the roadtrip station this day trip started from ("Preikestolen,
/// from Mosvangen Camping"). SetNull — deleting the station keeps the tour.
anchorStopId String? @map("anchor_stop_id")
/// True for rows the migration classified by rule. The UI lists them once so
/// the owner can move a misfiled row; confirming or switching clears it.
kindAssignedAutomatically Boolean @default(false) @map("kind_assigned_automatically")
```

`mode` stays: it is the default leg mode for new legs, which a roadtrip needs
(road, with a ferry leg) and a tour needs (foot/bike).

### 3.2 `TripStop` — stations

```prisma
/// Roadtrip station: the stay slept in at this station. SetNull — deleting a
/// stay leaves the station, which then reads as a free night (see
/// `overnight`), because you still slept there.
lodgingStayId String? @map("lodging_stay_id")
/// Roadtrip station: a night was spent here. Set together with a stay link,
/// and on its own for a night with no accommodation record (a free pitch).
overnight Boolean @default(false)
```

A station is **exactly one** of three states, derived and never stored as an
enum (a stored enum plus a SetNull cascade is the CHECK-constraint trap the
2026-09-21 stop migration already met):

| State | `lodgingStayId` | `overnight` |
|---|---|---|
| `stay` — night at a recorded accommodation | set | true |
| `free` — night, no accommodation record | null | true |
| `pass` — pass-through, no night | null | false |

Zod accepts the API shape `{ kind: "stay", lodgingStayId } | { kind: "free" } |
{ kind: "pass" }` and rejects everything else. The stay must belong to the same
user — a foreign key proves existence, not ownership.

### 3.3 `TripRouteTrack` — what a day tour is measured by

```prisma
/// Metres per geometry vertex, aligned with `geometry`/`cumulativeKm`; null
/// entries where the file had no <ele>. Null column on rows written before.
elevations    Json?
ascentM       Float?  @map("ascent_m")
descentM      Float?  @map("descent_m")
/// Seconds between consecutive points that actually moved (> 0.5 m/s after
/// smoothing), summed. Null when the file has no timestamps per point.
movingSeconds Int?    @map("moving_seconds")
/// Stable id of the source record — a HealthKit workout UUID, a Strava
/// activity id — so importing the same workout twice does not add a second
/// track. Unique per route.
externalRef   String? @map("external_ref")

@@unique([routeId, externalRef])
```

`TRACK_SOURCES` grows from `gpx | dawarich` to
`gpx | dawarich | fit | tcx | strava | healthkit`.

Ascent is computed from the RAW points with a 3 m hysteresis, not from the
simplified line (simplification cuts exactly the small climbs a hike is made
of) and not by summing every positive delta (GPS noise turns a flat walk into
a 400 m climb).

### 3.4 Classifying the rows that exist

Every existing `TripRoute` is classified by rule, with
`kindAssignedAutomatically = true`:

- `mode` in (`road`, `ferry`, `rail`) **and** its stops span at least one night
  → `roadtrip`, `vehicle` null.
- otherwise → `tour`; `activity` = `hike` for `foot`, `bike` for `bike`, null
  for anything else.

A multi-day bike trip therefore lands as a tour, which is exactly why the flag
exists and the UI offers the switch.

## 4. API

Everything under `/api/v1`, `authenticate` + `requireWriteScope`, Zod at the
boundary, OpenAPI entry for every new path.

The routeId-keyed `/tours/:routeId/*` family already serves legs, points,
tracks, routing and geometry for any `TripRoute`; it stays kind-agnostic and a
roadtrip uses it as-is. New:

```
GET    /roadtrips                          list: name, vehicle, span, km, nights, stations
POST   /roadtrips                          create (optional tripId)
GET    /roadtrips/:id                      detail: stations with stay summary, legs, tours
PUT    /roadtrips/:id/stations             ATOMIC full ordered station list (like /points)
PATCH  /tours/:routeId/kind                switch tour <-> roadtrip; clears the auto flag
POST   /tours/:routeId/kind/confirm        keep the automatic kind; clears the flag

# The phone's (companion#12, #13) — append, never replace the whole list
GET    /roadtrips/active?date=             the roadtrip covering the phone's local date
POST   /roadtrips/:id/stations             append ONE station; idempotent within 150 m
GET    /day-context?date=                  the trip and roadtrip station covering a day
```

**As built, differing from the first draft (corrected 2026-09-25):**

- A roadtrip is edited and deleted through the kind-agnostic
  `PATCH/DELETE /tours/:routeId`; a separate `/roadtrips/:id` pair would have
  been a second copy of the same handler. Deleting gives a trip's stops back
  WITHOUT their night columns, as dropping a station does.
- There is no `.../stations/:stopId/stay`. The station editor creates the
  lodging and its stay through the ordinary lodging endpoints — so currency,
  status and FX follow the lodging page's rules — and takes the lodging back
  when the stay fails. The link itself is saved with the station list.

`GET /tours` gains `?kind=tour|roadtrip` and returns `kind`, `activity` and the
track figures. The track upload accepts `.gpx`, `.fit` and `.tcx`.

## 5. Import sources

| Source | How | State |
|---|---|---|
| GPX | existing multipart upload | extend: `<ele>`, moving time |
| Dawarich | existing pull | unchanged |
| FIT | binary parser (`fit-file-parser`) on the same upload | new |
| TCX | XML, `fast-xml-parser` (already a dependency) | new |
| Strava | OAuth 2 per user; admin supplies client id/secret; list activities in a window, import picked ones via the streams API | new |
| Komoot | no public API is known; the partner API needs a contract. **Not built.** The UI says to export GPX from Komoot and upload it. | documented |
| Apple Fitness | HealthKit in the Companion (`companion#9`); uploads GPX with `externalRef` = workout UUID and the metadata fields | server side here, app side in the Companion |

Strava follows the Dawarich/Immich pattern: per-user opt-in, credentials
encrypted at rest, the fixed error-kind vocabulary
(`notConfigured|unreachable|auth|notFound|protocol`), no egress to Strava unless
the user connected it.

**Strava's terms shape the feature, checked 2026-09-24:**

- Since the November 2024 API agreement a third-party app may show a user's
  Strava data **only to that user**, and may not feed it to AI/ML. So a
  Strava-sourced track is excluded from the trip AI summary (`tripAiSummary`)
  and from anything shared with another account or rendered on a shared page.
  The track row carries `source = "strava"`, which is what those paths check.
- Since 30 June 2026 standard-tier API access needs an active Strava
  subscription. Each operator registers their **own** Strava API application —
  TravStats ships no client id — which is also the only arrangement that fits a
  self-hosted instance.

**Komoot is not built.** There is no public API; Komoot's own help page says it
grants API access on request for private purposes, and the partner API needs an
agreement. The unofficial `v007` endpoints that community tools scrape are not
a basis for a shipped feature. The import dialog says: export the tour as GPX in
Komoot and upload it here. Revisit if an operator obtains access.

## 6. Frontend

- Domain `roadtrip`, colour `#a597f0`, route prefix `/roadtrips`, gated by
  `useEnabledDomains()` and by the beta entry `roadtrips`.
- `/roadtrips` — list. `/roadtrips/:id` — detail as in the planning mock-up:
  header figures, map, stations by day with the three state chips, attached
  tours. Station editing on the same page; legs keep using the existing leg
  editor (`TripRouteEditorPage`).
- Tours: the tour page shows activity, distance, ascent, duration, moving time,
  an elevation profile and the source of the recording. The trip's tour tab
  shows only `kind = tour`; roadtrips appear on the trip as a linked item.
- A one-time notice lists automatically classified rows with a switch.
- Dashboard: the existing tour tab shows tours only; roadtrips get their own
  tab and a globe/2D layer in the domain colour.

## 7. Statistics

Per roadtrip: km (travelled, and driven = non-ferry legs), days, nights by
state, places slept (distinct stays + free stations), countries (from station
coordinates). Nights come from `lodgingStats` for linked stays — never summed a
second time. Achievements follow the monotonic engine: a first roadtrip, 1,000 /
5,000 km on the road, nights at a free pitch.

## 8. Invariants and their tests

1. A station is exactly one of stay / free / pass — Zod test plus a service test
   that deleting the linked stay leaves a free station.
2. A station's stay belongs to the caller — 404 for someone else's stay.
3. A roadtrip's nights never double-count a stay night — test with one stay
   station and one free station. A cancelled stay contributes no night and no
   place slept, as in the lodging statistics.
4. Ascent uses raw points with hysteresis — a noisy flat track stays under 10 m.
5. The same `externalRef` twice on one route is one track — second upload 409.
6. Classification — foot/bike rows and a road row within one day stay tours, a
   road/ferry/rail row spanning at least one night becomes a roadtrip, all
   flagged.
