# Companion "Track" area — contract (2026-10-30)

Owner approved an app "Track" area (Dawarich-like), navigation concept C: bar
Start · Reisen · Track · Plan (placeholder) · +; TravPlan later as "Geplant" in
Reisen. Concept: https://claude.ai/artifact/BwrgfWcTXmTEYP2zP7VFHJ. Plan context:
`docs/superpowers/plans/2026-10-24-travtrack.md` (Phase 2, TravTrack).

The app only reads. Every endpoint below is already served (minimum server
**2.8.0-rc.2**, also present in 2.7.0 unless noted in the appendix); nothing in
this contract changes the server.

## Phases

| Phase | Side | What | Server endpoints | State |
|---|---|---|---|---|
| T1 Day | Companion | one day: track, coverage, stays, unlabelled movement | `GET /travtrack/day?date=`, `GET /travtrack/stays?fromDay=&toDay=` (+ summary, capabilities) | app built (build 72, feat/track-day @ d02b01a7), device test open |
| T2 Calendar | Companion | year grid with km per day | `GET /travtrack/calendar?year=` | server ready; app open |
| T3 Months + explored | Companion | month summaries, explored-area map | `GET /travtrack/months?year=`, `GET /travtrack/explored?bbox=w,s,e,n` | server ready; app open |
| T4 Export | Companion | GPX / JSON download | `GET /travtrack/export?format=gpx\|json` | server ready; app open |
| S-T1 Moves | server | "moves" between stays: mode of travel + km | — (not built) | gap — needs a plan entry and owner scheduling |
| S-T2 Calendar flags | server | per-day trip / flight flags in the calendar | — (not built) | gap — additive fields on `/travtrack/calendar` |

Until S-T1/S-T2 exist the app shows stays without moves (unlabelled movement
comes only from `/day` `context[]` with `kind: "movement"`, no mode) and a
calendar without trip/flight markers. Both gaps are additive: the app must
treat the future fields as optional.

## Rules the app must follow

- Gate: a refusal is **403 `TRAVTRACK_DISABLED`**, never 404 — show "TravTrack
  is off" rather than an empty state. `GET /travtrack/capabilities` (open) says
  which tier the account is in.
- Clocks: `/day` and `/stays` bucket by the **profile zone**; `/calendar` and
  `/months` bucket by **UTC**. A day near midnight can differ between the two —
  do not join them by date string without knowing this.
- Errors: `{ error, code?, field? }`; 400 `VALIDATION_FAILED` with `details`.
- Auth: Bearer PAT first, then the cookie; read-only PATs pass every GET.

## Appendix — response shapes as served at 64bd146bf

## Gate and auth (both apply to every route below)

- Auth: `authenticate` (`middleware/auth.ts:61`). A `Authorization: Bearer` PAT is tried first (`authenticateWithApiToken`), otherwise the HttpOnly `auth_token` cookie. A read-only PAT passes every GET (`requireWriteScope` is method-aware, `middleware/auth.ts` ~L285-300).
- Tiers (`routes/travtrack/gate.ts:11-42`):
  - `open`: no gate (`/capabilities`).
  - `offered`: `assertTravTrackOffered()` = `instanceSettings.betaFeaturesEnabled` (`services/travtrack/availability.ts:30-36`).
  - `on`: offered AND `travtrack_config.enabled` (`availability.ts:39-42`). Config row, or env `TRAVTRACK_ENABLED==="true"` if no row (`services/travtrack/config.ts:21-26`).
  - `held`: `on`, OR the account holds any TravTrack data (`availability.ts:73-83`).
- Refusal: `403 {"error":"TravTrack is switched off on this server","code":"TRAVTRACK_DISABLED"}` (`availability.ts:27-28`, `gate.ts:33-34`). No gate answers 404.
- Consequence: views (`on`) answer 403 with the instance off, even for an owner with data. Export, summary, zones, imports, diagnostics (`held`) stay open to a holder.

