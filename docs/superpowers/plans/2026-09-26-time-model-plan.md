# ADR 0002 time model — implementation plan for 2.7

Base: `integrate/test2-2026-09-26` at 442c21dcb (beta.15 + loyalty rework), which already carries the zone-resolver fix `e06677327`,
rail parser, trip suggestions, stats/achievements coverage). One long-running branch `dev/time-model`;
each phase merges back into it; merging into `main` stays the owner's release call. The RC server runs on a
mirror of prod data and the migration report is read there before promotion.

## Facts that shape the plan (checked on the branch)

- **Resolver fix exists:** `utils/geoTimezone.ts` provides `zoneAt()`, a boot self-check, `/health`
  `degraded`, 503 `TIMEZONE_LOOKUP_UNAVAILABLE`. Phase 1 wraps it. `TZ_UNRESOLVED` (422, "this place has no
  zone") stays distinct from the 503 ("the lookup cannot run").
- **No server-side profile zone:** the web keeps `display.timezone` in `settingsStore`; it reaches the server
  only through `UserSettings.data` JSON; seeds leave it out (#87). Q1 needs the server to know it.
- **Flights already accept `departureLocal` + `depTimezone`** (`schemas/flight.ts:142–401`) and refuse DST
  gaps; the zone is not stored.
- **Web writes visits as fake UTC with Z** (`${date}T${time||"00:00"}:00.000Z`, `PlaceDetailPage.tsx:122`);
  the Companion writes `new Date().toISOString()` (real UTC with ms). A Z suffix cannot tell them apart.
- **File-size pressure:** `routes/flights.ts` 1349/1374 frozen, `routes/trips.ts` 769/800 → new code in
  sub-modules.
- **Host zone is configurable:** `docker-compose.prod.yml` `TZ: ${TZ:-UTC}` → self-hosted instances may have
  written day columns under a non-UTC host.
- node-cron 3 supports `timezone`; ESLint 10 bulk suppressions (`eslint-suppressions.json`) fail on stale
  entries by default → ratchet semantics for free.

## Refinement to ADR D7

Phase 2 must not write real instants into today's fake-UTC columns (that would make `CruiseStop`,
`TripStop`, `PlaceVisit` mixed columns). So Phase 3 splits: **3a (DDL)** only adds columns and ships with
Phase 2 — write paths dual-write (legacy column keeps its old meaning, new columns get the real value);
**3b (backfill)** converts existing rows. No legacy column is ever rewritten; Phase 6 drops them and re-points
Prisma field names with `@map`. **Conversion runs in TypeScript through `shared/time`, not SQL** — Postgres
`AT TIME ZONE` resolves the repeated hour to the later occurrence and moves gap times silently (contradicts
Q5/D3), and its tzdata can differ from Node's ICU.

## Phase 1 — Foundation (no schema change) — M

**Agent A (backend, owns `shared/time/vectors.json`)**
1. `backend/src/shared/time/`:
   - `zoneOf.ts`: catalogue first (`Airport`/`Port`/`RailStation.timezone`), then `zoneAt(lat, lon)`; returns
     `{zone, source: "catalogue"|"coordinates"}` or throws `TzUnresolvedError` (422 `TZ_UNRESOLVED`); never a
     profile/host/UTC fallback.
   - `instant.ts`: `toInstant(local, zone, {fold, origin: "typed"|"machine"})` → `{utc, offset, ambiguous}`
     (typed gap → `LOCAL_TIME_NONEXISTENT`, logic moved from `wallClockExistence.ts`; machine gap → post-gap
     offset, not refused); `toLocal(utc, zone)` → `{local, offset}` (Intl, from `zonedWallClock.ts`);
     `localDay(utc, zone)`; `isValidZone`.
   - `localDate.ts`: `fromDbDate(Date) → "YYYY-MM-DD"` (UTC getters only), `toDbDate(string)`.
   - `clock.ts`: `now()`, `todayIn(zone)`, `setClockForTests()`.
   - `profileZone.ts`: `profileZoneOf(userId)` from `UserSettings.data.display.timezone`, validated →
     `{zone, source:"profile"|"default-utc"}`; the UTC default only for "today" questions, logged; never for
     a place.
   - `wire.ts`: `LocalTimeInput {local, zone?, placeRef?, fold?}`, `TimeValue {utc, zone, offset, local,
     precision}`, `LocalDateValue {date, zone, precision}`, `serializeTime()`.
   - `schedulerZone.ts`: one explicit zone per job.
2. Route old helpers through `shared/time` (not deleted yet), each with a `@deprecated → shared/time` header:
   `utils/timezone.ts` (`legacyFakeUtcToRealUtc`, `localWallClockOf`, `toLocalDateString`),
   `utils/stayInstant.ts`, `shared/zonedWallClock.ts`, `shared/wallClockExistence.ts`, `airportCalendarDay`,
   `stationDayKey`.
3. Cron: `timezone: schedulerZone(job)` on all 12 `cron.schedule` calls (`jobs/*Scheduler.ts`,
   `services/backupScheduler.ts`, `services/reminderScheduler.ts`). Fixed jobs UTC; backup uses the
   admin-configured zone, default boot-time `process.env.TZ ?? "UTC"`, resolved once, logged, on `/health`.
4. `/api/v1/version` gains `tzdata: process.versions.tz` (OpenAPI `paths/misc.ts`, response schema).
5. Prisma `@db.Date` probe: round-trip `Document.issuedOn` under `TZ=Pacific/Kiritimati` and
   `America/St_Johns` — proves adapter-pg does not parse DATE (OID 1082) as host-local midnight. If it fails,
   register a string parser for 1082 in `prismaClient.ts` before Phase 3.
6. Library boundaries, one test each: exceljs date cells in import; Aviationstack/AirLabs converters in
   `utils/timezone.ts` (their `new Date(timeString)` UTC fallback becomes `TZ_UNRESOLVED`); EXIF photo times.

**Agent B (web + CI)**
1. `frontend/src/shared/time/` display-only mirror (`toLocal`, `localDay`, `todayIn`,
   `formatTimeValue(TimeValue, locale)`), header "MIRRORED at backend/src/shared/time — change both
   together"; `frontend/src/shared/localWallClock.ts` and `zonedWallClock.ts` delegate to it.
2. Vector runners in both trees reading `shared/time/vectors.json` via fs/JSON import (not shipped in the image).
3. ESLint ratchet (`backend/eslint.config.mjs`, `frontend/eslint.config.js`), level error, `shared/time/**`
   exempt: `no-restricted-syntax` on host-local getters/setters incl. `getTimezoneOffset`,
   `new Date(...)` with >1 argument, `toLocale(Date|Time)?String`, `Date.now()` in status/"today" files
   (listed in config); `no-restricted-imports` on date-fns `format` and `date-fns-tz`
   `fromZonedTime`/`formatInTimeZone`/`toZonedTime`. Baseline via `eslint --suppress-rule …` →
   `eslint-suppressions.json` per tree (~29 backend, ~75 web + date-fns-tz sites); stale entries fail.
4. CI odd-zone jobs in `.github/workflows/ci.yml`: `backend-tests-tz` (matrix tz × 4 shards, `TZ` env,
   `jest --json` → `scripts/check-tz-ratchet.mjs`), `frontend-tests-tz` (vitest json). Baseline
   `scripts/tz-failures-baseline.json` `{backend:{zone:[test ids]}, frontend:{…}}` from the first run; new and
   stale entries fail; required from day one. `.forgejo/workflows/ci.yml` is Paperclip's → same jobs as a
   Forgejo PR (`forgejo#N`) or with the owner.
5. CLAUDE.md "Enforced": three rows (time lint ratchet, odd-zone CI, vectors) naming their checks.

**Vectors (`shared/time/vectors.json`)** — header `{version: 1, minTzdata: "2025a", cases: [...]}`, case
`{id, op, input, expect}`, op ∈ `toInstant | toLocal | localDay | todayIn | span`:

| id | input | expect |
|---|---|---|
| berlin-gap-typed | `2027-03-28T02:30` Europe/Berlin, typed | `LOCAL_TIME_NONEXISTENT` |
| berlin-gap-edges | 01:59 / 03:00 | `00:59Z +01:00` / `01:00Z +02:00` |
| berlin-gap-machine | toLocal `2027-03-28T01:30Z` | `03:30 +02:00`, not refused |
| berlin-fold | `2027-10-31T02:30` default / `fold:later` | `00:30Z +02:00 ambiguous` / `01:30Z +01:00` |
| ny-gap / ny-fold | `2027-03-14T02:30` / `2027-11-07T01:30` America/New_York | refused / `05:30Z −04:00`, later `06:30Z −05:00` |
| sydney-gap / sydney-fold | `2027-10-03T02:30` / `2027-04-04T02:30` Australia/Sydney | refused / `2027-04-03T15:30Z +11:00`, later `16:30Z +10:00` |
| lordhowe-gap / fold | `2027-10-03T02:15` / `2027-04-04T01:45` Australia/Lord_Howe | refused / `14:45Z +11:00`, later `15:15Z +10:30` |
| tokyo-fra | dep `2027-06-01T10:00` Asia/Tokyo, arr `15:00` Europe/Berlin | `01:00Z`, `13:00Z`, 720 min |
| tokyo-hnl | dep `2027-06-01T21:00` Tokyo, arr `2027-06-01T09:00` Pacific/Honolulu | arrival locally "before" departure, +420 min |
| samoa-2011 | toLocal `2011-12-30T09:00Z` / `10:00Z` Pacific/Apia; typed `2011-12-30T12:00` | `2011-12-29T23:00 −10:00` / `2011-12-31T00:00 +14:00`; nonexistent |
| kolkata / kathmandu | `2027-01-15T00:15` Asia/Kolkata; `05:44` Asia/Kathmandu | `2027-01-14T18:45Z +05:30`; `23:59Z +05:45` |
| moscow-2011/2014 | `2012-07-01T12:00Z`; `2015-07-01T12:00Z`; typed `2014-10-26T01:30`; `2011-10-30T02:30` | `+04:00`; `+03:00`; ambiguous `21:30Z` / later `22:30Z`; not ambiguous |
| istanbul-2016 | `2016-11-15T12:00Z`; `2015-11-15T12:00Z` | `15:00 +03:00`; `14:00 +02:00` |
| night-train | dep `2027-07-10T22:40`, arr `2027-07-11T08:10` Europe/Paris | local days 07-10 / 07-11, 570 min |
| red-eye-nye | dep `2026-12-31T22:30` America/New_York | `2027-01-01T03:30Z`; localDay/stats year 2026 |
| stay-utc-inversion | checkIn DATE `2027-05-02`, checkOut `2027-05-02T10:00` Pacific/Kiritimati | check-out instant `2027-05-01T20:00Z` precedes the check-in day's UTC anchor; nights 0 (day use); ordering by local day |
| today-edges | now `2027-01-01T10:59Z`/`11:00Z` Kiritimati; `03:29Z`/`03:31Z` St_Johns; `22:59Z`/`23:01Z` Berlin | `2027-01-01`/`01-02`; `2026-12-31`/`2027-01-01`; `2027-01-01`/`01-02` |
| unknown-zone | toLocal with `Mars/Olympus` | server `ZONE_UNKNOWN`; client returns payload `local`/`offset` unchanged |
| precision-day | TimeValue with precision `day` | display shows date only |

**Done when:** vectors green in both trees under all three TZ values; both suppression baselines committed;
the odd-zone jobs required and green against their baseline; `/version` reports `tzdata`; all 12 cron jobs
have an explicit zone; the `@db.Date` probe green; no schema change.

## Phase 2 + 3a — write paths and additive columns — L

**Agent A (backend: `schema.prisma`, migrations, schemas, routes, OpenAPI)**
1. Migration `time_model_columns` (`prisma migrate dev --create-only`, reviewed, applied), DDL only, all
   nullable: Flight `dep_timezone`, `arr_timezone`, `dep_precision`, `arr_precision`; PlaceVisit
   `visited_at_utc`, `visited_zone`, `visited_precision`, `written_via` + index `(user_id, visited_at_utc)`;
   CruiseStop `arrival_utc`, `departure_utc`, `stop_zone`, `stop_date DATE`, `time_precision`; TripStop
   `start_utc`, `end_utc`, `stop_zone`, `precision`; LodgingStay `check_in_date DATE`, `check_out_date DATE`,
   `check_in_at`, `check_out_at`, `stay_zone`; Cruise `start_day DATE`, `end_day DATE`, `start_zone`,
   `end_zone`; Trip `start_day DATE`, `end_day DATE` (open point 1); TripJournalEntry `day DATE`; User
   `birth_day DATE`, `birth_precision`; RailJourney `dep_precision`, `arr_precision`; table
   `time_migration_ledger (id, table_name, row_id, column_name, legacy_value text, new_value text, zone,
   rule, status open|resolved, created_at)`. `CountryDay`: schema comment only (Q3). Rollback: `rollback.sql`
   dropping the new columns/table + `prisma migrate resolve --rolled-back`; lossless (no legacy column
   touched).
2. Schemas: delete the `new Date(v)` preprocessors (`schemas/cruise.ts:46`, `lodging.ts:45`, `place.ts:9`);
   use `localTimeInput`/`localDateInput` from `wire.ts` (date = `YYYY-MM-DD`, time = `{local,
   zone?|placeRef?, fold?}`); offset-less datetime strings refused 422 `TIME_SHAPE_REQUIRED`; offset-bearing
   ISO accepted as a machine instant while legacy clients exist. For formerly fake-UTC fields (`visitedAt`,
   cruise stop times, trip stop dates): a cookie-authenticated bare ISO-Z (stale web bundle) → refused
   `TIME_SHAPE_REQUIRED`; a PAT-authenticated one (Companion) → accepted as a real instant. Every visit write
   records `written_via` (`web|companion|import|suggestion|api`).
3. Routes dual-write through `toInstant` (legacy column old meaning + new columns instant/zone/precision):
   flights store dep/arr zone and re-derive only when the airport changed (class 4), code in
   `routes/flights/timeInput.ts`; rail uses `zoneOf` (station catalogue first); lodging `lodging/stays.ts`;
   places (visit create/update, `visitDateSuggestions`, curated tick); cruise stops (port zone); trip stops
   (coordinates or wrapped entity) in `routes/trips/stopTime.ts`; journal; parsers convert at the boundary;
   `statusSweepScheduler` and status derivation use `todayIn(profileZoneOf(user))`.
4. Errors (`middleware/errorHandler.ts`): `TZ_UNRESOLVED`, `LOCAL_TIME_NONEXISTENT` (general),
   `TIME_SHAPE_REQUIRED`, `ZONE_UNKNOWN` (422), existing 503.
5. OpenAPI: components `LocalTimeInput`, `LocalDateInput`, `TimeError` (`paths/shared.ts`); request bodies in
   flights, rail, lodging, places, cruises, roadtrips, trips; ratchets gain no entries.

**Agent B (web)**: forms send `{local, zone}` or `placeRef` (flight form — `useFlightForm.ts` frozen at 894,
extract a helper — rail, stay editor, `PlaceDetailPage` visits, cruise stops, trip stops, journal); remove
the 13 web `?? "UTC"`/profile fallbacks for places (a picked airport/station/port/place brings its zone —
class 2); map new codes in `lib/saveErrorMessage.ts` to DE/EN; tests drive failure paths and assert what the
user sees (`TZ_UNRESOLVED`, gap, stale-shape refusal).

**Tests:** per domain a gap refusal, fold default vs `fold:"later"`, `TZ_UNRESOLVED` (no silent UTC), PAT ISO-Z
accepted vs cookie ISO-Z refused, dual-write values; an edit without airport change keeps the stored zone.

**Done when:** no `new Date(v)` on input in `schemas/`; every write in the six domains through `toInstant`; no
route falls back to UTC for a place; drift and size green; suppression baselines shrunk or equal; RC smoke
creates one entity per domain with the new columns filled.

## Phase 3b — backfill and migration report — L

**Agent A:** `services/timeMigration/` (one module per table + `runner.ts`), registered in
`services/jobs/jobRegistry.ts`, runs once at boot behind `AdminSettings.time_model_backfill_at` (small
additive migration `time_model_backfill_marker`), idempotent, writes only new columns + ledger.

Rules:
- **Flights:** zone = catalogue by IATA → ICAO → `zoneAt(depLat, depLon)` (`0,0` = no position, reported).
  `UTC`/`UNKNOWN` rows keep the instant, precision `minute`; `LEGACY_FAKE_UTC` →
  `toInstant(storedComponents, zone, origin: machine)`, recorded in the ledger (legacy column untouched until
  Phase 6); `DATE_ONLY` → precision `day`, report rows whose `localDay` differs from the UTC day.
- **PlaceVisit (Q4):** zone from the place (coordinates required). Provenance in order: (1) `written_via`;
  (2) created before the user's first Companion device token (`ApiToken.device_id` not null) or before
  2026-08-29 (first Companion commit writing visits) → web/import → fake UTC → convert via place zone;
  (3) non-zero seconds/milliseconds → Companion `toISOString()` → real instant (web always writes
  `:00.000Z`); (4) optional `http.log` correlation (`POST …/visits`, UA + PAT, ±2 s) where logs exist;
  (5) otherwise `visited_precision = unknown` — date = `localDay` if the value reads as the place's local
  midnight exactly, else its UTC date; reported.
- **CruiseStop:** zone `Port.timezone ?? zoneAt(port)`; sea days and unresolved ports → `stop_date` without
  zone, precision `unknown`, reported; times kept in the ledger; when the user resolves the port the write
  path converts from the ledger value.
- **TripStop:** zone from coordinates or wrapped entity; else reported + `unknown`.
- **Day columns** (lodging, cruise, trip, journal, birthdate): `00:00Z` → that date; non-midnight (written by a
  non-UTC host): hours 12–23 → next day, 0–09 → same day; 10–11 ambiguous (+13/+14 vs −10/−11 hosts) → keep
  UTC date, report; no guessing. Lodging `check_in_at = toInstant(date + checkInTime, stayZone)`; no
  coordinates → null + report.
- **Report:** ledger rows `open`; one `DataQualityFlag` per affected row (`time_zone_unresolved` /
  `time_precision_unknown`; add entity types flight, cruise_stop, trip_stop, place_visit to the Zod vocabulary
  in `schemas/dataQualityFlag.ts`, no migration) — the user fixes each from the inbox; info-level summary;
  `GET /api/v1/admin/time-migration/report` (counts per table/rule/reason, OpenAPI + schema).
- **Admin re-resolution (D2):** `POST /admin/time-zones/re-resolve?dryRun=true` (rows whose zone would change
  + offset delta), `…/apply` requires the dry-run id; job + poll; same engine; admin-only.

**Agent B:** admin report + re-resolution screen (DE/EN), inbox copy for the two flag kinds.

**Rollback:** `pg_dump` before RC deploy; undo = `UPDATE … SET <new cols> = NULL` (ledger kept); code
rollback to Phase 2 lossless.

**Done when:** backfill run on the RC server against the prod mirror; report read and signed off by the
owner before promotion (every unresolved row listed, none guessed); a second run changes nothing; ledger
holds every converted value; vectors cover every rule used.

## Phase 4 — read shape — L

**Agent A:** additive `times` object per entity (flights, rail, stays, visits, cruises + stops, trips, trip
stops, journal), e.g. `times: {departure: TimeValue, arrival: TimeValue}`, `times: {checkIn: LocalDateValue,
checkInAt: TimeValue|null}`, built by `serializeTime()` in per-domain `*/timesDto.ts` (not in frozen route
files; families unchanged). Stats/timeseries/achievements read days via `localDay` from the STORED zone (a
catalogue correction no longer moves history). OpenAPI `TimeValue`/`LocalDateValue` on every documented time
field; guard `__tests__/openapi.timeShape.ratchet.test.ts` + `openapi.timeShape.baseline.json` (every
`date-time`/`date` field in a documented response is in the shape or baselined; stale entries fail).

**Agent B:** web renders `times.*.local` as is, `utc` only to sort/measure; optional "your time: …" hint (Q2);
`lib/tripTimeline.ts`, `lodgingDateDisplay.ts`, `railTime.ts`, `dateUtils.ts`, `timezones.ts` move onto
`shared/time` and lose their zone logic. Both drive their lint suppressions to zero.

**Done when:** both `eslint-suppressions.json` empty and deleted; odd-zone failure baseline empty;
time-shape baseline holds only endpoints the Companion still needs in legacy form (none new); a browser pass
under a Kiritimati system clock shows place-local times everywhere.

## Phase 5 — Companion (companion#24): server contract only

Write input `{local, zone|placeRef, fold?}` (offset-bearing ISO still accepted from PAT clients as a machine
instant); `times` objects `{utc, zone, offset, local, precision}`; `ambiguous: true`; codes `TZ_UNRESOLVED`,
`LOCAL_TIME_NONEXISTENT`, `TIME_SHAPE_REQUIRED`, `ZONE_UNKNOWN`, `TIMEZONE_LOOKUP_UNAVAILABLE`;
`/version.tzdata`; profile zone read/written through `UserSettings` `display.timezone` with a `followDevice`
flag (Q1 opt-in); `written_via=companion` from the PAT; `shared/time/vectors.json` with a `version` header the
Companion CI checks.

### Contract summary for companion#24 (as built by the end of phase 4)

**Read.** Every entity carries a `times` object beside its legacy fields (flights, rail, stays, visits,
cruises and their stops, trips, trip stops, journal entries, roadtrip stations). An instant is a `TimeValue`
`{utc, zone, offset, local, precision, zoneSource}`: display `local` as is, use `utc` only to sort and measure,
`offset` builds RFC 3339 without a zone library. `zone: null` means no zone is known — `local` is
then the UTC reading and must be labelled as UTC. `zoneSource: "catalogue"` marks an old flight read in
today's airport zone. A day is a `LocalDateValue` `{date, zone, precision}`; precision `unknown` keeps the
day and drops the time of day. A missing value is `null`, never a placeholder.

**Write.** A typed time is `{local: "YYYY-MM-DDTHH:mm[:ss]", zone}` or `{local, placeRef: {kind: airport |
railStation | port | place, id}}` — exactly one, except where the entity names its place (visit, port call,
trip stop): there both may be omitted. `fold: "later"` picks the second occurrence of a repeated autumn hour
(default earlier). A day is `YYYY-MM-DD`. A PAT client may still send an offset-bearing ISO string (a machine
instant) and, for cruise stops only, the parser's offset-less wall clock; everything else offset-less is refused.

**Errors** (422 unless noted, body `{error, code, field?}`): `LOCAL_TIME_NONEXISTENT`, `TZ_UNRESOLVED`,
`ZONE_UNKNOWN`, `TIME_SHAPE_REQUIRED`, `VALIDATION_FAILED`; `TIMEZONE_LOOKUP_UNAVAILABLE` is 503 — retry,
never read it as "no zone".

**Conformance.** `GET /api/v1/version` returns `tzdata`; `shared/time/vectors.json` is `version: 2` with
`minTzdata`, and the Companion's CI runs it and pins the version.

## Phase 6 — removal (after companion#24 ships) — M, one agent

1. Migration `time_model_drop_legacy` (precondition: `pg_dump` + restore rehearsed on the RC server): drop the
   fake-UTC and day-anchor legacy columns (`visited_at`, cruise stop `arrival_time`/`departure_time`/`date`,
   trip stop `start_date`/`end_date`, lodging `check_in`/`check_out`/`check_in_time`/`check_out_time`,
   cruise/trip/journal/birthdate DateTime columns, flight `*_time_semantics`); Prisma names re-pointed with
   `@map`; ledger kept; rollback = documented restore — the only irreversible step.
2. Delete `utils/stayInstant.ts`, the conversion half of `utils/timezone.ts`, `shared/zonedWallClock.ts` (both
   trees), `shared/wallClockExistence.ts`, `localWallClockOf`, `legacyFakeUtcToRealUtc`, `airportCalendarDay`,
   `stationDayKey`.
3. Remove legacy response fields; OpenAPI; time-shape baseline to zero; CHANGELOG via `/deploy`.

**Done when:** grep for deleted helpers empty; drift green; the Companion's current release reads only `times`.

## Sequencing risks

- `@db.Date` returns UTC midnight; adapter-pg DATE parsing unverified → Phase 1 probe; `localDate.ts` only at
  the data layer; filter with `toDbDate()` values.
- Stale web bundle sends fake ISO-Z between deploy and reload → refused with `TIME_SHAPE_REQUIRED` + reload
  hint, never misread.
- Rows need a zone before conversion → Phase 3b only after `refreshAirportTimezonesOnStartup` ran on the target.
- Merge conflicts with in-flight branches (rail parser, trip suggestions touch `routes/rail`, `trips`,
  `types/rail.ts`) → merge, never rebase.
- tzdata mismatch Node ICU vs Companion Hermes → visible via `/version.tzdata`; vectors pin historical cases.

## Agent split (≤2 in parallel, no shared files)

| Phase | Agent A | Agent B | Serial points |
|---|---|---|---|
| 1 (M) | backend `shared/time`, vectors, cron, `/version`, probes | web mirror, ESLint ratchet, `ci.yml`, tz-ratchet script | B's vector runner after A's vectors commit |
| 2+3a (L) | `schema.prisma`, migration, schemas, routes, OpenAPI, errorHandler | forms, save-error i18n | A publishes `wire.ts` + OpenAPI first |
| 3b (L) | backfill, ledger, report API, re-resolve job | admin report UI, inbox copy | RC sign-off by the owner |
| 4 (L) | `timesDto`, stats readers, time-shape guard, backend lint to zero | web consumers, web lint to zero | none |
| 6 (M) | alone | — | waits for companion#24 |

## Owner decisions on the plan's open points (2026-09-26)

1. **Trip start/end days are local days of the first departure / last arrival** (zoned), not floating —
   consistent with statistics and the cross-domain trip suggestions. `Trip.start_day/end_day` carry
   `start_zone/end_zone`.
2. **Backup job zone = admin setting**, defaulting to the host `TZ` used so far, so existing instances keep
   their backup hour.
3. **Users without a profile zone are asked on their next login** (proposal from browser/device, confirmed
   once); until then "today" uses UTC with a visible hint.

Release sequencing (owner, same day): an interim **beta.15** ships first with the day's fixes, the rail
parser, trip suggestions and stats/achievements coverage — without the time model; the time model follows
as **beta.16**. Phases 1–4 are in 2.7; phase 6 waits for companion#24.
