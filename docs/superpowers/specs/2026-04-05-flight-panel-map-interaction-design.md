# Flight Panel & Map Interaction — Design Spec

**Date:** 2026-04-05
**Status:** Approved for implementation

---

## Overview

Enhance the "Letzte Flüge" sidebar panel with three interconnected features:

1. **Map Highlight** — clicking a flight spotlights it on the map with animation and a tooltip
2. **Quick Actions** — hover reveals Edit, Map-focus, Stats, Duplicate, Delete per flight entry
3. **Multi-Leg Grouping** — connecting flights (same day, ≤12h gap, shared airport) are visually grouped in the list and animate together on the map

---

## Architecture

**Approach: New `FlightPanel` component + Zustand selection store**

The existing inline panel JSX in `DashboardPage.tsx` is extracted into a standalone `FlightPanel` component. A new `useFlightSelectionStore` (Zustand) decouples selection state from both panel and map — both subscribe independently, no props-drilling.

### New files
- `frontend/src/components/FlightPanel.tsx` — panel root, grouping logic
- `frontend/src/components/FlightPanel/FlightEntry.tsx` — single flight row + quick actions
- `frontend/src/components/FlightPanel/FlightGroupItem.tsx` — multi-leg group with bracket
- `frontend/src/components/FlightPanel/InlineStats.tsx` — expandable stats row
- `frontend/src/components/FlightPanel/QuickActions.tsx` — hover action bar
- `frontend/src/components/MapTooltip.tsx` — positioned div overlay on map canvas
- `frontend/src/store/flightSelectionStore.ts` — Zustand store
- `frontend/src/utils/groupFlights.ts` — multi-leg detection logic

### Modified files
- `frontend/src/pages/DashboardPage.tsx` — replace inline panel with `<FlightPanel />`
- `frontend/src/components/DeckGLMap.tsx` — subscribe to store, add highlight + animation layers
- `frontend/src/components/MapContainer3D.tsx` — render `<MapTooltip />`, handle flyTo

---

## State & Data Model

### `useFlightSelectionStore`

```ts
interface FlightSelectionState {
  selectedIds: string[]
  highlightMode: 'single' | 'group' | null
  setSelection: (ids: string[]) => void
  clearSelection: () => void
}
```

### `FlightGroup`

```ts
type FlightGroup =
  | { type: 'single'; flight: Flight }
  | { type: 'multileg'; flights: Flight[]; label: string }
```

`label` is auto-generated: `"MUC → FRA → JFK"` (full routing string).

---

## Multi-Leg Detection (`groupFlights.ts`)

```
Input: Flight[] sorted by departure_time ASC

Algorithm:
  For each consecutive pair (A, B):
    - A.arrivalAirport.iata === B.departureAirport.iata
    - timeDiff(A.arrival_time, B.departure_time) <= 12h
  → merge into { type: 'multileg', flights: [A, B], label: "X → Y → Z" }

Chains of 3+ legs are supported (A→B→C→D).
Output: FlightGroup[]
```

---

## FlightPanel Component

### Structure

```
FlightPanel
├── Header: "Letzte Flüge (N)" + close button
├── Scrollable list
│   ├── FlightGroupItem        ← multi-leg
│   │   ├── FlightEntry (leg 1)  [indented, bracket left]
│   │   ├── FlightEntry (leg 2)  [indented, bracket left]
│   │   └── Group footer: "MUC → FRA → JFK · 2 Legs · 9.820 km"
│   └── FlightEntry            ← single flight
│       ├── Route + airline + date
│       ├── QuickActions (visible on hover)
│       └── InlineStats (visible when expanded)
└── "+ Flug hinzufügen"
```

### Multi-Leg Visual Connector

Left bracket via CSS `border-left` on a wrapper div — 2px accent-color line connecting all legs of a group, with a small corner at the bottom leg. The group footer shows the full routing and total distance.

### QuickActions (all five)

| Icon | Action | Behavior |
|------|--------|----------|
| ✏️ | Bearbeiten | Calls `onEdit(flight)` → DashboardPage opens EditModal |
| 🗺️ | Auf Map | `setSelection([flight.id])` — triggers flyTo + animation |
| 📊 | Stats | Toggles `InlineStats` expanded state (local to entry) |
| 📋 | Duplizieren | Calls `onDuplicate(flight)` → DashboardPage handles API |
| 🗑️ | Löschen | Calls `onDelete(flight.id)` + shows Undo-Toast (3s window) |

