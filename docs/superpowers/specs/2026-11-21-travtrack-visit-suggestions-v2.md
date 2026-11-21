# TravTrack stops become place-visit suggestions — V2 as built (forgejo#316 slice 2)

Builds on `2026-11-20-travtrack-visit-detection.md` (rules, council review;
that file lives on `docs/owner-ideas-2026-11-20`). V1 (building-first ranking)
is reused, not repeated: `stayIdentityView` + `STOP_SHAPE`.

## What it does

A day's derived stops (`deriveDay().whole`, the one derivation the day view
uses) are read per UTC day on their own dirty-day bit (`VISITS_BIT = 8`). A
stop that is not dismissed, not already named (accepted name, fixed place,
lodging, folded) and not inside a privacy zone becomes ONE finding in the stay
inbox (`dawarich_stays`, provider `travtrack`, `algorithmVersion` 1 — marked by
`evidence.visit`). Accepting, rejecting, "answered never resurfaces" (a
rejected row keeps its coordinates and is matched by time + 300 m, whatever the
stop's later span), the history-deleted and privacy-zone cuts (`invalidate.ts`)
and the stop's own link to its finding (`stop.stayRef`) are the stay inbox's,
unchanged.

- Own place within 100 m (or the venue's OSM id is already an own place) → the
  finding carries `placeId`: accepting adds a VISIT of that place; no lookup.
- Unknown venue → one lookup per stop (V1: Overpass outlines + Photon, shared
  throttle and budget): the finding names the building, its coordinates, category
  and OSM id; accepting creates the place (`externalRef = osm:<ref>`, category)
  unless the owner renamed it.
- Lodging beside the stop, address only, no named venue → nothing.
- Provider failure (Photon candidates, Overpass `timeout|rateLimited|budget|
  unavailable`) → the stop is NOT suggested and the day stays owed; reported by
  reason. A missing building layer defers instead of falling back to
  nearest-node (that is the McCafé mistake). Open data switched off still
  answers, with `lookup.venues = "off"` in the evidence. Never cached as "no venues".
- No auto-accept (V3), no drive-in classification. `STOP_MS` unchanged; every
  considered stop's minutes are logged (`travtrack.visitStop`) and returned as
  `stopMinutes` so Q2 can be measured.
- Permission = the stay scan's: consent row, Places domain, stay switch,
  TravTrack provider, instance on. Without it the days are acknowledged unread
  (enabling later does not ask about the past; "scan now" does). Days older
  than 30 days are acknowledged unread.
- Bounds per run: 5 days, 20 lookups, 20 new findings; the rest waits. The schedule waits 15 min
  (doubling, 6 h max, in memory) after a failed lookup, without touching the
  account's other projections.
- Accept re-check (`recheck.ts`): a visit finding holds while the day's stop
  derivation still finds the stop (>= 80 % of the window, within 300 m) — not
  by the stay detector's 20 minutes.

## Contract (additive only)

- `POST /api/v1/dawarich-stays/visits/scan` `{ lookbackDays?: 1..30 = 7 }` →
  `202 { jobId }`; job kind `travtrack.visitSuggestions`. Refusals: 403
  `TRAVTRACK_DISABLED`, 409 `TRAVTRACK_UNAVAILABLE`, `STAY_SUGGESTIONS_DISABLED`,
  `DAWARICH_PLACES_DISABLED`, `DAWARICH_SCAN_UNAVAILABLE` (no consent), 429.
  Job result: `{ status, days, created, grown, known, covered, suppressed,
  skippedPrivate, skippedNoZone, lodging, noVenue, deferred, failed:
  {places, venues}, stopMinutes[], interrupted }`.
- `GET /dawarich-stays/settings`: optional `visitLookupRetryAt` (ISO), only while
  the lookup fails.
- A stay row's `evidence` may carry `visit` `{ durationMs, observedMs,
  inferredMs, gaps, minimumStopMs, distanceM, venue {name, source: known|osm,
  osmRef, type, category, isArea, resolved}, alternatives[] {name, osmRef, type,
  distanceM, foldedInto}, lookup {geocoder, venues} }`, `explanation.code =
  "stay.stop"` (params `minutes, observedMinutes, inferredMinutes, radiusM,
  distanceM`) and `pointCount = 0`. `row.lat/lon` is the building, `sourceLat/Lon`
  the stop's anchor. A client that ignores `visit` reads a plain stay.
- `KnownPlace` (stop identity) gains optional `placeId`.
