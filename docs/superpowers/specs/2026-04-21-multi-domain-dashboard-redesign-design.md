# Multi-Domain Dashboard + Map-Mode Redesign

**Date:** 2026-04-21
**Branch:** `dev/multi-domain-v1`
**Status:** Design approved by user; ready for implementation planning
**Scope:** Frontend-only refactor. No new backend endpoints; existing
`/api/v1/stats/*` may be lightly extended if a clean signature emerges
during implementation.

---

## Motivation

The Dashboard today is a flight-centric map. Cruises were retrofitted as
a layer and an ad-hoc "Kreuzfahrten"-pill (commit `44b2951`, `dev/multi-domain-v1`)
was glued on top. Users rightly flagged this as incoherent — the page
behaves like a flight dashboard with bolted-on cruise affordances
rather than a proper multi-domain surface.

Goal: one dashboard that treats each tracking domain as a first-class
peer (`flight`, `cruise`, `poi`), with map modes and controls that
actually fit each domain's shape. Existing list-management pages
(`/flights`, `/cruises`) stay put — the dashboard is purely the
spatial view.

---

## Decisions log (inputs frozen during brainstorm)

| # | Decision | Rationale |
|---|---|---|
| 1 | Mental model = "Map-first, domain-switch" (Option C of the brainstorm) | Keeps the map as hero content; each tab gets the modes and stats that fit it |
| 2 | Default tab = `All` | Cross-domain overview matches "every time I open TravStats I want to see what I've done" |
| 3 | Cruise-Comparison is a separate feature on `/cruises`, not a map mode | Comparison needs two-query UI, doesn't belong in the mode dropdown |
| 4 | Journey mode in `All` is in scope | Cross-domain trip visualisation (flight → cruise → flight-home) is high-value |
| 5 | Nav-bar items `Flüge` + `Kreuzfahrten` remain as list-management pages | Clean separation: spatial view vs. data management |
| 6 | Right stats-sidebar is removed from the dashboard | Stats live at `/stats`, dashboard becomes purely spatial |
| 7 | Left sidebar stays, content is domain-specific per tab | List-at-a-glance is useful on the map |
| 8 | Time-slider lives inside the Filter-Dropdown | Avoids a permanent bottom-bar; matches existing filter-UI conventions |
| 9 | Time-range filter is global across tabs | Time is the natural cross-domain question; domain filters stay per-tab |
| 10 | URL reflects active tab + mode | Bookmarks + deep-links ("share this view of my Mediterranean cruises") |
| 11 | Last mode per domain persists in localStorage | Power-user convenience; practically free |
| 12 | Modes dropped: `hexagon`, `contour`, `columns`, `trips`-animation | User: "Isolinien, Animation, Hexagon sind unnötig"; Codex review: columns adds little value at our data volumes |
| 13 | Globe available only on `All` tab, not per-domain | Globe is a projection choice, not a domain-shaped visualisation; avoids mode-matrix duplication (Codex critique) |
| 14 | POI layer is omitted from `All`-overview until the POI domain schema lands | Avoids placeholder-noise; All shows only domains that actually have data |

---

## Information Architecture

### Nav bar (unchanged)

```
Dashboard · Erfolge · Stats · Flüge · Kreuzfahrten · Einstellungen · Admin · Parser
```

`Flüge` and `Kreuzfahrten` remain as list-management pages with
CRUD/tables. No change.

### Dashboard structure

```
┌──────────────────────────────────────────────────────────────┐
│ NavBar                                                        │  (unchanged)
├──────────────────────────────────────────────────────────────┤
│ Domain-Tab-Strip:   All · Flights · Cruises · POIs            │  (new)
├──────────────────────────────────────────────────────────────┤
│ Controls bar:  [Mode ▾]  [Filter ▾]             [+ Add ▾]     │  (refactored)
├──────────────────────────────────────────────────────────────┤
│                                                               │
│                  Fullscreen Map                              │
│                                                               │
│  (Left sidebar, toggleable)                                   │
│                                                               │
└──────────────────────────────────────────────────────────────┘
```

### Route structure

| Route | Effect |
|---|---|
| `/dashboard` | Default: `All` tab, default mode, no query params |
| `/dashboard/all` | Same as `/dashboard` |
| `/dashboard/flights` | Flights tab, mode per precedence rule below |
| `/dashboard/cruises` | Cruises tab, mode per precedence rule |
| `/dashboard/poi` | POIs tab; if POI domain disabled, shows a "coming soon" empty state |
| `/dashboard/<tab>?mode=<mode>` | Explicit mode override |

