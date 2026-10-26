import { describe, expect, it } from "vitest";
import type { PickingInfo } from "@deck.gl/core";
import deMap from "../../../i18n/resources/de/map.json";
import { buildTripCruisePaths } from "../tripCruisePaths";
import { createMarkerTooltip } from "../../map/markerTooltip";
import { DEFAULT_CRUISE_COLOR_CONFIG } from "../../../lib/cruiseColor";
import type { CruiseRouteFeatureCollection } from "../../../lib/api/cruise";
import type { Port } from "../../../types/cruise";

/**
 * forgejo#323 on the trip map: a cruise leg said only its line's name. It now
 * names both ports and how often the leg was sailed, in the cruise's colour.
 */

const t = (key: string, opts?: Record<string, unknown>): string => {
  const path = key.replace(/^map:/, "");
  const walk = (p: string): unknown =>
    p.split(".").reduce<unknown>((o, k) => (o as Record<string, unknown> | undefined)?.[k], deMap);
  let v = walk(path);
  if (v === undefined && opts && "count" in opts)
    v = walk(`${path}_${opts.count === 1 ? "one" : "other"}`);
  return typeof v === "string"
    ? v.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(opts?.[k] ?? ""))
    : `MISSING(${key})`;
};

const port = (id: number, name: string, lat: number, lon: number): Port => ({
  id,
  name,
  city: null,
  country: "NO",
  unlocode: null,
  lat,
  lon,
  timezone: null,
  region: null,
  isUserAdded: false,
});
const BERGEN = port(3, "Bergen", 60.39, 5.32);
const GEIRANGER = port(4, "Geiranger", 62.1, 7.2);

const CRUISE = {
  id: "c1",
  status: "completed",
  cruiseLine: "Hurtigruten",
  startDate: "2024-08-01T00:00:00.000Z",
  endDate: null,
  departurePort: BERGEN,
  arrivalPort: GEIRANGER,
  stops: [],
};

const GEOMETRY = new Map<string, CruiseRouteFeatureCollection>([
  [
    "c1",
    {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [5.32, 60.39],
              [7.2, 62.1],
            ],
          },
          properties: { fromPortId: 3, toPortId: 4, routed: true },
        },
      ],
    } as CruiseRouteFeatureCollection,
  ],
]);

describe("the trip map's cruise legs", () => {
  const [leg] = buildTripCruisePaths([CRUISE], GEOMETRY, DEFAULT_CRUISE_COLOR_CONFIG);

  it("carry the line's name and the colour store's colour", () => {
    expect(leg.label).toBe("Hurtigruten");
    expect(leg.color).toEqual(DEFAULT_CRUISE_COLOR_CONFIG.colors.past);
  });

  it("hover with both ports and the tally, not only the line's name", () => {
    const tip = createMarkerTooltip(
      t,
      "de"
    )({
      layer: { id: "trip-cruise-paths" },
      object: leg,
    } as unknown as PickingInfo);
    expect(tip?.html).toContain("Bergen");
    expect(tip?.html).toContain("Geiranger");
    expect(tip?.html).toContain("1× gesegelt");
    expect(tip?.html).toContain("Hurtigruten");
  });
});
