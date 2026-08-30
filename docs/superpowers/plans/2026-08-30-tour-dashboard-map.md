# Tour routes on the dashboard map — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development.

**Goal:** Tour lines appear on the dashboard map — in the `all` tab alongside flights, cruises, lodging and places, and in a `tour` tab of their own.

**Architecture:** Two endpoints mirroring the cruise precedent exactly: a metadata list across trips, and a BATCH geometry lookup capped at 100 ids. The map component learns nothing about tours; the layer arrives through `MapContainer3D`'s existing `extraLayers` prop.

**Spec:** `docs/superpowers/specs/2026-08-29-tour-route-sections-design.md` §9.3 — deferred out of Phase 1 with the reason "once there is more than one trip's worth of data to look at". That reason no longer holds; the owner asked for it on 2026-08-30.

## Global Constraints

- `any` FORBIDDEN (`unknown` + type guards). No `console.log`; the logger is a DEFAULT export.
- Zod at every boundary; schemas in `backend/src/schemas/`.
- Every new endpoint needs an OpenAPI entry — an exclusion is forbidden. Note the guard checks method+path only, never response FIELDS, so new fields need their own spec lines.
- Middleware PER ROUTE, never `router.use()` on a router mounted at `/api/v1`.
- Files 200–400 ideal, 800 hard max. Add nothing to `backend/src/routes/trips.ts` (~1400 lines).
- Frontend copy German first, English mirrored in the same change. A tour is a **Tour** inside a **Reise**.
- `react-hooks/exhaustive-deps` is disabled repo-wide — dependency arrays by hand.
- Tests assert raw i18n KEYS, never German text.
- Branch `dev/tour-routes`. Never commit to `main`. Never `--amend`. NUL count 0 in every written file.
- Backend DB is port **5434**; never touch 5433. Jest needs `NODE_OPTIONS=--max-old-space-size=8192` for broad runs and a trailing pipe masks its exit code.

## What exists already, measured

| Fact | Where |
|---|---|
| `MapContainer3D` already accepts `extraLayers?: Layer[]` | `frontend/src/components/MapContainer3D.tsx:46` |
| `buildTourPaths` already turns tour geometry into deck.gl path data | `frontend/src/components/layers/tourPathsLayer.ts` |
| The batch-geometry pattern: `{ids: string[]}`, min 1 **max 100**, scoped by `userId`, returns `Record<id, FeatureCollection>` | `backend/src/routes/cruises.ts:216-260` |
| `AllTab` has four `build*Legend` siblings to mirror | `frontend/src/components/Dashboard/tabs/AllTab.tsx` |
| A dashboard tab is NOT a domain — separate lists | `frontend/src/types/dashboard.ts` vs `frontend/src/shared/domains.ts` |
| Tours are gated behind `tourRoutes`; Dawarich has its own key since `6247e262` | `frontend/src/config/betaFeatures.ts` |

---

## Task 1: Two endpoints — list and batch geometry

**Files:**
- Create: `backend/src/routes/trips/tourIndex.ts`, mounted in `mounts.ts` after `tourTracks`
- Modify: `backend/src/schemas/tour.ts`, `backend/src/services/openapi/paths/tours.ts`
- Test: `backend/src/routes/__tests__/tourIndex.test.ts`

```
GET  /tours                  -> { tours: TourSummary[] }   metadata across ALL the caller's trips, NO geometry
POST /tours/geometry/batch   -> { data: Record<routeId, FeatureCollection> }   body { ids: string[] } min 1 max 100
```

`TourSummary` carries what a map legend and a tab list need and nothing more: `id`, `tripId`, `tripName`, `name`, `mode`, `distanceKm`, `stopCount`, and the section's date span. Geometry is deliberately absent — the same reason the track list omits it: a line is location data and a list call must not ship megabytes.

- [ ] **Write the failing tests first.** Cover: the list returns tours from SEVERAL trips of the caller; it never returns another user's tour; it carries no geometry field at all (assert the key is ABSENT, not empty); the batch returns geometry keyed by id; the batch SILENTLY OMITS an id belonging to another user rather than 403-ing on it (mirror what the cruise batch does — read it and match, do not invent); 101 ids is a 400; an empty array is a 400.
- [ ] Middleware per route. Ownership scoped in the `where`, never filtered after the fetch.
- [ ] OpenAPI entries for both; run the coverage guard.
- [ ] Commit.

---

## Task 2: The layer and the legend in the `all` tab

**Files:**
- Create: `frontend/src/lib/api/tourIndex.ts`, `frontend/src/hooks/useDashboardTours.ts` + test
- Modify: `frontend/src/components/Dashboard/tabs/AllTab.tsx` + test, both i18n files

- [ ] Fetch the list, then the geometry in ONE batch call for the ids on screen. Never one request per tour — that is the N+1 the batch endpoint exists to prevent. If more than 100 tours exist, batch in chunks of 100 and say so in a comment.
- [ ] Pass the layer through `MapContainer3D`'s existing `extraLayers`. The map component must learn nothing about tours.
- [ ] Add `buildTourLegend`, mirroring the four existing `build*Legend` helpers — same shape, same file, same colour source. Tour colours come from `tourPathsLayer.ts`'s mode palette; do NOT hardcode a second one.
- [ ] Three states: loading, empty, error. **Never a zero over a failed load** — a legend row claiming "0 Touren" after a failed request is a lie.
- [ ] Commit.

---

## Task 3: The `tour` dashboard tab

**Files:**
- Create: `frontend/src/components/Dashboard/tabs/TourTab.tsx` + test
- Modify: `frontend/src/types/dashboard.ts`, `frontend/src/pages/DashboardPage.tsx`, `frontend/src/components/Dashboard/DomainTabStrip.tsx`, both i18n files

- [ ] Add `tour` to `DASHBOARD_TABS` with modes `["routes", "globe"]`. A tab is not a domain: touch NEITHER `shared/domains.ts` mirror, and add no domain gating.
- [ ] Gate the tab behind `isFeatureVisible("tourRoutes")`, exactly the way `poi` is gated in `DomainTabStrip.tsx` — copy that shape, do not invent a second one.
- [ ] `TourTab` shows the same layer as task 2 plus a list of the tours with their trip, distance and stop count. Reuse the hook from task 2; do not fetch twice.
- [ ] URL carries tab + mode like every other tab; the last mode is remembered per the existing convention.
- [ ] Commit.

---

## Final gate

- [ ] Backend `tsc` + lint + the tour/openapi suites. Frontend `tsc` + lint + `vitest --run` + `vite build`.
- [ ] **A browser check in a production build, by the controller** — the lines must be VISIBLE on the dashboard map at full strength, and the legend row must count what is drawn. Phase 1 shipped a chord so faint it drew zero pixels while every test passed; that is why this is checked in a bundle and not in a unit test.
- [ ] `git push forgejo dev/tour-routes`. Do NOT merge to `main`.

## Deliberately out of scope

Editing a tour from the dashboard. Clicking a tour line to open its editor (a later nicety, not part of "show the routes"). The globe mode's own styling beyond what `routes` already gives.