Unknown tab → redirect to `/dashboard`. Unknown mode → fall back to the
domain's default mode.

---

## Tabs + Modes

### Flights

| Mode | Default | Shape | What question it answers |
|---|---|---|---|
| `routes` | ✅ | Flight arcs | "Which routes have I flown?" |
| `heatmap` | | Grid heatmap of departure/arrival coords | "Where do my flights concentrate?" |
| `stats-map` | | Airport markers scaled by frequency | "Which airports do I use most?" |
| `trips` | | Static trip-sequence (no animation) | "How do my flights group into multi-leg trips?" |

### Cruises

| Mode | Default | Shape | What question it answers |
|---|---|---|---|
| `sea-routes` | ✅ | Hybrid-v2 polylines between port stops | "Where did each cruise sail?" |
| `itinerary` | | Stops as numbered markers + sea-day icons | "What's the chronology of a cruise?" |
| `port-frequency` | | Port markers scaled by repeat visits | "Which ports appear again across cruises?" |

### POIs

| Mode | Default | Shape | What question it answers |
|---|---|---|---|
| `markers` | ✅ | Category-coloured icons | "What did I visit, where?" |
| `heatmap` | | Visit density | "Which neighbourhoods did I cover?" |

### All

| Mode | Default | Shape | What question it answers |
|---|---|---|---|
| `overview` | ✅ | Cruises + Flights layered (plus POIs when domain active) | "Everything I've done, at one glance" |
| `heatmap` | | Aggregated event density across domains | "My overall travel footprint" |
| `journey` | | A selected cross-domain trip rendered as one story | "Show me my trip X from flight-out to flight-home" |
| `globe` | | 3D globe view of the current overlay | Showcase / long-haul sense of scale |

### Layer order + popup hit-test in `All` overview

Bottom to top: Cruise sea-routes → Flight arcs → POI markers (when
enabled). Popup-hit-testing uses the same order; the first layer hit
wins. Documented in component comments so layer additions later don't
shuffle behaviour by accident.

---

## Layout

### Controls bar (top of map, below tab strip)

- **Mode dropdown** — scoped to the active tab's mode list
- **Filter dropdown** — top section is a time-range slider (global state);
  remaining fields are domain-specific (e.g. Airline for Flights, Cruise-Line
  + Status for Cruises, Category for POIs)
- **Primary-Add button** (top-right) — domain-aware:
  - Flights tab → `+ Flug hinzufügen` (opens existing flight-form)
  - Cruises tab → `+ Kreuzfahrt hinzufügen` (opens cruise edit modal)
  - POIs tab → `+ POI hinzufügen` (only when domain enabled)
  - All tab → `+ Hinzufügen ▾` opens a small picker listing the enabled
    domains, then routes to the selected domain's add UI

### Left sidebar

- Toggled by a single icon in the controls bar
- Content swaps based on active tab:
  - Flights → recent flights (list component already exists)
  - Cruises → recent cruises
  - POIs → recent POIs (empty-state when domain disabled)
  - All → unified activity feed: N most recent events across enabled
    domains, sorted by date descending, each row typed with a small icon
- Open/closed state is preserved across tab switches; user opens it once,
  it stays open when they switch tabs

### Right sidebar

Removed from the dashboard. Existing `Stats`-component sites:
- Still used on `/stats` (advanced stats page) — no change there
- Dashboard stops importing it; the toggle button + panel scaffolding
  are deleted

### Empty states per tab

- **Flights / Cruises / POIs** — "Noch keine X. Füge deine erste X hinzu."
  (existing flight empty state, generalised). The Add-button remains
  primary.
- **POIs tab while POI domain is disabled** — Card: "POIs sind noch nicht
  aktiviert. Aktiviere die Domain unter Einstellungen → Domains." Link
  to `/settings#domains`. No add button.
- **All** — If the user has zero events across all enabled domains, show
  a stacked card for each enabled domain with its own add button.

---

## State management

### URL sync

Single source of truth for active view. Precedence when computing the
initial render state:

1. **URL** — `:tab/:mode` from the route
2. **localStorage** — last mode for that domain (if URL mode is absent)
3. **Domain default** — hard-coded constant