Actions appear on `onMouseEnter`, hide on `onMouseLeave`. No separate "map" button when entry is clicked directly — clicking the entry row itself also calls `setSelection`.

### InlineStats content

```
8.280 km  ·  9h 45m  ·  Business
CO₂: 0,9t  ·  LH 404  ·  A350
```

Distance via `calculateDistance()` from `lib/geo.ts` (Haversine). Duration via `calculateFlightDuration()` from same file. CO₂ from flight record if available.

---

## Map Highlight & Animation

### Trigger

`useFlightSelectionStore` subscription in `DeckGLMap`. When `selectedIds` changes:

### Animation Sequence

1. **Camera flyTo** (0ms, 500ms duration)
   Compute bounding box of all selected flights' departure + arrival coordinates. Animate `viewState` to fit bbox with padding. Multi-leg: bbox of all airports in the group.

2. **Spotlight fade** (parallel, 200ms)
   All non-selected arc layers fade to 10% opacity via a `opacity` prop on the layer. Selected route(s) remain at 100% + a second ArcLayer rendered on top with `widthMinPixels: 8` and 40% opacity as glow effect.

3. **Airport pulse** (parallel with spotlight)
   Three `ScatterplotLayer`s for each selected airport at radii `r`, `r*2`, `r*3` with opacities `0.8`, `0.4`, `0.15`. A `setInterval` at 800ms cycles through phase offsets to create a pulsing effect. Cleaned up on `clearSelection`.

4. **Plane animation** (starts after flyTo, duration 1.5s)
   `requestAnimationFrame` loop incrementing `t: 0 → 1`. Position computed via quadratic Bézier matching the ArcLayer's curve:
   `apex = midpoint elevated by arcHeight`. Rendered as an `IconLayer` or `TextLayer` (✈ emoji). On multi-leg, animates leg 1 then leg 2 sequentially.
   Plane remains as a static marker at destination after animation completes.

5. **Tooltip fade-in** (when plane reaches destination, ~1.8s after click)
   `MapTooltip` is a positioned `div` above the map canvas. Position computed via `deck.gl viewport.project([lon, lat])` → screen coordinates of arc midpoint. Content:

   ```
   ┌─ MUC → JFK ──────────────────────┐
   │  LH 404 · A350 · 14. Mär 2024    │
   │  8.280 km · 9h 45m · Business    │
   │  CO₂: 0,9t                       │
   │  [✏️ Bearbeiten]  [✕ Schließen]  │
   └──────────────────────────────────┘
   ```

### Deselection

Click anywhere on map canvas (not on a route arc) → `clearSelection()` → all effects fade out (200ms), layers return to normal opacity, pulse interval cleared, tooltip unmounted, plane marker removed.

---

## DashboardPage Changes

- Remove inline panel JSX (the `leftOpen` sidebar content)
- Add `<FlightPanel flights={recentFlights} onEdit={...} onDelete={...} onDuplicate={...} isOpen={leftOpen} onClose={...} />`
- Remove `selectedFlightId` state — now owned by store
- `onFlightClick` passed to MapContainer3D still works via store subscription

---

## Error Handling

- If flight has no coordinates (missing lat/lon in GeoJSON) → skip flyTo and animation, tooltip still shows, log warning
- If duplicate API call fails → show error toast, no optimistic update
- Delete uses optimistic pattern: API call is delayed 3s via `setTimeout`. If undo is clicked within that window the timeout is cancelled — no API call made. If window expires, the delete API call fires normally.

---

## Testing

- Unit: `groupFlights()` — various edge cases (same-day different airport, >12h gap, 3-leg chain)
- Unit: `QuickActions` — all 5 actions call correct callbacks
- Unit: `FlightSelectionStore` — setSelection, clearSelection, highlightMode transitions
- Integration: clicking FlightEntry → store updates → DeckGLMap receives correct selectedIds
- Integration: Undo-toast delete flow

---

## Out of Scope

- Manual trip grouping (drag-and-drop) — future feature
- Round-trip grouping (outbound + return) — future feature
- Globe mode map highlight — Globe uses react-globe.gl, separate integration; this spec covers DeckGLMap only
