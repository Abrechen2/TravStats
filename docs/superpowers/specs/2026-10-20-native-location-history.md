# Native location history — everything Dawarich does, and more, inside TravStats

Status: **direction set by the owner, details open** (2026-10-20). Branch
`dev/location-history`.

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
  The Companion side (companion#73) has no code yet.

## 2. Dawarich feature map (v1.16, commit 2dc26c4) → TravStats

| Dawarich | TravStats internal | TravStats with Dawarich source | Phase |
|---|---|---|---|
| Points store, dedup on user+time+position | `location_points` (§3.1) | Dawarich holds them; pulled on demand | P1 |
| Own apps, OwnTracks, Overland, Traccar, Home Assistant ingest | Companion + OwnTracks/Overland HTTP ingest; HA via OwnTracks format | Dawarich's own | P1 / P4 |
| Imports: Google Takeout (Records, Semantic, phone Timeline), GPX, KML, GeoJSON, CSV, FIT, TCX, Polarsteps, photo geodata | all of these, as resumable jobs | Dawarich's own | P1 (Google, GPX/FIT/TCX, Dawarich) / P4 (rest) |
| Visits (100 m / 5 min / 3 pts, suggested → confirmed) | stay detector on the store → inbox → Place + PlaceVisit (exists for Dawarich, forgejo#294) | as today | P2 |
| User-drawn areas | Places with a radius / polygon (Places exist) | same | P3 |
| Tracks + transport-mode detection | segments by speed/mode, matched against logged flights, rail, bus, ferry, rental, roadtrip | same, on pulled points | P4 |
| Trips (time range, distance, countries, photos) | away-from-home periods → trip suggestions; existing trips get a recording layer and a day timeline | same | P3 / P4 |
| Stats per month (distance, countries, cities) | year-in-review and stats: km on the ground by mode, new cities, countries | same | P3 |
| Days in country | `country_days` (exists), second source `internal` | as today | P2 |
| Fog of war / heatmap (H3) | dashboard mode „Erkundet" (H3 or tile aggregation, never raw dots at world zoom) | same | P3 |
| Live map (own position) | „Zuletzt gesehen" on the dashboard (own only) | Dawarich's last point | P3 |
| Anomaly filter (teleports, frozen fixes) | `flags` on the point, filtered in every derivation | same filter on pulled points | P1 |
| Exports (GeoJSON, GPX, full archive) | GeoJSON/GPX by range; part of the TravStats backup | Dawarich's own | P1 |
| Family location sharing, Poster/Video studio, MCP | **not copied** — not logbook features; revisit on request | — | — |

**What TravStats adds that Dawarich cannot**: positions confirm the logbook —
a flight is confirmed „flown" with actual times, a stay fills lodging nights, a
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
  still „unconfirmed", never proof alone (forgejo#299).
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
- **Flights** — points at the departure airport + airborne speed or a gap
  matching the block time → confirms „flown" and actual times.
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
(owner principle), with delete-by-range, export and backup. Privacy zones
(home, work): points inside are kept but never drawn and never shown to others.

## 4. Phases
- **P1** `location_points` + `POST /location/points` + forgejo#316 folded in +
  Settings → Standortverlauf (source switch, point count, delete, export) +
  Dawarich full import + Google Timeline / GPX imports + anomaly flags.
- **P2** `LocationSource` interface; country days and stays on it (internal
  and Dawarich side by side).
- **P3** views: trip day timeline, „Erkundet", „Zuletzt gesehen", year in
  review, areas.
- **P4** journey and trip suggestions from segments, flight confirmation,
  cities; OwnTracks/Overland ingest; remaining file formats.

Companion work runs in parallel from P1 (§5).

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

## 6. Explicitly NOT copied
Family live-location sharing, a live map of others, Poster/Video studio, MCP.

## 7. Still open for the owner
1. With Dawarich as source: does the Companion send to TravStats (positions are
   never lost, recommended) or to Dawarich?
2. Default of the „Alltag" mode for new users: off (recommended) or on?
3. Reverse geocoding for cities: which provider and daily budget?