Writing the URL:
- Tab change → `navigate('/dashboard/<tab>')` (no `?mode` query; we
  defer to localStorage/default so the URL stays clean)
- Mode change → `navigate('/dashboard/<tab>?mode=<mode>', { replace: true })`
- Filter change → no URL change (filters are ephemeral; not worth
  bookmarking state)

Browser back/forward behaves correctly because every tab/mode change
pushes or replaces a history entry.

### localStorage shape

```json
{
  "travstats:dashboard:lastMode": {
    "flight": "heatmap",
    "cruise": "itinerary",
    "poi": "markers",
    "all": "overview"
  },
  "travstats:dashboard:leftSidebarOpen": true
}
```

Migration policy: on read, unknown/obsolete mode values (e.g. `hexagon`,
`contour`, `columns`) silently fall back to the domain default. No
explicit migration script; a single localStorage write after the next
user interaction naturalises the state.

### Filter state

- **Time range** (global) — single `{from, to}` Zustand slice; applies
  to every layer in every tab. Each layer interprets it against its own
  date field:
  - Flight → `date` equals any day in `[from, to]`
  - Cruise → `startDate..endDate` intersects `[from, to]` non-empty
  - POI → `visitDate` in `[from, to]`
- **Domain-specific filters** (per-tab) — Zustand slices keyed by
  domain: `filters.flight`, `filters.cruise`, `filters.poi`. Switching
  tabs never mutates another tab's filter slice.

### When URL or localStorage has a stale or invalid mode

- Unknown mode name → fallback to domain default; log a
  `logger.warn({ operation: 'dashboard_unknown_mode', mode })` so future
  removals can be observed
- Unknown tab name → redirect to `/dashboard`

---

## Data flow

Per active tab the dashboard loads exactly the data that its modes can
render:

| Tab | Queries on mount |
|---|---|
| Flights | `flightsApi.getAll({ ...filters })` + cached stats summary |
| Cruises | `cruiseApi.list({ ...filters })` with stops eagerly included |
| POIs | `poisApi.list({ ...filters })` (future; skipped when domain disabled) |
| All | All enabled domains queried in parallel; results composed for overview/heatmap/journey modes |

Mode-level derived data is computed client-side:

- `stats-map` → reduce `flights[]` to `{airport -> count}`
- `port-frequency` → reduce `cruise.stops[]` over all cruises to `{portId -> count}`
- `journey` → given a selected `tripId`, filter flights + cruises by `tripId`, render as one polyline with styled segments
- `overview` → each domain's layer rendered in its own component; see layer-order rule above
- `heatmap` (All) → concatenate events from each enabled domain into
  `{lat, lon, weight}` rows and feed to the existing heatmap layer

If the data volume grows to the point where a client-side reduction
stutters (e.g. thousands of port-stops), a backend aggregation endpoint
is the right next step — out of scope here.

---

## Backend impact

