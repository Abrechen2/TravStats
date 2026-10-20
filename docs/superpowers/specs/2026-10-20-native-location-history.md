# Native location history — everything Dawarich does, and more, inside TravStats

Status: **direction set by the owner, details open** (2026-10-20). Branch
`dev/location-history`. **The plan for the whole feature — server and
Companion.** The Companion repository gets one ADR that points here and
replaces ADR 0013 points 3, 4 and 7; the work itself is planned in this file.

## 0. Owner direction (2026-10-20)

Verbatim: „Im Grunde soll das so nützlich wie möglich sein. Es soll am Ende eine
zusätzliche Option sein, also internes Location-Tracking oder mit Dawarich. Ich
möchte also die Dawarich-Funktionen + mehr komplett in TravStats haben, um Orte
und so festzuhalten, bei Reisen dann genaues Tracking und so weiter."

Read as decisions:

1. **Two interchangeable sources, chosen per user**: *internal* (TravStats stores
   the positions itself) or *Dawarich* (as today). Every feature built on
   positions works with either; nothing is internal-only by design except what
   Dawarich structurally cannot deliver (§3.3).
2. **Feature parity with Dawarich, then more** — the „more" is the logbook: every
   position is evidence for trips, stays, journeys and countries (§2).
3. **Everyday recording** to capture places, not only during trips — this goes
   beyond ADR 0013 (Companion) and needs its own ADR there (§5).
4. **Precise tracking during trips** — a track, not ADR 0013's coarse
   ~500 m / 5 min (§5).
5. **Everything settable, as in Dawarich** — recording rates on the phone and
   detection thresholds on the server have defaults, presets and „Eigene"
   values (§5).

Standing principle (same day): the server is the record, the Companion is only a
companion. A position the phone records reaches the server; the phone keeps a
cache.

## 1. Where we stand (measured on main, 2026-10-20)

TravStats has **no point store of its own**. It pulls from Dawarich (read-only
client pinned to 1.9.2, `GET /api/v1/points`, ≤ 50 × 1000 per call) and condenses
on the spot:

