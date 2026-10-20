# Native location history — what Dawarich does, integrated into TravStats

Status: **proposal, for the owner** (2026-10-20). Branch `dev/location-history`, low priority.

Owner wish (2026-10-20): TravStats should do essentially what Dawarich does, but integrated
sensibly into TravStats. Standing principle (same day): the server is the record, the
Companion is only a companion.

## 1. Where we stand (measured on main, 2026-10-20)

TravStats has **no point store of its own**. It pulls from Dawarich (read-only client
pinned to 1.9.2, `GET /api/v1/points`, ≤ 50 × 1000 per call) and condenses on the spot:

- `country_days` — daily sweep, flight air-time and speed filtered, shown as
  "unconfirmed" in the passport, never proof (forgejo#299).
- `DawarichStay` findings — 6-hourly scan, 150 m / 20 min / 30 min gap, look-back ≤ 30 days,
  into the inbox, accepting creates a Place + PlaceVisit (forgejo#294); market/venue
  findings from cached OSM areas.
- On-demand track pulls for a tour or a cruise; Companion flight recordings; GPX/TCX/FIT
  archives; Strava.
- The raw points of every sweep and scan are thrown away. No ingest API (OwnTracks,
  Overland …), no Google Timeline import (only saved Maps lists), no raw-point map.
- New, in progress: forgejo#316 / companion#73 — the Companion's trip recording uploaded
  per trip as raw-point batches.

## 2. What Dawarich is (v1.16, commit 2dc26c4)

A personal location-history server: a PostGIS `points` table (dedup on
`user, timestamp, lonlat`), ingest from its own apps, OwnTracks, Overland, Traccar,
Home Assistant, file imports (Google Takeout Records / Semantic / phone Timeline, GPX, KML,
GeoJSON, CSV, FIT, TCX, Polarsteps, photo geodata), and derived layers: visits (100 m /
5 min / 3 points, suggested → confirmed), user-drawn areas, tracks with transport-mode
detection, trips (a time range with distance, countries, photos), stats per month
(distance, countries by point-in-polygon, cities after 60 min, flights excluded),
days-in-country, fog of war / heatmap on H3, family location sharing, live map, exports
(GeoJSON, GPX, full archive), anomaly filter (teleports, frozen fixes).

## 3. The idea in one sentence

**TravStats keeps every position as a first-class record, but positions are evidence for
the logbook, not a second app**: they confirm and complete trips, stays, journeys and
countries, and are shown where those live — on the trip, the day, the passport and the
dashboard — not on a separate "Dawarich" screen.

## 4. Proposal

### 4.1 One point store
`location_points`: `user_id`, `t` (instant), `lat`, `lon`, `accuracy_m`, `altitude_m`,
`speed_mps`, `course`, `source` (companion | owntracks | overland | gpx | google_timeline |
dawarich_import | …), `device_id`, `import_id`, `flags` (anomaly, in_flight), unique on
`(user_id, t, lat, lon)` rounded to 1e-6°, index `(user_id, t)`. Plain columns, no PostGIS
needed for v1 (the extension is only created today); a monthly partition is a later
optimisation (1 point/min is ~0.5 M rows per user-year — fine for Postgres).
forgejo#316's per-trip batches become the Companion's ingest path INTO this store, so there
is one place where positions live.

### 4.2 Ingest
1. Companion (companion#73) — already planned, extended from "during a trip" to the
   optional "always" mode the ADR foresaw (`Automatische Vorschläge`).
2. **One-time import from Dawarich** (full history, paginated, resumable job) — the
   migration path for the owner's existing years; the live Dawarich connector stays as an
   optional source.
3. File imports: Google Timeline (on-device export JSON, Records.json, Semantic history),
   GPX/KML/GeoJSON/FIT/TCX (the track-archive readers exist), Dawarich/OwnTracks exports.
4. Optional third-party HTTP ingest (OwnTracks, Overland) for users without the Companion —
   per-user token, same validation.

### 4.3 Derivations — all as suggestions with provenance (existing rule)
Re-point the existing derivations from "Dawarich, live" to "the store":
- **Country days** — `countryDays/reduce.ts` unchanged, reading the store; still
  "unconfirmed", never proof alone (forgejo#299).
- **Stays → place visits / lodging nights** — the forgejo#294 detector on the store; no
  30-day look-back limit any more; suppression and coverage as today.
- **Trips** — away-from-home periods (home periods exist) → trip suggestions in the
  existing trip-suggestion flow; existing trips get "days without records" filled.
- **Journeys** — segments by speed/mode (Dawarich's heuristics as reference) matched
  against logged flights, rail, bus, ferry, rental, roadtrip; a confirmed match fills
  actual times or the driven line, an unmatched segment becomes a "missing journey?"
  question. Flights: points at an airport + airborne speed confirm "flown" and actual times.
- **Cities** (later): reverse-geocoded stays ≥ 60 min, through the instance geocoder budget.

### 4.4 Where it shows
- Trip page: recording layer + day timeline ("Tagesablauf": stays, moves, gaps) —
  forgejo#316 starts this.
- Dashboard: a "Erkundet" / heatmap mode of raw points (H3 or tile-aggregated), never
  raw dots at world zoom.
- Passport: unconfirmed countries from the store (as today, other source).
- Year in review: km on the ground by mode, new cities.
- Settings → Standortverlauf: sources, imports, last ingest, point count, delete by range.

### 4.5 Privacy and retention
Per user, never shared, never federated, never in a public link (as forgejo#316). Kept
until the user deletes (owner principle), with delete-by-range, export (GeoJSON/GPX) and
backup. Optional privacy zones around home: points inside are kept but never drawn and
never shown to others.

### 4.6 Explicitly NOT copied
Family live-location sharing, a live map of others, Poster/Video studio, MCP — not
logbook features; revisit only on request.

## 5. Phases
- **P0** owner decisions (§6).
- **P1** point store + Companion ingest (absorbs forgejo#316 batches) + Dawarich full import
  + GPX/Google Timeline import + Settings → Standortverlauf.
- **P2** derivations re-pointed to the store (country days, stays) — Dawarich becomes one
  source among others.
- **P3** views: trip day timeline, dashboard explored-area mode.
- **P4** journey/trip suggestions from segments; flight confirmation.
- **P5** optional OwnTracks/Overland ingest, cities.

## 6. Open owner decisions
1. Third-party ingest (OwnTracks/Overland) wanted, or Companion + imports only?
2. Companion "always" recording outside trips (ADR 0013 future mode) — yes/no, default off?
3. Fold forgejo#316's batch table into the point store now (recommended before it ships) or
   migrate later?
4. Dawarich after the full import: keep as a live source, or retire it?
5. Reverse geocoding for cities: which provider and daily budget?