## Error body vocabulary

Source: `middleware/errorHandler.ts:629-710`.
- AppError: `{ error: string (English prose), code?: string, field?: string }`, status from the error.
- Zod (any `.parse` in these handlers): `400 {"error":"Validation error","code":"VALIDATION_FAILED","details":[{field,message}]}`. Time-model issue: `422 {"error":"Time field refused","code","field"}`.
- Prisma P1001/P1002/P1008: `503 DB_UNAVAILABLE`. P2002: `409 DUPLICATE`.
- Unmatched route: `404 {"error":"Not found"}`.
- TravTrack codes (`middleware/travTrackErrorCodes.ts:8-28`) used by GETs:
  - `TRAVTRACK_DISABLED` 403 (gate)
  - `TRAVTRACK_RANGE_TOO_LONG` 400 (range > 400 days, `routes/travtrack/views.ts:51-57`)
  - `TRAVTRACK_EXPORT_TOO_LONG` 400 (export > 366 days, `export.ts:41-46`)
  - `TRAVTRACK_EXPLORED_ZOOM_IN` 400 (> 50 000 cells, `services/travtrack/explored/privacy.ts:85`)
  - `TRAVTRACK_EXPLORED_UNAVAILABLE` 409 (`privacy.ts:88-93`)
  - `TRAVTRACK_EXPLORED_PREPARING` 409 (`privacy.ts:97`)
  - `TRAVTRACK_FLIGHT_NOT_FOUND` 404 (`views.ts:71`, `flightPanel.ts:84`)
  - `TRAVTRACK_PHOTO_WINDOW_TOO_LONG` 400 (> 7 days, `routes/travtrack/photos.ts:43-45`)
  - `SHARED_ROUTE_NOT_FOUND` 404 (`shareSnapshot.ts`, shared-route GET)
- Photos use their own bodies: `409 {"error":"notConfigured","message"}` (no Immich), `502 {"error":<ImmichError kind>,"message"}` (`photos.ts:53-70`); the file route answers 404/502 with a placeholder image, and `404 {"error":"notFound"}` when the asset is not in the window (`photos.ts:98-100`).
- Diagnostics upload rate limit message: `{"error":"Too many diagnostics uploads, please try again later"}` (`middleware/travTrackViewLimits.ts:37`). The view limiters (120/min, `travTrackViewLimiter`; 30/min, `travTrackPhotoSearchLimiter`) use express-rate-limit defaults; I did not read their body.

---

## Endpoints

All paths below are under `/api/v1`.

### 1. `GET /travtrack/capabilities` (open)  `routes/travtrack.ts:64-87`
```ts
{ version: 1; offered: boolean; enabled: boolean; active: boolean; hasData: boolean;
  sources: ("companion"|"gpx"|"owntracks"|"overland")[];   // always present on backend
  diagnostics: true }                                      // always present
```
Query: none.

### 2. `GET /travtrack/config` (offered + admin)  `routes/travtrack.ts:90-98`
```ts
{ enabled: boolean }
```
Query: none. Non-admin: admin refusal from `requireAdmin`. PATCH at `:100` is not a GET.

