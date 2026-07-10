# "Alle"-View Domain Colors + Distinct Cruises (Design)

**Date:** 2026-07-03
**Branch/worktree:** `feat/all-view-colors` (TravStats repo; main checkout left free for the owner's #152/#153/#154 work)
**Relates to:** GitHub issue #150 (cruises indistinguishable on the map)
**Package A** of the A+B batch (B = app globe, separate spec).

**Owner-approved 2026-07-03: "such dir Farben aus, alles erledigen."** Resolutions to §10:
(1) palette finalized by me (below, tunable on DEV); (2) user-editable per-cruise
`color` **is included** in Phase 1; (3) the globe (Phase 2) **is included** — do everything.

**Final palette (Phase 1, tunable on DEV):**
- Flight past → orange `#f0a947` `[240,169,71]` (full alpha)
- Flight upcoming → blue `#5ab0f0` `[90,176,240]`
- Cruise past → periwinkle `#6fa0d6` `[111,160,214]` (full alpha)
- Cruise planned → light periwinkle `#a9c3e0` `[169,195,224]` (lower alpha — reinforces "upcoming")
- Per-cruise derived palette (#150, Cruises tab): a curated 10-hue set avoiding the four
  status colors above and the domain colors (flight orange / cruise periwinkle / hotel
  purple `#b072d6` / poi teal `#5ec2b2`) — greens, rose, amber-gold, violet, etc.

---

## 1. Goal & scope

In the multi-domain **"Alle" map view**, color both domains **two-tone by status** (happened vs. upcoming) and remove the grey/red:

- **Flights:** past → orange, upcoming → blue. No grey, no red.
- **Cruises:** past → cruise color, upcoming → a new "planned" color.

Keep the **single flight view unchanged**. In the **single cruise views** (Cruises tab + cruise-detail map), make individual cruises **distinguishable** (issue #150): a distinct color per cruise, derived by default, optionally user-set.

**In scope:** the flat-map "Alle" (routes/overview) coloring, the cruise arc layer (all cruise surfaces), a new cruise-planned color token, and per-cruise distinction. **Phased:** the WebGL **globe** colors flights by count-heatmap (not status) and cruises single-color — matching it to this scheme is **Phase 2** (§7), so Phase 1 stays focused on the flat map.

**Out of scope:** flight status changes in the single flight view; the app (package B); #152/#153/#154.

## 2. Current behavior (verified)

- `frontend/src/components/layers/routesLayer.ts` colors flight routes by status: all-historical → grey `[150,150,150]`, pure-scheduled → blue `[80,200,255]`, mixed → red core + blue tips (`UpcomingArcLayer`), past-only → `paletteOverride` (amber in Alle) or frequency heatmap (single view). The amber override **only** touches the past-only branch, so grey/red survive in "Alle".
- `frontend/src/components/layers/cruiseArcsLayer.ts` colors **every** cruise arc one sky-blue `[56,189,248]`; only selection highlights. Cruises **already carry** `status: "scheduled"|"flown"|"cancelled"|"historical"` (`frontend/src/types/cruise.ts:40`, `backend/prisma/schema.prisma:755`) — never used for color. This is #150.
- Colors flow through props `flightRouteColor` and `showInternalCruises`/`cruisesOverride` (`AllTab.tsx` vs `FlightsTab.tsx`/`CruisesTab.tsx`). The only per-view signal reaching `routesLayer` today is `flightRouteColor`.

## 3. Decisions (resolved 2026-07-03)

- **D1 — Two colors per domain in "Alle", by status.** Flight past = orange `#f0a947` (flight domain), flight upcoming = blue `#50c8ff`; cruise past = `#6fa0d6` (cruise domain), cruise upcoming = new `#a9c3e0`. Mixed flight routes = orange→blue gradient (reuse `UpcomingArcLayer`, swap red core → orange). No grey, no red. Hex values are **initial, tunable** — confirm visually on DEV.
- **D2 — "Alle"-only, gated.** A new boolean prop `statusTwoTone` is threaded `AllTab → MapContainer3D → DeckGLMap → routesLayer` so the **single flight view is untouched** (keeps heatmap/blue/red/grey).
- **D3 — Cruise two-tone applies to all cruise surfaces** (one layer file), which is fine: "Alle", Cruises tab, and detail all gain past/planned tone. Cancelled stays excluded/dimmed as today.
- **D4 — #150 hybrid: derived-default + optional user override.** Each cruise gets a **distinct derived color** (stable hash of `cruise.id` → a curated palette) as the baseline — solves #150 immediately, **no migration**. Plus an **optional user-set `color`** (nullable, mirrors `Trip.color`) that overrides the derived one when present. In the **single Cruises tab + detail**, per-cruise color distinguishes cruises; in **"Alle"**, status two-tone wins (domain-level clarity). Planned cruises in the single views are shown with the planned tone / dimmed so "upcoming" still reads.
- **D5 — New color token.** Add `--domain-cruise-planned: #a9c3e0` (+ `-soft`/`-locked`) in `frontend/src/index.css` near the cruise tokens; the arc render also needs a matching RGB constant in `cruiseArcsLayer.ts` (arcs read tuples, not CSS).

## 4. Flight two-tone (Alle-gated)

**File: `frontend/src/components/layers/routesLayer.ts`.** Add a `statusTwoTone` param to `buildArcs`/`buildRouteData`. When true, collapse the status→color decision to:
- past family (`allHistorical` OR past-only) → orange `[240,169,71]`
- pure-scheduled → blue `[80,200,255]`
- mixed → orange→blue gradient
When false, current behavior is unchanged.

**Gradient:** `frontend/src/components/layers/UpcomingArcLayer.ts` hard-codes a red core; parameterize the core color (default red for compat) and pass orange when `statusTwoTone`. Only the mixed layer uses it.

**Threading (D2):** add `statusTwoTone?: boolean` prop through `AllTab.tsx` (set true) → `MapContainer3D.tsx` → `DeckGLMap.tsx` → the `routesLayer` builders. `FlightsTab.tsx` does not pass it (stays false → unchanged).

**Journey mode:** `buildJourneyLayers.ts` flight arcs are hardcoded amber `[245,158,11]` — align to `#f0a947` `[240,169,71]` for consistency (or leave; note the pre-existing legend/line mismatch).

**Tests (Vitest):** `routesLayer` color-mapping unit test — `statusTwoTone` maps historical→orange (not grey), scheduled→blue, mixed→gradient flag; `statusTwoTone=false` keeps grey/red (regression guard).

## 5. Cruise two-tone + distinct per-cruise

**File: `frontend/src/components/layers/cruiseArcsLayer.ts`.** Extend `ArcDatum` with `status: CruiseStatus` and a resolved `color: [number,number,number]`. `buildCruiseArcs` sets each arc's color by mode:
- **Alle mode** (a new `mode: "status"` param, default): past (`flown`/`historical`) → cruise `[111,160,214]`; planned (`scheduled`) → planned `[169,195,224]`.
- **Single mode** (`mode: "perCruise"`, used by Cruises tab + detail): `cruise.color ?? deriveCruiseColor(cruise.id)`; planned cruises rendered dimmer (lower alpha) so status still reads.
Selection highlight/dim logic stays. Arrows layer mirrors the same color.

**`deriveCruiseColor(id: string)`** — new pure helper (own file `frontend/src/lib/cruiseColor.ts`): stable string-hash → index into a curated ~10-color palette (distinct hues, dark-theme-legible). Pure + unit-tested (same id → same color; spread across palette).

**Token (D5):** `--domain-cruise-planned` in `index.css`; `CRUISE_PLANNED_RGB` in `cruiseArcsLayer.ts`.

**Optional user color (D4):**
- `backend/prisma/schema.prisma` Cruise model: add `color String? @map("color")` (mirrors `Trip.color` at line 626). **Hand-written additive migration** (per CLAUDE.md the drift blocks `migrate dev`; additive nullable column is low-risk — precedent: pairing/cruise migrations).
- `backend/src/schemas/` cruise Zod: accept optional `color` (hex validation).
- `frontend/src/types/cruise.ts` `Cruise`/`CruiseInput`: `color?: string | null`.
- `frontend/src/components/Cruise/CruiseEditModal.tsx`: a color field (reuse the Trip color-picker pattern).
- `cruiseArcsLayer.ts` `perCruise` mode already prefers `cruise.color` when set.

**Tests:** `cruiseColor.deriveCruiseColor` unit test; `cruiseArcsLayer` status-mode vs perCruise-mode color test.

## 6. Legend

`AllTab.tsx:319-350` legend swatches use `DOMAINS.*.color`, which don't match rendered arcs today. Update the "Alle" legend to show the four status swatches (Flug vergangen/geplant, Kreuzfahrt vergangen/geplant) with the actual render colors, DE/EN.

## 7. Phase 2 — globe (optional, same scheme)

The globe (`GlobeView.tsx` + `buildGlobeLayers.ts`) colors flight arcs by count-heatmap and cruises single-color `[80,180,255]`. To match: carry `status` into the globe `ArcDatum`/`CruisePathDatum`, apply the same two-tone in the "Alle" globe mode. Deferred so Phase 1 (flat map) lands first; include if the owner wants the globe consistent immediately.

## 8. Files touched (Phase 1)
- `frontend/src/components/layers/routesLayer.ts` (flight two-tone + `statusTwoTone`)
- `frontend/src/components/layers/UpcomingArcLayer.ts` (parameterize core color)
- `frontend/src/components/layers/cruiseArcsLayer.ts` (status/perCruise modes + planned color)
- `frontend/src/lib/cruiseColor.ts` (new derived-color helper)
- `frontend/src/components/Dashboard/tabs/AllTab.tsx` (`statusTwoTone` on, legend)
- `frontend/src/components/MapContainer3D.tsx`, `frontend/src/components/DeckGLMap.tsx` (prop threading)
- `frontend/src/components/Dashboard/modes/buildJourneyLayers.ts` (amber align)
- `frontend/src/index.css` (`--domain-cruise-planned`)
- i18n `de/en` (legend labels)
- **Optional user color:** `schema.prisma` + hand-written migration, cruise Zod, `types/cruise.ts`, `CruiseEditModal.tsx`

## 9. Definition of done (Phase 1)
"Alle" map: flights orange(past)/blue(upcoming) with orange→blue mixed gradient, no grey/red; cruises cruise-color(past)/planned(upcoming). Single flight view visually unchanged. Cruises tab: each cruise a distinct color (#150), planned dimmed. Legend matches. `tsc`/lint/vitest green. Owner tunes hexes on DEV. (User-editable per-cruise color included if D4-override is kept in the plan.)

## 10. Owner review — RESOLVED (2026-07-03)
- Hex values: finalized above (§ header) by me; tunable live on DEV.
- User-editable per-cruise `color` + hand-written additive migration: **included in Phase 1**.
- Globe (Phase 2, same two-tone + per-cruise scheme): **included** — do everything.
