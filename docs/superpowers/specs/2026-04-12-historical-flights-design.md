# Historical Flights Feature

**Date:** 2026-04-12
**Status:** Approved

## Problem

Users want to log past flights where only the route is known — no exact
departure/arrival times, flight number, or other details. Currently every
flight requires times, which blocks users from recording older trips.

## Design

### New Status: `historical`

Add `"historical"` to the flight status enum (alongside `flown`,
`scheduled`, `cancelled`). A historical flight is a route-only entry
where times are optional.

### Prisma Schema Change

```prisma
enum FlightStatus {
  scheduled
  flown
  cancelled
  historical
}
```

Migration: `ALTER TYPE "FlightStatus" ADD VALUE 'historical';`

### Backend Changes

**Validation (`flight.ts` schema):**
- New variant of `createFlightSchema` where `departureTime` and
  `arrivalTime` are optional when `status === "historical"`
- Minimum required: `departure.iata` (or icao) + `arrival.iata` (or icao)
- When times are missing, store as `null` in the DB

**Stats exclusion:**
- `/stats/summary` `computeSummary`: historical flights excluded from
  `totalFlightTime` (already filtered by `status: 'flown'`)
- `/stats/fun`, `/stats/unique`, `/stats/business`: already filter
  `status: 'flown'` — no changes needed
- Distance/airport/country counting: historical flights ARE included
  in the `totalDistance` calculation and airport/country counts in the
  summary endpoint (change `flownWhere` to include `historical` for
  distance-only aggregation)

**Flights API:**
- `GET /flights` returns historical flights normally
- `GET /flights/geo` includes them for map display
- Achievement check: historical flights count toward airport/country
  achievements but NOT toward flight-count or duration achievements

### Frontend Changes

**SimplifiedFlightForm / FlightReviewModal:**
- Add checkbox: "Historischer Flug (nur Route bekannt)"
- When checked:
  - Remove required validation from departureTime, arrivalTime
  - Set status to `"historical"` automatically
  - Show a hint: "Nur Abflug- und Ankunftsflughafen erforderlich.
    Alle weiteren Angaben sind optional."
- When unchecked: normal behavior (times required)

**FlightEntry (sidebar list):**
- New badge: "HISTORISCH" in grey (`rgba(150,150,150,0.3)` bg,
  `rgb(160,160,160)` text) — same pattern as GEPLANT badge

**Map (routesLayer.ts):**
- Historical-only routes: grey color `[150, 150, 150]`, thin width
  (similar to scheduled but grey instead of cyan)
- `isHistorical` flag on `ArcDatum` (same pattern as `isScheduled`)

### i18n Keys

**DE:**
- `"historicalFlight"`: `"Historischer Flug (nur Route bekannt)"`
- `"historicalHint"`: `"Nur Abflug- und Ankunftsflughafen erforderlich. Alle weiteren Angaben sind optional."`
- `"historical"`: `"historisch"`

**EN:**
- `"historicalFlight"`: `"Historical flight (route only)"`
- `"historicalHint"`: `"Only departure and arrival airports required. All other fields are optional."`
- `"historical"`: `"historical"`

### Stats Treatment Summary

| Stat | Historical included? |
|------|---------------------|
| Total distance (km) | Yes |
| Airports visited | Yes |
| Countries visited | Yes |
| Continents | Yes |
| Flight time/duration | No |
| Airline loyalty | Only if airline filled |
| Flight count | No (separate counter) |
| Achievements (airports/countries) | Yes |
| Achievements (flight count/hours) | No |

### Components to Modify

| Component | Change |
|-----------|--------|
| `backend/prisma/schema.prisma` | Add `historical` to FlightStatus enum |
| `backend/src/schemas/flight.ts` | Optional times when historical |
| `backend/src/routes/stats.ts` | Include historical in distance/airport counts |
| `backend/src/utils/achievements.ts` | Historical counts for geo achievements |
| `frontend/src/types/index.ts` | Add `"historical"` to Flight status type |
| `frontend/src/components/SimplifiedFlightForm.tsx` | Checkbox + conditional validation |
| `frontend/src/components/FlightPanel/FlightEntry.tsx` | HISTORISCH badge |
| `frontend/src/components/layers/routesLayer.ts` | Grey arcs for historical |
| `frontend/src/components/layers/layerTypes.ts` | `isHistorical` on ArcDatum |
| `frontend/src/pages/AdvancedStatsPage.tsx` | Filter historical from time stats |

### Scope Exclusions

- No bulk import for historical flights (manual one-by-one)
- No separate "historical flights" tab or page
- No conversion of existing flights to/from historical
