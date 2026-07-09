# 2D Map Hover-Tooltip Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the flat 2D map's hover tooltips (airports, ports, flight routes, cruise routes) up to the same content the Globe already shows — flag image, ICAO code, city/country — using the same shared helpers Globe uses.

**Architecture:** The flat map's tooltip factory (`createMarkerTooltip` in `components/map/markerTooltip.ts`) builds a raw HTML string per hovered deck.gl object, the same mechanism Globe uses (`GlobeView.tsx`'s `onAirportHover`/`onPortHover`/`onArcHover`, rendered via `HoverTooltip`'s `dangerouslySetInnerHTML`). The flat map's underlying data objects (`PointDatum`, `PortDatum`, `ArcDatum`) just never carried `icao`/`country`/`city`/departure-arrival identity. This plan threads those fields through the data builders, then mirrors Globe's exact HTML structure in the renderer, reusing the already-shared `flagImgHtml()`/`countryName()` helpers from `lib/countryFlag.tsx`.

**Tech Stack:** React, TypeScript (strict), deck.gl, Vitest.

## Global Constraints

- TypeScript `strict: true` — no `any` (use `unknown` + type guards).
- Double-quoted strings, Prettier printWidth 100 (existing file convention).
- No new i18n keys needed — `map:globe.flight`, `map:tooltip.lastVisit`, `map:airportMarkers.visits`, `map:tooltip.lastCall`, `map:globe.timesFlown` all already exist (used by `GlobeView.tsx`) and are reused as-is.
- Async/await only, no `.then()` (not applicable — this plan touches only synchronous pure functions).
- Immutable updates — spread, no in-place mutation of existing objects.
- File size stays under the 800-line hard max for every touched file (all touched files are currently well under it).

---

### Task 1: Airport point data — carry icao/country/city

**Files:**
- Modify: `frontend/src/components/layers/layerTypes.ts` (`PointDatum` interface, lines 24-32)
- Modify: `frontend/src/components/layers/routesLayer.ts` (`buildAirportPoints`, lines 240-268)
- Test: `frontend/src/__tests__/layers/routesLayer.test.ts`

**Interfaces:**
- Produces: `PointDatum.icao?: string`, `PointDatum.country?: string | null`, `PointDatum.city?: string | null` — consumed by Task 2 (tooltip renderer) and already consumed as-is elsewhere (label/marker layers ignore the new optional fields).

- [ ] **Step 1: Write the failing test**

Add this test inside the existing `describe("buildRouteData", ...)` block in `frontend/src/__tests__/layers/routesLayer.test.ts` (add it right after the `"returns arcs and points from flights"` test, around line 38):

```ts
  it("carries icao/country/city onto airport points when present on the source flight", () => {
    const flightWithGeo: GeoJSONFeature = {
      ...mockFlight,
      properties: {
        ...mockFlight.properties,
        id: "geo-points-1",
        departureAirport: {
          iata: "FRA",
          icao: "EDDF",
          name: "Frankfurt",
          country: "DE",
          city: "Frankfurt",
          lat: 50.03,
          lon: 8.57,
        },
        arrivalAirport: {
          iata: "JFK",
          icao: "KJFK",
          name: "New York",
          country: "US",
          city: "New York",
          lat: 40.64,
          lon: -73.78,
        },
      },
    };
    const { points } = buildRouteData([flightWithGeo], 1);
    const fra = points.find((p) => p.iata === "FRA");
    const jfk = points.find((p) => p.iata === "JFK");
    expect(fra).toMatchObject({ icao: "EDDF", country: "DE", city: "Frankfurt" });
    expect(jfk).toMatchObject({ icao: "KJFK", country: "US", city: "New York" });
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/__tests__/layers/routesLayer.test.ts -t "carries icao/country/city"
```

Expected: FAIL — `fra`/`jfk` won't have `icao`/`country`/`city` (currently `undefined`), so `toMatchObject` fails.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/components/layers/layerTypes.ts`, replace the `PointDatum` interface (lines 24-32):

```ts
export interface PointDatum {
  position: [number, number];
  count: number;
  name: string;
  iata: string;
  /** ICAO code, when known — drives the ICAO pill in the hover tooltip. */
  icao?: string;
  /** ISO 3166-1 alpha-2 country code — drives the flag in the hover tooltip. */
  country?: string | null;
  /** City the airport serves — shown in the hover tooltip's place line. */
  city?: string | null;
  /** ISO date of the most recent flight touching this airport.
   *  Surfaced in the hover tooltip alongside the visit count. */
  lastVisit?: string;
}
```