### 3. `GET /travtrack/day` (on)  `routes/travtrack/day.ts:18-28`
Query: `date` = `YYYY-MM-DD`, required (`schemas/travtrack.ts:105`). No view limiter. Parsed synchronously; bad input → 400 VALIDATION_FAILED.
```ts
// services/travtrack/dayView.ts:31-42
type TravTrackDay = {
  date: string;                     // echo of query
  zone: string;                     // profile zone the day is read on
  segments: StoredPoint[][];        // StoredPoint = [tMs:number, lat:number, lon:number, accuracyM: number|null]  (tripRecording/segments.ts:24)
  pointIds: string[][];             // ALWAYS present (frontend types it optional)
  coverage: Array<{ fromMs: number; untilMs: number;
                    state: "recorded"|"noData"|"deleted"|"phonePaused" }>;   // dayView.ts:27-28
  context: DayContextEntry[];       // see below
  pointCount: number;
  truncated: boolean;               // read.next !== null
};
// services/travtrack/dayContext.ts:47-59
type DayContextEntry = { fromMs: number; untilMs: number;
  kind: DomainKey | "trip" | "home" | "suggestion" | "movement";  // DomainKey: flight|cruise|lodging|poi|roadtrip|rail|rental|bus|ferry (shared/domains.ts:6-16)
  id: string | null; label: string; href: string | null;
  anchor: { lat: number; lon: number } | null;
  unlabelled: boolean; suggestion?: "stay" | "journey" };   // suggestion key present only when kind = "suggestion"
```
Note: `DayContextEntry` is `Span & {...}` where `Span = {fromMs, untilMs}` (`readSafe.ts:72`). Day window is profile-clock midnight to next midnight.

### 4. `GET /travtrack/range` (on, views limiter)  `routes/travtrack/views.ts:42-61`
Query (`schemas/travtrackViews.ts:21-24`): either `from`+`to` (ISO datetime with offset, `to` exclusive) or `fromDay`+`toDay` (YYYY-MM-DD, inclusive); `cursor` = `^\d{1,15}:\d{1,19}$` optional. Span ≤ 400 days (`TRAVTRACK_RANGE_MAX_DAYS`), else 400 `TRAVTRACK_RANGE_TOO_LONG`. Both forms → 400 unless exactly one is used; `to` must be after `from`.
```ts
// services/travtrack/rangeView.ts:30-45
type TravTrackRange = { from: string; to: string;             // ISO
  segments: StoredPoint[][]; pointIds: string[][];
  pointCount: number; readCount: number; simplified: boolean;
  omittedSegments: number; next: string | null; cursor: string | null };
```

### 5. `GET /travtrack/flights/:id/panel` (on, views limiter)  `views.ts:64-74`
`:id` must be a UUID, else 404 TRAVTRACK_FLIGHT_NOT_FOUND. No other query.
```ts
// services/travtrack/flightPanel.ts:61-80
type FlightPanel = { flightId: string; label: string /* "" if none */; departureZone: string | null;
  basis: "linked"|"window"|null; series: Array<Array<[tMs:number, altM:number|null, speedMps:number|null]>>;
  pointCount: number; truncated: boolean;
  takeoffMs: number|null; landingMs: number|null;
  summary: { maxAltitudeM: number|null; maxSpeedMps: number|null; climbToCruiseMinutes: number|null } };
```
Unknown or foreign flight → 404 TRAVTRACK_FLIGHT_NOT_FOUND (`flightPanel.ts:108`).

### 6. `GET /travtrack/stays` (on, views limiter)  `views.ts:77-99`
Query (`schemas/travtrackViews.ts:66-90`):
- `status`: comma list of `pending|accepted|rejected`, regex-checked, default all three, duplicates removed.
- `fromDay` + `toDay`: both or neither (`"fromDay and toDay move together"`), `fromDay <= toDay`. **No `from`/`to` instants on this endpoint.**
- `cursor`: `^\d{1,15}:[0-9a-f-]{36}$`, = `nextCursor` of previous page.
- `limit`: int 1..200, default 100.
```ts
// services/travtrack/stays.ts:28-43 (response: { stays: TravTrackStay[]; nextCursor: string | null } at :66-67,:113-135)
type TravTrackStay = { id: string; status: "pending"|"accepted"|"rejected"; provider: string;
  day: string;          // YYYY-MM-DD on the stay's zone clock
  startAt: string; endAt: string; zone: string;   // ISO, zone = IANA
  position: { lat: number; lon: number } | null;  // null inside a privacy circle
  name: string | null; place: { id: string; name: string } | null;
  tripId: string | null; visitId: string | null;
  detectedAt: string; resolvedAt: string | null };
```
Notes: `status` is returned mapped (`accepting` → `pending`). `pending` silently drops out while stay suggestions are switched off (`stays.ts:69-71`). Only `dawarich_stays` rows (not `covered`/`invalidated`). No moves, no mode, no km.

