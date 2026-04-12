# Route/Trip Info Popup Redesign

**Date:** 2026-04-12
**Status:** Approved

## Problem

The current route/trip popup on the dashboard map shows only IATA codes
(e.g. "MUC → HEL → MUC") without full airport names, and displays
minimal statistics. The info window needs richer, context-aware content
that differs between visualization modes.

## Design: Two-Stage Popup → Sidebar

### Clickable Modes

| Mode | Click behavior |
|------|---------------|
| `routes` | Shows all flights on that route (e.g. all 4× MUC↔HEL) |
| `trip-routes` | Shows a single trip (e.g. MUC→FRA→DFW Nov 2022) |
| `trips` | No click (animation mode) |
| `heatmap/hexagon/columns/contour` | No click (aggregated view) |
| `globe` | No click (3D view) |

### Stage 1: Compact Popup (on map)

A small floating card over the map with:

- **Full airport names** + IATA codes (e.g. "Munich Airport (MUC) → Helsinki Vantaa (HEL)")
- **Summary stats**: flight count, route distance, average duration, date range
- **Airlines** and **seat class** (aggregated)
- **Trip name + color** (trip-routes mode only)
- **"Route-Details →" / "Trip-Details →" button** that opens the sidebar

Layout (routes mode):
```
Munich Airport (MUC)  →  Helsinki Vantaa (HEL)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4 Flüge  ·  1.524 km  ·  Ø 3h 25min
Okt 2021 – Sep 2025
Lufthansa  ·  Economy

        [Route-Details →]         ✕
```

Layout (trip-routes mode):
```
┌─ USA Reise Nov 2022 ─────────────────┐
Munich → Frankfurt → Dallas → Frankfurt → Munich
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
4 Flüge  ·  18.240 km  ·  10 Tage
18. Nov – 28. Nov 2022
Lufthansa

        [Trip-Details →]          ✕
```

### Stage 2: Sidebar (replaces flight list)

When the user clicks "Route-Details →" / "Trip-Details →", the left
sidebar (currently showing the flight list) is replaced with a detail
view. A back button returns to the normal flight list.

#### Route-Details Sidebar (routes mode)

- **Header**: Full airport names, route distance, flight count
- **Route statistics**: average duration, airline breakdown, seat class breakdown
- **Chronological flight list**: Each flight as a row showing date, flight number, route direction, seat number

```
MUC ↔ HEL  ·  Route-Statistik
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Munich Airport → Helsinki Vantaa
1.524 km  ·  4× geflogen
Ø Dauer: 3h 25min
Airlines: Lufthansa (4×)
Klassen: Economy (4×)

Flüge auf dieser Route
──────────────────────
28. Okt 2021  LH2460  MUC→HEL  3F
31. Okt 2021  LH2461  HEL→MUC  3A
17. Okt 2023  LH2460  MUC→HEL  3F
22. Okt 2023  LH2461  HEL→MUC  3A
18. Sep 2025  LH2460  MUC→HEL  11C
21. Sep 2025  LH2465  HEL→MUC  18C
```

#### Trip-Details Sidebar (trip-routes mode)

- **Header**: Trip name (colored), flight count, total distance, country count
- **Numbered leg list**: Each leg with date, flight number, route, times, seat

```
USA Reise Nov 2022
━━━━━━━━━━━━━━━━━━
4 Flüge  ·  18.240 km  ·  3 Länder

Legs
──────────────────────
1. 18.Nov  LH95   MUC→FRA  08:00→09:05  Economy
2. 18.Nov  LH438  FRA→DFW  10:10→14:30  22G
3. 27.Nov  LH439  DFW→FRA  16:15→09:00  16D
4. 28.Nov  LH100  FRA→MUC  10:15→11:10  Economy
```

## Data Sources

- `Flight.depName` / `Flight.arrName` — full airport names (already in DB)
- `Flight.durationMinutes` — timezone-aware duration (added in 0.17.0)
- `Flight.trip` — trip name and color
- Distance calculated via Haversine from lat/lon coordinates

## Components to Modify

| Component | Change |
|-----------|--------|
| `TripTooltip.tsx` | Redesign compact popup with full names, stats, details button |
| `MapTooltip.tsx` | May merge into TripTooltip or keep for single-flight hover |
| `DeckGLMap.tsx` | Pass `onShowRouteDetails` callback to popup |
| `MapContainer3D.tsx` | Manage sidebar state (flight-list vs route-details) |
| **New: `RouteDetailsSidebar.tsx`** | Route statistics + flight list view |
| **New: `TripDetailsSidebar.tsx`** | Trip overview + numbered legs view |

## Scope Exclusions

- No changes to non-clickable modes (heatmap, hexagon, etc.)
- No new API endpoints needed (all data available from existing flights)
- No changes to the existing flight list sidebar (only replaced when details are shown)
