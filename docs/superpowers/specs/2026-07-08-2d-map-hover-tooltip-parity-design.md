# 2D map hover-tooltip parity with the Globe

**Status:** approved 2026-07-08 · **Target:** v2.3 beta · **Branch:** `dev/v2.3`

## Goal

The 2D flat map's hover tooltips (airports, ports, flight routes) show only
plain text — no flag, no ICAO, no city/country. The Globe's hover tooltips
already show all of that. Bring the flat map up to the same content, using
the exact same shared helpers Globe already uses, so both surfaces genuinely
have the same functions (owner's explicit ask).

## Root cause

The flat map's data objects never carry the fields needed to render them:

- `PointDatum` (airports, `layers/layerTypes.ts`) has `position/count/name/iata/lastVisit`
  — no `icao`, `country`, `city`.
- `ArcDatum` (routes, `layers/layerTypes.ts`) has no departure/arrival identity
  at all — only positions, colors, and flight-aggregate flags.
- The cruise-ports `PortDatum` (local to `layers/cruisePortsLayer.ts`) has no
  `country`/`city`.

The renderer (`components/map/markerTooltip.ts`) can't show what it never
receives. Globe's equivalent (`GlobeView.tsx`'s `onAirportHover` /
`onPortHover` / `onArcHover`) already builds the richer HTML via
`flagImgHtml()` / `countryName()` from `lib/countryFlag.tsx` — a shared,
already-exported helper, not Globe-specific.

## Non-goals (YAGNI)

- No change to the *click* tooltips (`AirportTooltip.tsx` on the flat map,
  `PinnedCard.tsx` on Globe) — those already show the flag/rich info on both
  surfaces.
- No visual/style redesign — mirror Globe's existing HTML structure and
  inline styles exactly, don't invent a new look.
- Cruise-route (ship path) hover on Globe is trivial (`onCruisePathHover`:
  just the cruise label, no flag) — bring the flat map to that same trivial
  level if it's missing, nothing richer.

## A. Airport hover parity

`layers/layerTypes.ts` — add to `PointDatum`:
```ts
icao?: string;
country?: string | null;
city?: string | null;
```

`layers/routesLayer.ts` `buildAirportPoints` — populate the three new fields
from `dep`/`arr` (`AirportProps`) alongside the existing `name`/`iata`.

`components/map/markerTooltip.ts`:
- Extend the local `AirportDatum` interface with `icao?`/`country?`/`city?`.
- `renderAirportHtml` gains a flag + ICAO-pill header line and a city/country
  line, matching `GlobeView.onAirportHover`'s HTML byte-for-byte (same
  `flagImgHtml`/`countryName` calls, same inline styles) — only the shell
  (`SURFACE_STYLE` vs Globe's `HoverTooltip` box) differs, which already
  exists and is unchanged.

## B. Port hover parity

`layers/cruisePortsLayer.ts` — add `country?: string | null` and
`city?: string | null` to the local `PortDatum`; populate them in
`recordVisit` from `port.country`/`port.city`.

`components/map/markerTooltip.ts`:
- Extend the local `PortDatum` interface with `country?`/`city?`.
- `renderPortHtml` gains a flag (falls back to ⚓ when no country) and a
  city/country line, matching `GlobeView.onPortHover`.

## C. Route/arc hover (new on the flat map — doesn't exist today)

`layers/layerTypes.ts` — add to `ArcDatum`:
```ts
departure: { iata?: string; icao?: string; name?: string; city?: string | null; country?: string | null };
arrival: { iata?: string; icao?: string; name?: string; city?: string | null; country?: string | null };
```
(same shape as Globe's `globeLayerTypes.ArcDatum`).

`layers/routesLayer.ts`:
- `RouteRecord` gains `depAirport`/`arrAirport` (first-seen descriptive
  snapshot, same pattern as the existing first-seen `depCoord`/`arrCoord`).
- `aggregateAllRoutes` captures the descriptive info the first time a route
  key is seen.
- `buildArcs` threads `departure`/`arrival` onto each returned `ArcDatum`.

`components/map/markerTooltip.ts`:
- New `ARC_LAYER_IDS` set (the flat-map route-arc layer's id(s), matched the
  same way `AIRPORT_LAYER_IDS`/`PORT_LAYER_IDS` are).
- New `renderArcHtml`, mirroring `GlobeView.onArcHover`: flag + IATA + name
  per endpoint, then "N× geflogen" in the route's color.

## Testing

Every touched function is pure (data builders + HTML renderers) — no browser
needed:

- `buildAirportPoints`/`buildArcs`/the port builder: assert the new fields
  are populated when present on the source data and omitted (not present /
  undefined) when the source lacks them.
- `renderAirportHtml`/`renderPortHtml`/`renderArcHtml`: assert the output
  HTML contains the flag `<img>` tag, ICAO pill, and place line when data is
  present, and degrades gracefully (no empty flag `<img>`, no dangling
  separator) when country/city/icao are missing — mirrors the existing
  null-safe pattern already in the file (e.g. `lastVisit` line is omitted
  entirely when absent, not rendered empty).

## Shipping

Implement on `dev/v2.3`. Full build checks (backend + frontend tsc/lint/
tests) before deploy. Ship as a new **beta** build to CT 106 (not a new RC —
the RC already cut today, 2.3.0-rc.1, stays as-is pending promotion; this
lands in the *next* beta and rides along whenever v2.3 gets re-RC'd).