### 7. `GET /travtrack/calendar` (on, views limiter)  `views.ts:102-111`
Query: `year` = `^\d{4}$` between 1970 and 2100 (`schemas/travtrack.ts:180-187`, reused from months).
```ts
// services/travtrack/months/calendar.ts:18-25
type TravTrackCalendar = { year: number;
  days: Array<{ day: string /* YYYY-MM-DD, UTC */; kmGround: number /* 1 decimal */; recorded: true }>;
  pending: string[];        // "YYYY-MM"
  unavailable: string[];    // "YYYY-MM" (row predates calendar)
};
```
Days are UTC days (`calendar.ts:1-5`, `project.ts` dayValues), not the profile clock used by `/day`. Days with no privacy-safe vertex are absent, never zero. No trip/flight flags.

### 8. `GET /travtrack/months` (on)  `routes/travtrack/months.ts:29-37`
Query: `year` (same rule as calendar).
```ts
// services/travtrack/months/read.ts:20-30
type TravTrackMonths = { months: Array<{ month: string /* YYYY-MM UTC */; kmGround: number /* 1 decimal */;
  countries: string[]; cities: Array<{ name: string; countryCode: string | null }> | null;
  daysWithData: number; daysPaused: number }>; pending: string[] };
```
Months with no row are absent. `cities` null while lookup off/incomplete.

### 8b. `GET /travtrack/city-lookup` (on)  `months.ts:39-46` → `{ enabled: boolean }`. (`PUT` at :48, not a GET.)

### 9. `GET /travtrack/explored` (on, NO views limiter)  `routes/travtrack/explored.ts:18-28`
Query (`schemas/travtrack.ts:155-178`): `bbox` required, `"west,south,east,north"`, four finite numbers, lon in [-180,180], lat in [-90,90], `south <= north`; west > east allowed (antimeridian). Other params ignored.
```ts
// route answers
type ExploredAnswer = { cells: Array<[x: number, y: number]> };
// Web-Mercator tiles at zoom 14 (services/travtrack/explored/cells.ts:13, privacy.ts:5)
```
Cap: 50 000 cells in box (`privacy.ts:42`), else 400 TRAVTRACK_EXPLORED_ZOOM_IN. Zone raster still building → 409 TRAVTRACK_EXPLORED_PREPARING. Zones too large → 409 TRAVTRACK_EXPLORED_UNAVAILABLE.

### 10. `GET /travtrack/export` (held)  `routes/travtrack/export.ts:33-72`
Query (`schemas/travtrack.ts:112-124`): `from`+`to` or `fromDay`+`toDay` (same rules as range); `format` = `gpx|json` default `json`; `cursor` `^\d{1,15}:\d{1,19}$`. Span ≤ 366 days (400 TRAVTRACK_EXPORT_TOO_LONG).
Response: file. `Content-Disposition: attachment; filename="travtrack_<from>_<until>.json|.gpx"`. JSON `Content-Type: application/json`, GPX `application/gpx+xml`.
Headers always: `X-TravTrack-Origin: travtrack`, `X-TravTrack-Coverage: complete|truncated`. If truncated: `X-TravTrack-Next`, `X-TravTrack-Cursor`, `X-TravTrack-Until`.
JSON body (`services/travtrack/exportFormats.ts:38-72`):
```ts
{ version: 1; origin: "travtrack"; from: string; to: string;
  coverage: "complete"|"truncated"; next: string|null; cursor: string|null;
  points: Array<{ t: string; lat: number; lon: number; accuracy: number|null; altitude: number|null;
                  speed: number|null; course: number|null; deviceId: string|null; origin: string|null;
                  purpose: string; segment: number }>;   // streamed
  gaps: Array<{ from: string; to: string; reason: string; deviceId: string|null }>;
  deletedRanges: Array<{ from: string; to: string }> };
```