- `country_days` — daily sweep, flight air-time and speed filtered, shown as
  "unconfirmed" in the passport, never proof (forgejo#299). The table already
  carries `source` in its unique key (`countryDays/countryDaySource.ts`), so a
  second pipeline can disagree with Dawarich instead of overwriting it.
- `DawarichStay` findings — 6-hourly scan, 150 m / 20 min / 30 min gap,
  look-back ≤ 30 days, into the inbox; accepting creates a Place + PlaceVisit
  (forgejo#294); market/venue findings from cached OSM areas.
- On-demand track pulls for a tour or a cruise; Companion flight recordings
  (`flight_tracks`, ADR 0010); GPX/TCX/FIT archives; Strava.
- The raw points of every sweep and scan are thrown away. No ingest API, no
  Google Timeline import (only saved Maps lists), no raw-point map.
- In progress, **not merged**: `feat/trip-recording-316` (forgejo#316) stores the
  Companion's trip recording as one JSON blob per upload in `TripRecordingBatch`,
  bound to a trip, dropping points outside the trip's days and inside flights.
  On the Companion, the **device-only trip recorder of ADR 0013 is built and
  running** (`app/src/lib/trip-track/`: `syncTripRecorder`,
  `handleTripLocations`, per-trip AsyncStorage in `store.ts`, deleted 30 days
  after the trip). Only its upload (companion#73) is missing. This plan
  therefore migrates working behaviour; it does not start from nothing.

## 2. Dawarich feature map (v1.16, commit 2dc26c4) → TravStats

| Dawarich | TravStats internal | TravStats with Dawarich source | Phase |
|---|---|---|---|
| Points store, dedup on user+time+position | `location_points` (§3.1) | Dawarich holds them; pulled on demand | P1 |
| Own apps, OwnTracks, Overland, Traccar, Home Assistant ingest | Companion + OwnTracks/Overland HTTP ingest; HA via OwnTracks format | Dawarich's own | P1 / P4 |
| Imports: Google Takeout (Records, Semantic, phone Timeline), GPX, KML, GeoJSON, CSV, FIT, TCX, Polarsteps, photo geodata | all of these, as resumable jobs | Dawarich's own | P1 (Dawarich, GPX) / P4 (rest) |
| Visits (100 m / 5 min / 3 pts, suggested → confirmed) | stay detector on the store → inbox → Place + PlaceVisit (exists for Dawarich, forgejo#294) | as today | P2 |
| User-drawn areas | Places with a radius / polygon (Places exist) | same | P3 |
| Tracks + transport-mode detection | segments by speed/mode, matched against logged flights, rail, bus, ferry, rental, roadtrip | same, on pulled points | P4 |
| Trips (time range, distance, countries, photos) | away-from-home periods → trip suggestions; existing trips get a recording layer and a day timeline | same | P3 / P4 |
| Stats per month (distance, countries, cities) | year-in-review and stats: km on the ground, countries (P3); by mode and new cities once P4 derives them | same | P3 / P4 |
| Days in country | `country_days` (exists), second source `internal` | as today | P2 |
| Fog of war / heatmap (H3) | dashboard mode „Erkundet" (H3 or tile aggregation, never raw dots at world zoom) | same | P3 |
| Live map (own position) | „Zuletzt gesehen" on the dashboard (own only) | Dawarich's last point | P3 |
| Anomaly filter (teleports, frozen fixes) | `flags` on the point, filtered in every derivation | same filter on pulled points | P1 |
| Exports (GeoJSON, GPX, full archive) | GeoJSON/GPX by range; part of the TravStats backup | Dawarich's own | P1 |
| Family location sharing, Poster/Video studio, MCP | **not copied** — not logbook features; revisit on request | — | — |

**What TravStats adds that Dawarich cannot**: positions confirm the logbook —
a flight gets evidence for review, a stay can fill lodging nights, a
roadtrip gets its driven line, a missing journey becomes a question, a passport
country gets its evidence. The data stays on the trip, the day, the passport and
the dashboard, not on a separate „Standortverlauf" app screen.

## 3. Design

### 3.1 One point store
`location_points`: `user_id`, `t` (instant), `lat`, `lon`, `accuracy_m`,
`altitude_m`, `speed_mps`, `course`, `source` (companion | owntracks | overland |
gpx | google_timeline | dawarich_import | …), `device_id`, `import_id`,
`motion` (stationary | walking | running | cycling | automotive | unknown, as the
phone reports it), `flags` (anomaly, in_flight), unique on `(user_id, t, lat, lon)`
rounded to 1e-6°, index `(user_id, t)`. Plain columns; PostGIS is not needed for
v1. A precise trip at ~1 point / 10–30 s is ~3–8 k points per travel day; a
travelling user-year stays in the low millions — fine for Postgres with the
`(user_id, t)` index; monthly partitions are a later optimisation, not a v1 need.

**forgejo#316 folds into this store before it merges.** Its web work (trip map
layer, day filter, GPX, delete) is kept and reads `location_points` by the trip's
time range. Its server-side trip bounds go: what is recorded is decided on the
phone by the user's consent (§5); the server keeps what it receives and marks
in-flight points with a flag instead of dropping them. Flight recordings stay in
`flight_tracks` (ADR 0010).

### 3.2 Ingest
One API for every client, **not bound to a trip** — the server derives the trip
from the time:

`POST /api/v1/location/points` — `{ uploadId, source, deviceId?, points: [...] }`,
≤ 5000 points per call, idempotent on `uploadId` (a retry answers the stored
result) and on the point unique key. Answer: accepted / duplicate / rejected
counts. The Companion deletes a point from its cache only after this answer.

Further paths into the same store:
1. Companion — §5.
2. **Full import from Dawarich** (paginated, resumable job) — for switching a
   user from the Dawarich source to internal with their whole history.
3. File imports: Google Timeline (on-device export JSON, Records.json, Semantic
   history), GPX/KML/GeoJSON/FIT/TCX (the track-archive readers exist),
   Dawarich/OwnTracks exports, later Polarsteps and photo geodata.
4. OwnTracks / Overland HTTP endpoints with a per-user token, translating into
   the same call — for users without the Companion (and Home Assistant via the
   OwnTracks format).
5. **Apple Shortcuts without the Companion** — a downloadable Shortcut template
   that posts one point to `POST /location/points` with a per-user ingest key,
   checking the privacy zones (Wi-Fi name, distance) before it sends. The owner
   runs exactly this against Dawarich today (2026-10-20).

### 3.3 Source choice: internal or Dawarich
A per-user setting **„Standortquelle: Intern / Dawarich"** (Settings →
Standortverlauf). Every derivation reads positions through one interface,
`LocationSource.points(userId, from, to, filter)`, with two adapters:

- **internal** — reads `location_points`;
- **dawarich** — today's `dawarichClient` pull, unchanged behaviour.

`country_days.source` gets the value `internal`; the stay findings move from
`DawarichStay` to a source-neutral table (or gain a `source` column). Switching
from Dawarich to internal offers the full import (§3.2 point 2); switching back
leaves the stored points in place. With Dawarich chosen, the Companion can still
send to TravStats (positions are never lost) — but derivations read Dawarich.
Open: whether the Companion should instead send to Dawarich in that mode (§7).

What only internal can do: device id and motion per point, precise trip
recordings tied to the Companion's consent, „Zuletzt gesehen" without a second
server, and positions that are part of the TravStats backup.

### 3.4 Derivations — all as suggestions with provenance (existing rule)
- **Country days** — `countryDays/reduce.ts` unchanged, reading the source;
  still „unconfirmed", never proof alone (forgejo#299). **Confirming a country
  means confirming an entry, not the country** (owner, 2026-10-20: „was
  bestätige ich da, müsste ich nicht einen Ort angeben"). The inbox card
  proposes the place where the points cluster that day („Hakata-Hafen,
  Fukuoka, 2 h 45 min") and a matching unlogged journey if one fits; the
  answers are: save that place (the country becomes „Besucht" with the place
  as evidence), choose another place, „nur durchgereist" (counts as „Am Boden
  gewesen", evidenced by the points), or „nicht dort gewesen" (never proposed
  again for that day, points stay). There is no bare „Land bestätigen".
- **Stays → place visits / lodging nights** — the forgejo#294 detector on the
  source; no 30-day look-back any more; suppression and coverage as today.
- **Trips** — away-from-home periods (home periods exist) → trip suggestions;
  existing trips get a day timeline („Tagesablauf": stays, moves, gaps).
- **Journeys** — segments by speed and the phone's `motion`, matched against
  logged flights, rail, bus, ferry, rental, roadtrip; a confirmed match fills
  actual times or the driven line, an unmatched segment becomes a „Fehlt hier
  eine Verbindung?" question. Mode detection runs only on precise segments
  (trip recordings, imports with dense points); coarse everyday points yield
  stays and countries, not modes.
- **Flights** — points at the departure airport and at the destination around
  the block times are **evidence offered for review**, never an automatic
  „flown" (Codex review point 9); ADR 0010's flight recorder stays the only
  source of observed actual times.
- **Cities** — reverse-geocoded stays ≥ 60 min, through the instance geocoder
  budget.

### 3.5 Where it shows
- Trip page: recording layer + day timeline (forgejo#316 starts this).
- Dashboard: „Erkundet" heatmap mode; „Zuletzt gesehen".
- Passport: unconfirmed countries from either source.
- Year in review: km on the ground by mode, new cities, countries.
- Settings → Standortverlauf: source, Companion modes, imports, OwnTracks/Overland
  token, last ingest, point count, privacy zones, export, delete by range.

### 3.6 Privacy and retention
Per user, never shared, never federated, never in a public link, never in a
`.travstats` file or a comparison (as forgejo#316). Kept until the user deletes
(owner principle), with delete-by-range, export and backup.

**Privacy zones** (home, work, any place the user adds) have two modes:
„nicht aufzeichnen" — the point is dropped **on the device** and never leaves
it (owner, 2026-10-20: „daheim ist es aus und in der Arbeit auch
deaktiviert") — and „speichern, nie zeigen" — kept for countries and times,
never drawn, exported, suggested or sent to a geocoder. The Companion and the
Shortcut template apply the zones before sending; the server applies them
again on ingest for sources that cannot (OwnTracks, Overland, file imports).
A change to a zone is synced to the phone with the other location settings.

## 4. Phases — server and Companion together

This document is the plan for the whole feature, server and Companion alike
(owner, 2026-10-20: „nicht als Issue, sondern als Gesamtplan für das
Feature"). Work is tracked here and on the Leitstand, not as separate issues.
Order follows Codex's review (§8): the riskiest unknown, the phone, first.

| Phase | Server | Companion |
|---|---|---|
| **P0** proof | decide source routing and the open owner questions (§7) | spike: precise trip recording in the background on iOS and Android — survives kill, reboot, permission change; measured battery per hour |
| **P1** record and keep | `LocationSource` contract with a minimal internal adapter (the #316 map reads through it from day one), `location_points`, `POST /location/points` with receipts and idempotency, delete with tombstones, privacy zones, backup/restore, forgejo#316 folded in, Settings → Standortverlauf (Standard/Experte), Dawarich full import, GPX import | one recording coordinator replacing `syncTripRecorder` (trip / flight / pause precedence), a durable location queue replacing the per-trip AsyncStorage store (kept until acknowledged, existing recordings migrated), uploader on the flight-track upload pattern, „Reise genau" settings, privacy zones on the device, settings synced from the server |
| **P2** derive | Dawarich adapter for `LocationSource`, country days and stays on it, inbox cards that confirm an entry (§3.4), re-evaluation as a job | „Alltag" mode, the server's inbox in the app (retiring the local `useTripStayQuestions`), the native shared queue/keychain bridge, then the Shortcuts actions „Standort jetzt senden" and „Aufzeichnung pausieren / fortsetzen" |
| **P3** show | trip day timeline, „Erkundet", „Zuletzt gesehen", year in review (km and countries), areas; Shortcut template for users without the Companion | remaining Shortcuts actions (§5.1), recording state on the trip screen |
| **P4** connect | journey and trip suggestions, flight evidence for review, cities, km by mode and new cities in the stats, OwnTracks/Overland ingest, Google Timeline and further formats | Android shortcuts / broadcast intents, native visit monitoring if P0 shows it is needed |

## 5. Companion (needs an ADR in the Companion repo; supersedes ADR 0013 points 3, 4, 7)

Three recording modes under „Standort", each visible and pausable („Pause wins"
from ADR 0013 stays):

| Mode | When | Rate | Purpose |
|---|---|---|---|
| **Aus** | — | — | — |
| **Alltag** (new, default off) | always | coarse: significant changes + stationary geofence (~100 m exit wakes it), iOS visit monitoring where available | places, countries, „Zuletzt gesehen" |
| **Reise genau** | from the first to the last day of a trip (ADR 0013 bounds and „Jede laufende Reise aufzeichnen") | precise: continuous updates, ~25 m distance filter / 10–30 s, paused automatically while stationary | the track, day timeline, journeys |

**Everything in this table is settable** (owner, 2026-10-20: „Das muss
natürlich einstellbar sein, so wie in Dawarich"). The rates above are only the
defaults. Per mode the user can set accuracy (low / balanced / high), the
distance filter (m), the minimum time interval (s), whether to pause while
stationary, and for uploads the batch size, the interval and „nur im WLAN". A
preset row („Akku sparen / Ausgewogen / Genau") fills these; changing a value
switches it to „Eigene". The location screen shows the expected battery cost of
the current choice.

The server-side thresholds are settable in the same way, under Settings →
Standortverlauf, as Dawarich's are: the stay radius and minimum duration, the
gap that splits a track, the anomaly limits (maximum plausible speed, minimum
accuracy), the city dwell time and the heatmap / „Erkundet" cell size. Each has
a default and „zurücksetzen". A change re-runs the affected derivations as a
job; findings the user already confirmed or dismissed stay as they are.

Flights keep ADR 0010's recorder at full rate. Points are uploaded in batches
(on Wi-Fi or every N minutes, configurable), kept on the phone until the server
confirms them, then deleted from the phone — the 30-day device retention of
ADR 0013 point 4 becomes „until uploaded". Suggestions come from the server's
inbox; the app computes none of its own (ADR 0013 point 7). On unpair the cache
is wiped; the server keeps what it has.

Native note: iOS visit monitoring (`CLVisit`) is not exposed by `expo-location`;
P1 uses significant changes + geofences, a small native module later if needed.
App Review sees an always-on purpose — the mode is off by default, explained on
the location screen, with the iOS indicator; if Apple objects, „Alltag" goes
and „Reise genau" stays.

### 5.1 Shortcuts in the Companion (owner, 2026-10-20)
„Die Kurzbefehle müssen dann beim Companion auch geben." The Companion
exposes its location functions as Apple Shortcuts actions (App Intents), so a
user builds their own automations (time of day, arriving, Wi-Fi, CarPlay,
focus) without URLs or keys:

| Action | Does |
|---|---|
| Standort jetzt senden | one point, source `shortcut`, through the outbox, zones applied |
| Aufzeichnung pausieren / fortsetzen | optional duration; „Pause wins" as everywhere |
| Aufzeichnungsart setzen | Aus / Alltag / Reise genau |
| Ort jetzt speichern | today's „Ort jetzt" as an action, with an optional name |
| Bin ich in einer Privatzone? | returns yes/no for the user's own conditions |
| Laufende Reise | returns the current trip's name and day, or nothing |

Native constraint: an intent can run while the app is not running, so it must
work without the JS runtime — Swift (`AppIntents`, iOS 16+) in a local Expo
module beside `travstats-barcode`, reading the zones and the device token
from the App Group / Keychain and writing into the same outbox the recorder
uses. Android gets the same actions as App Shortcuts / broadcast intents
(Tasker, Home Assistant) later (P4).

### 5.2 Settings levels (forgejo#318)
Settings → Standortverlauf follows the Standard / Experte levels: source,
modes, preset, suggestions on/off, privacy zones, imports and export are
Standard; the detailed recording values, the detection thresholds, „Orte als
Fläche erkennen" (default on), the Dawarich full import and the
OwnTracks/Overland key are Experte. Search finds expert settings in either
view and switches to Experte. Prototype: claude.ai artifact
„Einstellungsstufen Prototyp".

## 6. Explicitly NOT copied
Family live-location sharing, a live map of others, Poster/Video studio, MCP.

## 7. Still open for the owner
1. With Dawarich as source: does the Companion send to TravStats (positions are
   never lost, recommended) or to Dawarich? („Alltag" defaults to off — settled.)
2. **Source routing** (Codex 1, both reviews): proposed — storage is always
   internal for what reaches TravStats; with „Dawarich" selected the
   derivations read Dawarich **plus** the internal points (deduplicated by
   time), so a Companion recording is never stranded.
3. **What „speichern, nie zeigen" may feed** (Codex 2): proposed — country days
   and home periods only; never place suggestions, maps, heatmap, „Zuletzt
   gesehen", exports or anything shareable; included in the user's own backup.
4. Reverse geocoding for cities: which provider and daily budget?

## 8. Cold review by Codex (2026-10-20) — to resolve before P1

Ranked by severity; each becomes a decision or a design paragraph above.

1. **Source switch can strand recordings** — with Dawarich chosen, Companion
   points are stored internally but never derived from. Separate *storage*,
   *origin* and *derivation source*, or derive from both.
2. **`LocationSource` needs a completeness contract** — cursor/streaming,
   ordering, coverage, truncation and upstream failure; the Dawarich client
   caps at 50 000 points per call and the stay window at 250 000.
3. **Dedup key conflates identity with coincidence** — give observations a
   stable id, keep origin/import membership; deleting one import must not
   remove another source's evidence.
4. **Upload idempotency** — persist `(user, uploadId, payloadHash, result)`
   atomically, reject a reused id with other content, per-point
   acknowledgement, retryable vs permanent errors.
5. **Deletion semantics** — tombstones so an offline phone or a re-import
   cannot resurrect deleted points; derived caches invalidated.
6. **Privacy zones** — „nicht speichern" vs „speichern, nie zeigen", and their
   effect on exports, heatmap, „Zuletzt gesehen", suggestions and geocoder
   calls; derived PlaceVisits can leak through ordinary sharing.
7. **Re-running derivations is a subsystem** — algorithm/config version,
   input revision, bounded windows, atomic replacement; user decisions stored
   apart from regenerated candidates.
8. **Raw points immutable, inferred flags versioned** — `in_flight` and
   anomaly depend on editable flights and thresholds.
9. **Never confirm a flight from a gap** — airport presence plus silence is
   evidence for review, not „flown" (the mockup already says so).
10. **Scale** — ~300 MB per heavy user-year before indexes; bounded reads,
    streamed exports, downsampled map tiles, resumable restore; #316's
    read-all-batches query must not survive.
11. **Phone** — Expo exposes no significant-change API and no `CLVisit`;
    `timeInterval` is Android-only; restart after kill/reboot and Android 12+/14+
    foreground-service rules are the hardest risk. Prototype the lifecycle and
    battery first, one recording coordinator, a durable outbox.
12. **Parity is overstated** — missing: raw-point search/management, import
    inspection and rollback, Immich/PhotoPrism geotag enrichment,
    Traccar/GPSLogger.

**Reordered phases (Codex):** prove phone lifecycle + battery and settle
source routing first; then point store, ingest receipts, deletion, streamed
backup/restore and the #316 map; then Dawarich migration + one simple file
importer; defer Semantic Timeline, mode inference, flight evidence, cities.

## 9. Integration — one position end to end (second Codex review, 2026-10-20)

Phone → server → logbook, with the seams in today's code:

1. **Record** — `TripTrackSync` → `syncTripRecorder` → `TRIP_TRACK_TASK` →
   `handleTripLocations` → `recordTripFixes` becomes one coordinator (Alltag /
   trip / flight / pause), applying zones and giving each fix a stable id.
   ADR 0010's flight recorder stays its own path. Tasks register in
   `app/index.ts`, before any screen.
2. **Keep** — `trip-track/store.ts` (per-trip JSON, swallowed write errors,
   expiry) gives way to a durable queue: nothing expires before the server
   acknowledges it; unpair guards stay.
3. **Send** — modelled on `uploadFlightTracksOnce` / `runTrackUploadTask`, not
   on the barcode `outbox.ts`; auth through the paired-device PAT
   (`claimDevice` → `setPat` → `authHeaders`).
4. **Ingest** — new route under `authenticate` + `requireWriteScope`, demo
   guard, rate and body limits; Zod; zones; tombstones; atomic receipt with
   payload hash; per-point outcome. Bare response shape (ADR 0001), OpenAPI
   path + response schema, ratchet baselines.
5. **Source** — a location-source resolver above `dawarichResolver.ts`;
   keep the distinction between `getDawarichConnection` (user → admin → ENV,
   interactive) and `buildUserDawarichConnection` (no fallback, unattended).
   „Dawarich configured" is not „Dawarich selected". Schedulers'
   `eligibleAccounts()` stop requiring Dawarich credentials.
6. **Derive** — `sweepUserCountryDays` (keep its incomplete-window and
   reducer-version guards; `COUNTRY_DAY_SOURCES` gains `internal`, sweep state
   becomes per source); `stays/scan.ts` `scanStays` with its whole input path
   incl. `collectMarketFindings`, without the 30-day limit; `stays/review.ts`
   `acceptStay` / `rejectStay` generalised beyond `DawarichStay` and
   `dataSource: "dawarich"`; `trackEvidence.unconfirmedTrackCountries` and
   `passportLoader` carry the row source; „nur durchgereist" is a stored review
   decision. `tripSuggestions/engine.ts` gets reviewed location inputs, its
   `dataStamp()` and `invalidateTripSuggestions()` follow them. Tour and cruise
   track pulls (`tour/tracks/*`, `routes/cruises/tracks.ts`) move onto the
   source too.
7. **Show** — web `InboxWorkspace` / `useInboxData` / `VisitSuggestionCard`,
   passport `UnconfirmedCountries`, #316's `TripMapWithTours` /
   `TripRecordingPanel`; new read APIs (bounded, downsampled) for timeline,
   heatmap, latest. Companion: `inbox-feed` / `server/api/inbox-sources`.
8. **Around it** — backup: `pg_dump` already carries new tables; restore
   tests and `restoreAftermath` must settle jobs and caches. Account export
   (`export/allDataExport.ts`) streams. Account deletion: cascading FKs, import
   files in `collectAccountFiles`. Sharing: points stay outside
   `SHARE_TYPES`, with regression tests for share, federation, public link,
   comparison. Migrations: points + indexes, origin/import membership,
   receipts, tombstones, jobs, zones, settings, versioned derivation and
   review state; existing stay/scan rows marked as Dawarich.

**Build order:** P0 phone spike + decisions (§7) → P1 contracts (identity,
completeness, receipts, tombstones), durable queue, ingest, restore tests →
one trip-map slice end to end → Dawarich import + GPX → P2 adapters and
server inbox → P3 views → P4 inference and the statistics that need it.