In `frontend/src/components/layers/routesLayer.ts`, in `buildAirportPoints`, replace the two `airportMap.set(...)` initial-creation calls (lines 253-266):

```ts
    if (!airportMap.has(depKey)) {
      airportMap.set(depKey, {
        position: coords.depCoord,
        count: 0,
        name: dep.name ?? airportLabel(dep),
        iata: airportLabel(dep),
        icao: dep.icao,
        country: dep.country,
        city: dep.city,
      });
    }
    if (!airportMap.has(arrKey)) {
      airportMap.set(arrKey, {
        position: coords.arrCoord,
        count: 0,
        name: arr.name ?? airportLabel(arr),
        iata: airportLabel(arr),
        icao: arr.icao,
        country: arr.country,
        city: arr.city,
      });
    }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest run src/__tests__/layers/routesLayer.test.ts
```

Expected: PASS — all tests in the file, including the new one.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/layers/layerTypes.ts frontend/src/components/layers/routesLayer.ts frontend/src/__tests__/layers/routesLayer.test.ts
git commit -m "feat(map): carry icao/country/city onto flat-map airport points"
```

---

### Task 2: Airport hover tooltip — flag, ICAO pill, place line

**Files:**
- Modify: `frontend/src/components/map/markerTooltip.ts`
- Test: `frontend/src/components/map/markerTooltip.test.ts` (new file)

**Interfaces:**
- Consumes: `PointDatum` shape from Task 1 (structurally — this file redefines its own local `AirportDatum` rather than importing, per its existing "portable across every flat-map surface" design).
- Produces: nothing new consumed by later tasks — Task 6/7 add sibling branches to the same `createMarkerTooltip` factory but don't depend on this task's internals.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/map/markerTooltip.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import type { PickingInfo } from "@deck.gl/core";
import { createMarkerTooltip } from "./markerTooltip";

const t = (key: string, opts?: Record<string, unknown>): string => {
  if (key === "map:globe.flight") return (opts?.count as number) === 1 ? "Flug" : "Flüge";
  if (key === "map:tooltip.lastVisit") return "Letzter Besuch";
  if (key === "map:airportMarkers.visits") return "Besuche";
  if (key === "map:tooltip.lastCall") return "Letzter Anlauf";
  if (key === "map:globe.timesFlown") return `${opts?.count}× geflogen`;
  return key;
};

function makeInfo(layerId: string, object: unknown): PickingInfo {
  return { layer: { id: layerId }, object } as unknown as PickingInfo;
}

describe("createMarkerTooltip — airports", () => {
  const getTooltip = createMarkerTooltip(t, "de");

  it("includes a flag image, ICAO pill, and place line when data is present", () => {
    const result = getTooltip(
      makeInfo("routes-dot", {
        iata: "MUC",
        icao: "EDDM",
        name: "Munich Airport",
        country: "DE",
        city: "Munich",
        count: 115,
        lastVisit: "2026-10-19",
      })
    );
    expect(result).not.toBeNull();
    expect(result!.html).toContain("flagcdn.com/de.svg");
    expect(result!.html).toContain("EDDM");
    expect(result!.html).toContain("Munich, Deutschland");
    expect(result!.html).toContain("115");
  });

  it("degrades gracefully when country/icao/city are absent", () => {
    const result = getTooltip(
      makeInfo("routes-labels", {
        iata: "XYZ",
        name: "Test Field",
        count: 3,
      })
    );
    expect(result).not.toBeNull();
    expect(result!.html).not.toContain("flagcdn.com");
    expect(result!.html).not.toContain("undefined");
    expect(result!.html).not.toContain("null");
  });

  it("returns null for an unrelated layer id", () => {
    expect(getTooltip(makeInfo("some-other-layer", {}))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/components/map/markerTooltip.test.ts
```