### 11. `GET /travtrack/points` (on)  `routes/travtrack/points.ts:102-140`
Query (`schemas/travtrack.ts:53-68`): `from`, `to` ISO datetime (both REQUIRED, `to` exclusive); `cursor` `^\d{1,15}:\d{1,19}$`; `limit` int 1..5000 default 1000.
```ts
{ points: Array<{ id: string; t: string; lat: number; lon: number;
    accuracy: number|null; altitude: number|null; speed: number|null; course: number|null;
    motion: string|null; deviceId: string|null; purpose: string;
    entries: Array<{ kind: "flight"|"trip"; id: string }> }>;   // entries: only live ones, pointIds from entriesOfPoints (pointEntries.ts:9)
  nextCursor: string|null };
```
Reads stored rows directly (not `readSafe`), so no privacy cut in this route.

### 12. `GET /travtrack/summary` (held)  `points.ts:179-226`
Query (`schemas/travtrack.ts` `travTrackSummaryQuerySchema`): optional span: `from`/`to` or `fromDay`/`toDay`. No span = whole history.
```ts
{ pointCount: number; firstAt: string|null; lastAt: string|null; lastReceivedAt: string|null;
  devices: Array<{ deviceId: string|null; pointCount: number; fileName: string|null }>;
  deletedRanges: number; zones: number }
```

### 13. `GET /travtrack/last-seen` (on)  `points.ts:231-247`
Query: none.
```ts
{ lastSeen: null | { at: string; lat: number; lon: number; accuracyM: number|null;
    deviceId: string|null; deviceLabel: string|null; origin: string } }
```
(`services/travtrack/lastSeen.ts:31-41`.)

### 14. `GET /travtrack/zones` (held)  `routes/travtrack/zones.ts:30-37`
Query: none. Response `{ zones: Array<{ id; name; lat; lon; radiusM; createdAt: Date; updatedAt: Date }> }`, JSON-serialised (`services/travtrack/zones.ts:50-58,135-141`). `createdAt`/`updatedAt` are not in the web type.

### 15. `GET /travtrack/imports` (held)  `routes/travtrack/imports.ts:147-171`
Query: none. Newest first, max 100 (`services/travtrack/imports/fileImport.ts:199-219`).
```ts
{ imports: Array<{ id: string; kind: string; fileName: string; status: string;
    report: unknown|null;       // stored JSON as-is
    pointCount: number; fromAt: string|null; toAt: string|null;
    createdAt: string; finishedAt: string|null }> };
```

### 16. `GET /travtrack/imports/dawarich` (held)  `imports.ts:107-115`
Query: none. Response (`services/travtrack/imports/dawarichImport.ts:261-289`):
```ts
{ connection: "own"|"shared"|"none";
  copy: null | { importId: string; status: "running"|"paused"|"interrupted"|"complete"|"incomplete"|"failed"|"cancelled";
    fromDay: string; untilDay: string; nextDay: string; daysDone: number; daysTotal: number;
    lastErrorKind: string|null; createdAt: string; finishedAt: string|null;
    totals: CopyTotals; months: Array<{ month: string } & MonthReport> } };
```

### 17. `GET /travtrack/ingest-tokens` (held)  `routes/travtrack/ingestTokens.ts:83-90`
Query: none. `{ tokens: Array<{ id; kind; label; createdAt: string; lastUsedAt: string|null }> }` (`listing`, :45-51). No secret.

### 18. `GET /travtrack/diagnostics/day` (held)  `routes/travtrack/diagnostics.ts:77-86`
Query (`schemas/travtrackDiagnostics.ts:36-39`): `date` YYYY-MM-DD (required); `deviceId` optional. Response `DiagnosticsDay` (`services/travtrack/diagnostics/read.ts:167`): `{ date; zone; from; until; deviceId; devices; hasLog; pointsPerMinute: {t,n}[]; fixesPerMinute; events; eventsTruncated; carried; gaps; ... }`. Full type not expanded.

