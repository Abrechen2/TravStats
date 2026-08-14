# Dawarich Integration — Feature Concept

**Date:** 2026-07-04
**Status:** CONCEPT (brainstorm captured) — full design brainstorm deferred **behind
Immich + Hotels**. This is a placeholder to hold the direction, not an
implementation-ready spec.
**Branch:** `dev/dawarich` (long-running, off `main`, worktree
`.claude/worktrees/dawarich`)

## 1. What & why

[Dawarich](https://github.com/Freika/dawarich) is a self-hosted Google-Timeline
replacement: continuous **location history**, detected **"visits"** (places you
stopped), countries/cities visited, a **REST API with per-user keys**, and it
already imports Immich geodata + OwnTracks/GPS/Google-Takeout.

It's **complementary** to TravStats, not overlapping:
- **Dawarich** = raw "where was I, physically, continuously" — ground truth.
- **TravStats** = curated travel *events* (flights, cruises, hotels, trips).

Positioned as the **third optional self-hosted "enricher"** after Immich
(photos): a self-hoster could run **Immich (photos) + Dawarich (location) +
TravStats (curated travel log)** — TravStats becomes the structured layer on top.

## 2. Integration ideas (ranked)

1. **Auto-suggest from location history (the killer feature).** A Dawarich
   *visit* of N nights at coordinates X → TravStats suggests a **hotel stay**
   (Lodging domain); a multi-day presence in a region → suggest **creating a
   trip**. This is GPS ground truth for the Lodging/Immich date-based
   auto-suggest — far stronger than dates alone.
2. **Reconcile countries/cities visited** — Dawarich computes them from GPS,
   TravStats from logged events; cross-check / import as ground truth.
3. **Track overlay on trip maps** — draw the real GPS path around/between logged
   flights/cruises/hotels on the trip map/globe.
4. **Coordinates for hotels/POIs** from Dawarich reverse-geocoded visits (an
   alternative/supplement to OSM Nominatim geocoding).

Direction is **pull FROM Dawarich** (read its API to suggest/enrich); pushing
TravStats events into Dawarich adds little (it already has the raw location).

## 3. Architecture (mirror the Immich integration)

Optional, **per-user opt-in**. Dawarich **base URL + API key** in Settings,
resolved **User → Admin → ENV** (same pattern as Immich / the API-key resolver).
A **read-only, version-contained `dawarichClient`** (Dawarich evolves fast — keep
its API shape in one place). **Privacy-first**: location history is sensitive —
self-hosted, opt-in, key encrypted at rest, never sent to the frontend.

## 4. Caveats

- **Separate feature — do not scope-creep the Immich or Hotels branches.**
- Dawarich's API is young/moving → contain it behind the client, expect churn.
- Niche-within-niche (only Dawarich users), but the TravStats self-hoster
  audience overlaps strongly.

## 5. Sequencing

Behind **Immich + Hotels**. When picked up: run the full **design brainstorm**
(concrete API endpoints, visit→stay suggestion flow, connection settings, map
overlay) → spec → phased plan → subagent-TDD in this worktree. It ties tightly to
the **Lodging auto-suggest** ([[project_hotels_domain_feature]]) and the **Immich
photos-on-map** ([[project_immich_albums_feature]]) — ideally shares the
"suggest events from external signal" UX with both.

## Links
- Dawarich: https://github.com/Freika/dawarich
- Import docs (Immich/Takeout/OwnTracks): https://dawarich.app/docs/tutorials/import-existing-data