Expected: FAIL — first test fails because the current `renderAirportHtml` never emits a flag image, ICAO pill, or place line.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/components/map/markerTooltip.ts`:

Add the import (below the existing `escapeHtml` import, around line 2):

```ts
import { escapeHtml } from "../../lib/escapeHtml";
import { flagImgHtml, countryName } from "../../lib/countryFlag";
```

Replace the `AirportDatum` interface (lines 26-31):

```ts
interface AirportDatum {
  readonly iata?: string;
  readonly icao?: string;
  readonly name?: string;
  readonly country?: string | null;
  readonly city?: string | null;
  /** Visits / flight count touching this airport. */
  readonly count?: number;
  /** ISO date of the most recent flight touching this airport. */
  readonly lastVisit?: string;
}
```

Replace `renderAirportHtml` (lines 119-144):

```ts
function renderAirportHtml(d: AirportDatum, heading: string, t: TFn, locale: string): string {
  const name = d.name && d.name !== heading ? d.name : null;
  const count = typeof d.count === "number" && d.count > 0 ? d.count : null;
  const lastVisit = d.lastVisit ?? null;
  const icaoPill = d.icao
    ? `<span style="font-size:10px;font-family:monospace;color:rgba(241,245,249,0.5);background:rgba(255,255,255,0.06);border-radius:4px;padding:1px 5px;">${escapeHtml(d.icao)}</span>`
    : "";
  const place = [d.city, countryName(d.country, locale)].filter(Boolean).join(", ");

  const lines: string[] = [];
  lines.push(
    `<div style="display:flex;align-items:center;gap:8px;font-weight:600;">${flagImgHtml(d.country, 16)}<span>${escapeHtml(heading)}</span>${icaoPill}</div>`
  );
  if (name) {
    lines.push(
      `<div style="opacity:0.85;font-size:11px;margin-top:2px;">${escapeHtml(name)}</div>`
    );
  }
  if (place) {
    lines.push(
      `<div style="opacity:0.62;font-size:10.5px;margin-top:2px;">${escapeHtml(place)}</div>`
    );
  }
  if (count !== null) {
    lines.push(
      `<div style="color:#fbbf24;margin-top:2px;">${count} ${escapeHtml(
        t("map:globe.flight", { count })
      )}</div>`
    );
  }
  if (lastVisit) {
    lines.push(
      `<div style="opacity:0.75;font-size:10.5px;margin-top:3px;">${escapeHtml(
        t("map:tooltip.lastVisit")
      )}: ${escapeHtml(formatDate(lastVisit, locale))}</div>`
    );
  }
  return lines.join("");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest run src/components/map/markerTooltip.test.ts
```

Expected: PASS — all 3 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/map/markerTooltip.ts frontend/src/components/map/markerTooltip.test.ts
git commit -m "feat(map): flat-map airport hover tooltip shows flag/ICAO/place (parity with globe)"
```

---

### Task 3: Cruise-port point data — carry country/city

**Files:**
- Modify: `frontend/src/components/layers/cruisePortsLayer.ts` (local `PortDatum` interface, lines 7-20; `recordVisit`, lines 73-90)
- Test: `frontend/src/components/layers/cruisePortsLayer.test.ts` (new file)

**Interfaces:**
- Produces: `PortDatum.country?: string | null`, `PortDatum.city?: string | null` on the `cruise-ports`/`cruise-ports-ring`/`cruise-ports-labels` layer data — consumed by Task 4.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/layers/cruisePortsLayer.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { createCruisePortsLayer } from "./cruisePortsLayer";
import type { Cruise } from "../../types";

function makeStop(
  dayNumber: number,
  port: { id: number; lat: number; lon: number; name: string; country: string | null; city: string | null }
): Cruise["stops"][number] {
  const base = {
    id: `s${dayNumber}`,
    cruiseId: "c1",
    portId: port.id,
    port: {
      id: port.id,
      name: port.name,
      city: port.city,
      country: port.country,
      unlocode: null,
      lat: port.lat,
      lon: port.lon,
      timezone: null,
      region: null,
      isUserAdded: false,
    },
    dayNumber,
    isAtSea: false,
    arrivalTime: null,
    departureTime: null,
    excursionNote: null,
  };
  return base as Cruise["stops"][number];
}

function makeCruise(stops: Cruise["stops"]): Cruise {
  return {
    id: "c1",
    userId: "u1",
    shipId: null,
    ship: null,
    shipNameOverride: null,
    cruiseLine: "AIDA Cruises",
    routeName: null,
    departurePortId: null,
    departurePort: null,
    arrivalPortId: null,
    arrivalPort: null,
    startDate: null,
    endDate: null,
    status: "scheduled",
    cabinNumber: null,
    cabinType: null,
    deck: null,
    bookingReference: null,
    price: null,
    currency: null,
    notes: null,
    tags: [],
    companions: [],
    tripId: null,
    bookingId: null,
    stops,
    createdAt: "",
    updatedAt: "",
  };
}

describe("createCruisePortsLayer", () => {
  it("carries country/city onto the port dot layer data", () => {
    const cruise = makeCruise([
      makeStop(1, { id: 1, lat: 41.9, lon: 12.45, name: "Civitavecchia", country: "IT", city: "Civitavecchia" }),
      makeStop(2, { id: 2, lat: 37.98, lon: 23.72, name: "Piraeus", country: "GR", city: "Athens" }),
    ]);
    const layers = createCruisePortsLayer([cruise]);
    expect(layers).not.toBeNull();
    const dotLayer = layers!.find((l) => l.id === "cruise-ports");
    expect(dotLayer).toBeDefined();
    const data = (dotLayer as { props: { data: unknown } }).props.data as Array<{
      name: string;
      country: string | null;
      city: string | null;
    }>;
    const civitavecchia = data.find((d) => d.name === "Civitavecchia");
    expect(civitavecchia).toMatchObject({ country: "IT", city: "Civitavecchia" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/components/layers/cruisePortsLayer.test.ts
```

Expected: FAIL — `civitavecchia` currently has no `country`/`city` keys, so `toMatchObject` fails.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/components/layers/cruisePortsLayer.ts`, replace the `PortDatum` interface (lines 7-20):

```ts
interface PortDatum {
  position: [number, number];
  portId: number;
  name: string;
  /**
   * Readable label rendered on the marker — the port name, lightly
   * normalised + truncated via `toPortLabel`. Airports show their IATA
   * code, but UN/LOCODEs ("ITCVV") mean nothing to users, so ports show
   * the real name instead.
   */
  shortLabel: string;
  /** ISO 3166-1 alpha-2 country code — drives the flag in the hover tooltip. */
  country?: string | null;
  /** City the port serves — shown in the hover tooltip's place line. */
  city?: string | null;
  visits: number;
  /** ISO date of the most recent stop at this port (max of
   *  stop.arrivalTime across cruises). Surfaced in the hover tooltip. */
  lastVisit?: string;
}
```

Replace the `else` branch inside `recordVisit` (lines 80-88):

```ts
    } else {
      byPort.set(port.id, {
        position: [port.lon, port.lat],
        portId: port.id,
        name: port.name,
        shortLabel: toPortLabel(port.name),
        country: port.country,
        city: port.city,
        visits: 1,
        lastVisit: date,
      });
    }
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest run src/components/layers/cruisePortsLayer.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/layers/cruisePortsLayer.ts frontend/src/components/layers/cruisePortsLayer.test.ts
git commit -m "feat(map): carry country/city onto flat-map cruise-port points"
```

---

### Task 4: Port hover tooltip — flag, place line

**Files:**
- Modify: `frontend/src/components/map/markerTooltip.ts`
- Test: `frontend/src/components/map/markerTooltip.test.ts`

**Interfaces:**
- Consumes: `PortDatum` shape from Task 3 (structurally, via the file's own local `PortDatum` interface).

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/components/map/markerTooltip.test.ts`, as a new top-level `describe` block after the airports one:

```ts
describe("createMarkerTooltip — ports", () => {
  const getTooltip = createMarkerTooltip(t, "de");

  it("includes a flag and place line when country/city are present", () => {
    const result = getTooltip(
      makeInfo("cruise-ports", {
        name: "Civitavecchia",
        shortLabel: "Civitavecchia",
        country: "IT",
        city: "Civitavecchia",
        visits: 4,
        lastVisit: "2024-05-01",
      })
    );
    expect(result).not.toBeNull();
    expect(result!.html).toContain("flagcdn.com/it.svg");
    expect(result!.html).toContain("Civitavecchia, Italien");
    expect(result!.html).toContain("4");
  });

  it("falls back to the anchor glyph when country is absent", () => {
    const result = getTooltip(
      makeInfo("cruise-ports-labels", {
        name: "Unnamed Port",
        shortLabel: "Unnamed Port",
        visits: 1,
      })
    );
    expect(result).not.toBeNull();
    expect(result!.html).not.toContain("flagcdn.com");
    expect(result!.html).toContain("⚓");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/components/map/markerTooltip.test.ts -t "createMarkerTooltip — ports"
```

Expected: FAIL — current `renderPortHtml` never emits a flag or place line, and the anchor glyph is always shown (not conditional), so the second assertion in test 1 (`not.toContain("flagcdn.com")` is fine, but `toContain("Civitavecchia, Italien")` fails).

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/components/map/markerTooltip.ts`, replace the `PortDatum` interface (lines 33-45):

```ts
interface PortDatum {
  readonly name?: string;
  readonly shortLabel?: string;
  /** UN/LOCODE for globe-port-dots — the globe carries it as `iata`
   *  while the flat map carries it as `shortLabel`. */
  readonly iata?: string;
  readonly country?: string | null;
  readonly city?: string | null;
  /** Visits / cruise-stop count at this port. */
  readonly visits?: number;
  /** Globe carries the same number as `size` instead of `visits`. */
  readonly size?: number;
  /** ISO date of the most recent stop at this port. */
  readonly lastVisit?: string;
}
```

Replace `renderPortHtml` (lines 146-176):

```ts
function renderPortHtml(d: PortDatum, heading: string, t: TFn, locale: string): string {
  const sub =
    d.shortLabel && d.shortLabel !== heading
      ? d.shortLabel
      : d.iata && d.iata !== heading
        ? d.iata
        : null;
  const visits = d.visits ?? d.size ?? null;
  const lastCall = d.lastVisit ?? null;
  const place = [d.city, countryName(d.country, locale)].filter(Boolean).join(", ");
  const flagOrAnchor = d.country ? flagImgHtml(d.country, 16) : "⚓";

  const lines: string[] = [];
  lines.push(
    `<div style="display:flex;align-items:center;gap:8px;font-weight:600;">${flagOrAnchor}<span>${escapeHtml(heading)}</span></div>`
  );
  if (sub) {
    lines.push(
      `<div style="opacity:0.85;font-size:11px;margin-top:2px;">${escapeHtml(sub)}</div>`
    );
  }
  if (place) {
    lines.push(
      `<div style="opacity:0.62;font-size:10.5px;margin-top:2px;">${escapeHtml(place)}</div>`
    );
  }
  if (visits !== null && visits > 0) {
    lines.push(
      `<div style="color:#7dd3fc;margin-top:2px;">${visits} ${escapeHtml(
        t("map:airportMarkers.visits")
      )}</div>`
    );
  }
  if (lastCall) {
    lines.push(
      `<div style="opacity:0.75;font-size:10.5px;margin-top:3px;">${escapeHtml(
        t("map:tooltip.lastCall")
      )}: ${escapeHtml(formatDate(lastCall, locale))}</div>`
    );
  }
  return lines.join("");
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest run src/components/map/markerTooltip.test.ts
```

Expected: PASS — all tests in the file (airports + ports).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/map/markerTooltip.ts frontend/src/components/map/markerTooltip.test.ts
git commit -m "feat(map): flat-map port hover tooltip shows flag/place (parity with globe)"
```

---

### Task 5: Route/arc data — carry departure/arrival identity

**Files:**
- Modify: `frontend/src/components/layers/layerTypes.ts` (`ArcDatum` interface, lines 3-22)
- Modify: `frontend/src/components/layers/routesLayer.ts` (`RouteRecord` lines 76-94, `aggregateAllRoutes` lines 96-127, `buildArcs` lines 210-227)
- Test: `frontend/src/__tests__/layers/routesLayer.test.ts`

**Interfaces:**
- Produces: `ArcDatum.departure`/`ArcDatum.arrival: { iata?, icao?, name?, city?, country? }` — consumed by Task 6.

- [ ] **Step 1: Write the failing test**

Add to the `describe("buildRouteData", ...)` block in `frontend/src/__tests__/layers/routesLayer.test.ts`:

```ts
  it("carries departure/arrival identity (iata, icao, name, country, city) onto each arc", () => {
    const flightWithGeo: GeoJSONFeature = {
      ...mockFlight,
      properties: {
        ...mockFlight.properties,
        id: "geo-arc-1",
        departureAirport: {
          iata: "FRA",
          icao: "EDDF",
          name: "Frankfurt",
          country: "DE",
          city: "Frankfurt",
          lat: 50.03,
          lon: 8.57,
        },
        arrivalAirport: {
          iata: "JFK",
          icao: "KJFK",
          name: "New York",
          country: "US",
          city: "New York",
          lat: 40.64,
          lon: -73.78,
        },
      },
    };
    const { arcs } = buildRouteData([flightWithGeo], 1);
    expect(arcs).toHaveLength(1);
    expect(arcs[0].departure).toEqual({
      iata: "FRA",
      icao: "EDDF",
      name: "Frankfurt",
      country: "DE",
      city: "Frankfurt",
    });
    expect(arcs[0].arrival).toEqual({
      iata: "JFK",
      icao: "KJFK",
      name: "New York",
      country: "US",
      city: "New York",
    });
  });
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/__tests__/layers/routesLayer.test.ts -t "departure/arrival identity"
```

Expected: FAIL — `arcs[0].departure`/`.arrival` don't exist yet (`undefined`).

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/components/layers/layerTypes.ts`, add to the `ArcDatum` interface (after `isHistorical?: boolean;`, before the closing brace, around line 21):

```ts
  isHistorical?: boolean;
  /** First-seen departure/arrival identity for this canonical route —
   *  drives the flag/ICAO/name shown in the hover tooltip. */
  departure: { iata?: string; icao?: string; name?: string; city?: string | null; country?: string | null };
  arrival: { iata?: string; icao?: string; name?: string; city?: string | null; country?: string | null };
}
```

In `frontend/src/components/layers/routesLayer.ts`, replace the `RouteRecord` interface (lines 76-94):

```ts
interface RouteRecord {
  key: string;
  // First-seen coordinates for this canonical route. Either direction of
  // FRA-MUC vs MUC-FRA collapses to the same record, so the arc uses the
  // first-seen flight's geometry — that's fine for a directionless display.
  depCoord: [number, number];
  arrCoord: [number, number];
  // First-seen departure/arrival identity — surfaced in the hover tooltip.
  depAirport: AirportProps;
  arrAirport: AirportProps;
  count: number;
  flightIds: string[];
  hasUpcoming: boolean;
  // True when at least one flight on this canonical pair has status !==
  // 'scheduled' (i.e. it has actually been flown — flown / cancelled /
  // historical / duplicated all count). Combined with `hasUpcoming` to
  // distinguish "pure-scheduled" (blue) from "mixed" (blue-tipped red).
  hasPastFlown: boolean;
  // True when every flight on this canonical pair is `status: 'historical'`.
  // Used to fade the arc to the dim grey treatment.
  allHistorical: boolean;
}
```

In `aggregateAllRoutes`, replace the `else` (new-record) branch (lines 111-120):

```ts
    } else {
      records.set(key, {
        key,
        depCoord: coords.depCoord,
        arrCoord: coords.arrCoord,
        depAirport: dep,
        arrAirport: arr,
        count: 1,
        flightIds: [f.properties.id],
        hasUpcoming: isScheduled,
        hasPastFlown: !isScheduled,
        allHistorical: isHistorical,
      });
    }
```

In `buildArcs`, replace the `arcs.push({...})` call (lines 216-227):

```ts
    arcs.push({
      sourcePosition: r.depCoord,
      targetPosition: r.arrCoord,
      count: r.count,
      sourceColor: argb,
      targetColor: argb,
      flightIds: r.flightIds,
      hasUpcoming: r.hasUpcoming,
      hasPastFlown: r.hasPastFlown,
      isHistorical: r.allHistorical,
      departure: {
        iata: r.depAirport.iata,
        icao: r.depAirport.icao,
        name: r.depAirport.name,
        city: r.depAirport.city,
        country: r.depAirport.country,
      },
      arrival: {
        iata: r.arrAirport.iata,
        icao: r.arrAirport.icao,
        name: r.arrAirport.name,
        city: r.arrAirport.city,
        country: r.arrAirport.country,
      },
    });
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest run src/__tests__/layers/routesLayer.test.ts
```

Expected: PASS — all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/layers/layerTypes.ts frontend/src/components/layers/routesLayer.ts frontend/src/__tests__/layers/routesLayer.test.ts
git commit -m "feat(map): carry departure/arrival identity onto flat-map route arcs"
```

---

### Task 6: Route/arc hover tooltip (new on the flat map)

**Files:**
- Modify: `frontend/src/components/map/markerTooltip.ts`
- Test: `frontend/src/components/map/markerTooltip.test.ts`

**Interfaces:**
- Consumes: `ArcDatum.departure`/`.arrival`/`.count`/`.sourceColor` from Task 5 (structurally, via a new local `ArcTooltipDatum`).

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/components/map/markerTooltip.test.ts`, as a new top-level `describe` block:

```ts
describe("createMarkerTooltip — routes", () => {
  const getTooltip = createMarkerTooltip(t, "de");

  it("shows flag + iata + name for both endpoints plus times-flown", () => {
    const result = getTooltip(
      makeInfo("routes-arc", {
        departure: { iata: "MUC", name: "Munich Airport", country: "DE" },
        arrival: { iata: "JFK", name: "New York", country: "US" },
        count: 3,
        sourceColor: [240, 169, 71, 220],
      })
    );
    expect(result).not.toBeNull();
    expect(result!.html).toContain("flagcdn.com/de.svg");
    expect(result!.html).toContain("flagcdn.com/us.svg");
    expect(result!.html).toContain("MUC");
    expect(result!.html).toContain("JFK");
    expect(result!.html).toContain("3× geflogen");
  });

  it("returns null when the arc datum has no departure/arrival identity", () => {
    expect(getTooltip(makeInfo("routes-arc-scheduled", { count: 1 }))).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/components/map/markerTooltip.test.ts -t "createMarkerTooltip — routes"
```

Expected: FAIL — `createMarkerTooltip` returns `null` for `"routes-arc"` today (no arc handling exists), so the first test's `result` is `null` and `.not.toBeNull()` fails.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/components/map/markerTooltip.ts`, add a new layer-id set after `PORT_LAYER_IDS` (after line 22):

```ts
const ARC_LAYER_IDS = new Set<string>([
  // Flat-map flight-route arcs (routesLayer)
  "routes-arc",
  "routes-arc-scheduled",
  "routes-arc-upcoming",
]);
```

Add a new interface after `PortDatum` (after line 45):

```ts
interface ArcTooltipDatum {
  readonly departure?: { iata?: string; name?: string; country?: string | null };
  readonly arrival?: { iata?: string; name?: string; country?: string | null };
  readonly count?: number;
  readonly sourceColor?: readonly [number, number, number, number];
}
```

In `createMarkerTooltip`'s returned function, add a new branch after the `PORT_LAYER_IDS` block and before `return null;` (around line 113):

```ts
    if (ARC_LAYER_IDS.has(layerId)) {
      const datum = info.object as ArcTooltipDatum | undefined | null;
      if (!datum || !datum.departure || !datum.arrival) return null;
      const html = renderArcHtml(datum, t);
      return { html, style: SURFACE_STYLE };
    }

    return null;
```

(This replaces the existing bare `return null;` at the end of the function body.)

Add the renderer function after `renderPortHtml` (at the end of the file):

```ts
function renderArcHtml(d: ArcTooltipDatum, t: TFn): string {
  const epLine = (ep?: { iata?: string; name?: string; country?: string | null }): string =>
    `<div style="display:flex;align-items:center;gap:8px;font-weight:600;font-size:13px;padding:1px 0;">
      ${flagImgHtml(ep?.country, 16)}<span>${escapeHtml(ep?.iata ?? "?")}</span>
      <span style="opacity:0.6;font-weight:500;font-size:11px;">${escapeHtml(ep?.name ?? "")}</span>
    </div>`;
  const count = d.count ?? 0;
  const [r, g, b] = d.sourceColor ?? [241, 245, 249, 255];
  return `
    ${epLine(d.departure)}
    ${epLine(d.arrival)}
    <div style="color:rgb(${r},${g},${b});font-weight:600;margin-top:4px;">
      ${escapeHtml(t("map:globe.timesFlown", { count }))}
    </div>`;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest run src/components/map/markerTooltip.test.ts
```

Expected: PASS — all tests in the file (airports + ports + routes).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/map/markerTooltip.ts frontend/src/components/map/markerTooltip.test.ts
git commit -m "feat(map): add flat-map route hover tooltip (flag/iata/name, parity with globe)"
```

---

### Task 7: Cruise-route hover tooltip (new on the flat map, minimal)

**Files:**
- Modify: `frontend/src/components/map/markerTooltip.ts`
- Test: `frontend/src/components/map/markerTooltip.test.ts`

**Interfaces:**
- Consumes: `cruise-arcs` layer data's existing `cruiseLine: string | null` field (from `components/layers/cruiseArcsLayer.ts`'s `ArcDatum`, unmodified — no changes to that file in this plan).

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/components/map/markerTooltip.test.ts`, as a new top-level `describe` block:

```ts
describe("createMarkerTooltip — cruise path", () => {
  const getTooltip = createMarkerTooltip(t, "de");

  it("shows the cruise line for a cruise-arcs hover", () => {
    const result = getTooltip(makeInfo("cruise-arcs", { cruiseLine: "AIDA Cruises" }));
    expect(result).not.toBeNull();
    expect(result!.html).toContain("AIDA Cruises");
  });

  it("falls back to a generic label when cruiseLine is null", () => {
    const result = getTooltip(makeInfo("cruise-arcs", { cruiseLine: null }));
    expect(result).not.toBeNull();
    expect(result!.html).toContain("Cruise");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd frontend && npx vitest run src/components/map/markerTooltip.test.ts -t "createMarkerTooltip — cruise path"
```

Expected: FAIL — `"cruise-arcs"` isn't recognized by any layer-id set yet, so `getTooltip` returns `null`.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/components/map/markerTooltip.ts`, add a new layer-id set after `ARC_LAYER_IDS`:

```ts
const CRUISE_PATH_LAYER_IDS = new Set<string>(["cruise-arcs"]);
```

Add a new interface after `ArcTooltipDatum`:

```ts
interface CruisePathTooltipDatum {
  readonly cruiseLine?: string | null;
}
```

In `createMarkerTooltip`'s returned function, add a new branch right before the final `return null;`:

```ts
    if (CRUISE_PATH_LAYER_IDS.has(layerId)) {
      const datum = info.object as CruisePathTooltipDatum | undefined | null;
      if (!datum) return null;
      const html = `<div style="font-weight:600;">🚢 ${escapeHtml(datum.cruiseLine ?? "Cruise")}</div>`;
      return { html, style: SURFACE_STYLE };
    }

    return null;
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd frontend && npx vitest run src/components/map/markerTooltip.test.ts
```

Expected: PASS — all tests in the file.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/map/markerTooltip.ts frontend/src/components/map/markerTooltip.test.ts
git commit -m "feat(map): add flat-map cruise-route hover tooltip (parity with globe)"
```

---

### Task 8: Full verification and beta deploy

**Files:** none (verification + deploy only).

**Interfaces:** none — terminal task.

- [ ] **Step 1: Run backend build checks**

```bash
cd backend && npx tsc --noEmit && npm run lint
```

Expected: no output from either command (clean).

- [ ] **Step 2: Run frontend build checks**

```bash
cd frontend && npx tsc --noEmit && npm run lint && npx vitest --run
```

Expected: no `tsc`/`lint` output; vitest reports all test files passing, including the 3 new/modified ones from Tasks 1-7 (`routesLayer.test.ts`, `markerTooltip.test.ts`, `cruisePortsLayer.test.ts`).

- [ ] **Step 3: Manual smoke check on the local dev server**

```bash
cd frontend && npm run dev
```

Open the dashboard, switch to the flat "Übersicht" map mode, and hover (don't click) an airport with a known country (e.g. MUC), a cruise port, a flight route, and (if any cruise data is loaded) a cruise route. Confirm each hover tooltip shows a flag/ICAO/place matching what the Globe mode already shows for the same feature. Stop the dev server (Ctrl+C) once confirmed.

- [ ] **Step 4: Push the branch**

```bash
git push origin dev/v2.3
```

- [ ] **Step 5: Deploy as a new beta build**

Invoke the `deploy` skill's beta flow ("deploy beta" / "beta bauen") to build and ship the next `2.3.0-beta.N` to CT 106, per `docs/RELEASE_WORKFLOW.md` and `.claude/skills/travstats-deploy/SKILL.md`.