Reference guideline (Codex critique #4): "keine neuen Endpunkte".

- No new backend routes created by this refactor
- `statsApi.getSummary()` may receive an additive field if the
  stats-map mode needs something already 90% computed server-side; any
  addition is backward-compatible (new optional field)
- Existing sea-router, cruise CRUD, flight CRUD, stats API untouched

---

## Out of scope (YAGNI)

- POI schema, backend, list page, parser — a separate planned workstream
- Cruise-Comparison feature on `/cruises` — planned separately after
  this refactor lands
- Cruise-booking-mail parser (Phase 9 of the earlier cruise plan) — user
  explicitly deferred
- Server-side aggregations for the new modes — client-side is enough at
  current data volumes
- Internationalisation of new UI strings in languages other than de + en

---

## Migration / removal

- Delete the cruise pill added in commit `44b2951`:
  `frontend/src/pages/DashboardPage.tsx` (cruise state + cruise `<Link>`
  pill)
  `frontend/src/i18n/resources/{de,en}/dashboard.json` keys
  (`cruises`, `cruisesTitle`, `cruiseNext`, `cruiseNoneUpcoming`) —
  either removed or reused by the new tab strip
- `VisMode` type is rewritten as per-domain mode unions (see the
  Component plan below). The global `VisMode` union is deleted.
  Modes that survive: `routes`, `heatmap`, `stats-map`, `trips`,
  `sea-routes`, `itinerary`, `port-frequency`, `markers`, `overview`,
  `journey`, `globe`. Modes deleted outright: `hexagon`, `contour`,
  `columns`, `trip-routes`. The `trips` mode is kept but loses its
  animated time-slider — it renders as a static trip-sequence overlay
- Right-sidebar Stats-toggle button and panel scaffolding in
  `DashboardPage.tsx` deleted (not moved; component is still used by
  `/stats`)
- Map-mode picker is replaced by a new `DashboardControlsBar` component
  that reads the active tab's mode list from a central registry

---

## Component plan (rough shape, for the implementation plan to flesh out)

- `frontend/src/pages/DashboardPage.tsx` — slimmed down to routing +
  active-tab detection; delegates everything else
- `frontend/src/hooks/useDashboardRoute.ts` — URL ↔ state binding, the
  precedence rule, localStorage write-through
- `frontend/src/hooks/useDashboardFilters.ts` — Zustand store with
  `time` (global) + `perDomain` (keyed) slices
- `frontend/src/components/Dashboard/DomainTabStrip.tsx` — the four
  tabs, active-state styling, counts badges
- `frontend/src/components/Dashboard/DashboardControlsBar.tsx` — mode
  dropdown + filter dropdown + primary-add button
- `frontend/src/components/Dashboard/tabs/{AllTab,FlightsTab,CruisesTab,PoiTab}.tsx` —
  one thin wrapper per tab, delegates to the shared map + sidebar
- `frontend/src/components/Dashboard/sidebars/{FlightListPanel,CruiseListPanel,PoiListPanel,UnifiedActivityPanel}.tsx`
- `frontend/src/components/Dashboard/modes/` — one file per mode; each
  exports a deck.gl-layer factory
- `frontend/src/types/dashboard.ts` — `DashboardTab`, `DashboardMode`,
  `TabModeRegistry` types

The existing `VisMode` type is kept as an internal-facing union that
the mode registry reuses; it's no longer a single global enum.

---

## Testing strategy

Unit tests (Vitest):
- `useDashboardRoute` — URL precedence rules, unknown mode/tab handling,
  browser back/forward, localStorage read/write round-trip, migration
  of obsolete mode values
- `useDashboardFilters` — time-range shared across tabs, per-domain
  slice isolation, time-semantics per domain (flight date equality,
  cruise range overlap, POI date equality)
- Mode reducer helpers — `stats-map`, `port-frequency`, `journey`

Component tests (Vitest + testing-library):
- `DomainTabStrip` — active state, count badge, gating on disabled
  domains (POI)
- `DashboardControlsBar` — mode list scoped to active tab, primary-add
  picker behaviour on All tab
- Empty states per tab — disabled POI state, no-data per domain state

E2E (Playwright):
- Happy path: open dashboard, tab-switch All → Cruises → Flights, mode
  change, filter change, URL updates, reload restores
- Deep link: visit `/dashboard/cruises?mode=itinerary` directly, see
  correct tab + mode active
- Back/forward: three tab switches, press back twice, arrive at
  original tab + mode
- Add flow: from All tab, click `+ Hinzufügen`, pick "Flug", flight-form
  opens
- POI coming-soon: with POI domain disabled, click POI tab, see the
  "aktivieren"-card

---

## Known risks / open follow-ups

- **Layer composition cost in `All` overview**: deck.gl handles 10k+
  features fine, but a user with 1000+ flights plus several cruises may
  see first-paint take longer than the current flight-only dashboard.
  Mitigation: the existing zoom-level-based feature culling already
  helps; monitor during implementation.
- **Journey mode needs at least one `tripId` shared between a flight
  and a cruise** to demonstrate its value. During implementation we'll
  seed a sample tripId in the dev DB for manual testing.
- **Time-semantics for cruises** is intervals, not points. Needs a
  helper (`intervalOverlapsRange`) with unit tests; edge cases:
  open-ended `endDate`, `endDate` before `startDate` (data bug).
- **Globe mode is now only in `All`**: users who relied on
  per-domain globe may miss it. If this turns out to be a regression in
  practice, we add globe back per-domain as a low-cost follow-up.
- **Mobile viewports** weren't part of the brainstorm. Current
  dashboard is desktop-first; the tab strip has to wrap gracefully or
  scroll horizontally on narrow screens. Playwright test should cover
  a mobile viewport.

---

## Next step

Invoke the `writing-plans` skill to turn this design into an executable
implementation plan.
