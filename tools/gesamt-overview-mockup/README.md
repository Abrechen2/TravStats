# Gesamt-Tab Mockup

Standalone, browser-only mockup of the proposed multi-domain Gesamt tab
(`/stats?tab=all`). Used to align on layout + interaction model before
touching `AdvancedStatsPage.tsx` or building the real adapters.

Open `index.html` directly in any modern browser — no build, no server
needed. React 18 + Babel via CDN, all stub data inline.

## What to evaluate

1. **Cross-domain KPI strip** — totals across enabled domains.
2. **Activity-per-year chart** — stacked by domain, restacks when you
   toggle the chips.
3. **Active-days heatmap** — cell color = dominant domain, hover for
   the breakdown.
4. **Per-domain summary cards** — compact, drill-down link points back
   to the per-domain tab.
5. **"Hotels + POIs simulieren"** toggle (top-right banner) — flips
   `available=true` for the future domains so you can see the layout
   under V2.X without touching real code.

## Not in this mockup

- Real i18n (DE strings inlined; final code uses `useTranslation`)
- Backend wiring (data is stubbed in-file)
- Year filter / comparison (lives on the Flug tab in the real impl)
- Failure-state visuals beyond the placeholder cards

## After approval

Mockup gets dropped, then:

1. `frontend/src/lib/stats/domain-stats/` — types + adapters + hook
2. `frontend/src/components/Stats/Overview/` — real components
3. `AdvancedStatsPage.tsx` — `filter === 'all'` branch swaps to
   `<OverviewTab />`; flight deep-dives stay behind `filter === 'flight'`.