### 19. `GET /travtrack/diagnostics/export` (held)  `diagnostics.ts:88-103`
Query (`schemas/travtrackDiagnostics.ts:41-50`): `from`, `to` ISO (required, span ≤ DIAGNOSTICS_RETENTION_DAYS), `deviceId` optional. Response: JSON file `attachment; filename="travtrack-diagnostics-<from date>.json"`. Shape: `DiagnosticsExport` (`read.ts:323`), not expanded.

### 20. `GET /travtrack/photos` (on, photo-search limiter)  `photos.ts:54-79`
Query (`schemas/travtrackViews.ts:43-46`): `from`, `to` ISO datetime, `to` exclusive, `to > from`, span ≤ 7 days.
```ts
// services/travtrack/photos.ts:38-57
{ photos: Array<{ assetId: string; type: "IMAGE"|"VIDEO"; takenAt: string; lat: number; lon: number }>;
  truncated: boolean; trackTruncated: boolean };   // trackTruncated always present
```
Errors: 409 `{error:"notConfigured",message}`, 502 `{error:<kind>,message}`.

### 21. `GET /travtrack/photos/:assetId/file` (on, proxy limiter)  `photos.ts:85-128`
`:assetId` UUID, else 404 `{error:"notFound"}`. Query: `from`, `to` (same as photos), `size` = `thumbnail|preview`, default `thumbnail`. Answers an image stream, `ETag: "<assetId>-<size>"`, `304` on match. Refusal: 404 `{"error":"notFound"}` (no code); 409 `{"error":"notConfigured"}`; Immich errors → placeholder image with 404/502.

### 22. `GET /trips/:id/share-snapshot` (held, NOT under /travtrack)  `routes/travtrack/shareSnapshot.ts:53-61`
Query: none. `{ snapshot: TripRouteSnapshot | null }`. Owner's own trip route snapshot.

### 23. `GET /trips/:id/shared-route` (on, NOT under /travtrack)  `shareSnapshot.ts:93-108`
`{ routes: SharedTripRoute[] }`. Another member's shared route. 404 `SHARED_ROUTE_NOT_FOUND` when none. Not an own-account view.

---

## Client cross-check (`frontend/src/lib/api/travtrackViews.ts`, `travtrack.ts`, `travtrackMonths.ts`)

Matches: range (`TravTrackRange`), stays (`TravTrackStay`, incl. `position` null in zone), calendar, months (`TravTrackMonth`), explored (`ExploredCell`), day entry kinds, `TrackCoverageState`, last-seen, zones (`.zones`), capabilities core fields, summary core fields, export format.

Mismatches (all additive, none breaking):
1. `TravTrackDay.pointIds` typed optional; backend always sends it (`dayView.ts:36,96`).
2. `TravTrackFlightPanel.label`, `departureZone`, `takeoffMs`, `landingMs` typed optional; backend always sends them (`flightPanel.ts:61-80`).
3. `TravTrackPhotos.trackTruncated` typed optional; backend always sends it.
4. `TravTrackCapabilities.sources` typed optional; backend always sends it. Backend also sends `diagnostics: true`, which the client type lacks.
5. `TravTrackSummary.devices[]` lacks `fileName` (backend has it).
6. `PrivacyZone` lacks `createdAt`/`updatedAt` (backend has them).
7. `TravTrackMonths.pending` and `TravTrackCalendar.pending/unavailable` match.

Clock note: `/day` and `/stays` day fields use the profile zone; `/calendar` and `/months` use UTC. A client that lays both on one axis must not mix them.

## Not determined
- Exact express-rate-limit 429 body for the view limiters (not read).
- Full `DiagnosticsDay` / `DiagnosticsExport` types (not expanded).
- `trips/:id/share-snapshot` and `shared-route` shapes are only partly read.
