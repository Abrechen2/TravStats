import { describe, expect, it } from "vitest";
import { legDays } from "../../../lib/roadtrip/legDays";
import { splitToursByDay } from "../tripMapTourDays";
import { buildTourPaths } from "../../layers/tourPathsLayer";
import { buildMercatorTripLayers } from "../tripMapMercatorLayers";
import { tourState } from "../tripMapEmphasis";
import type { RoadtripStation } from "../../../types/roadtrip";
import type { TourLeg } from "../../../types/tour";
import type { TourGeometryEntry } from "../../../lib/api/tourIndex";

// forgejo#424: a roadtrip is ONE route with many legs; the old filter judged the
// whole route by a date it does not have, so every leg was "another day" and the
// line vanished when a day was chosen.
const station = (i: number, startDate: string | null, endDate: string | null = null) =>
  ({
    id: `s${i}`,
    title: `S${i}`,
    lat: 45,
    lon: 10 + i,
    startDate,
    endDate,
    notes: null,
    order: i,
    state: "stay",
    lodgingStayId: null,
    stay: null,
  }) as RoadtripStation;
const leg = (i: number) => ({ id: `l${i}`, fromStopId: `s${i}`, toStopId: `s${i + 1}` }) as TourLeg;

// 12 stations, one per day from 1 June, the last two undated: 11 legs.
const stations = Array.from({ length: 12 }, (_, i) =>
  i < 10 ? station(i, `2026-06-${String(i + 1).padStart(2, "0")}`) : station(i, null)
);
const legs = Array.from({ length: 11 }, (_, i) => leg(i));

const entry = (): TourGeometryEntry => ({
  routeId: "r",
  name: "Roadtrip",
  date: null,
  legDays: Object.fromEntries(legDays(stations, legs)),
  geometry: {
    type: "FeatureCollection",
    features: legs.map((l, i) => ({
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates: [
          [10 + i, 45],
          [11 + i, 45],
        ] as Array<[number, number]>,
      },
      properties: {
        legId: l.id,
        source: "routed" as const,
        mode: "road" as const,
        confidence: "high",
        distanceKm: 10,
      },
    })),
  },
});

describe("forgejo#424 roadtrip legs by day", () => {
  it("a leg belongs to the day it is driven: the departure station's day, an overnight leg to both", () => {
    const days = legDays(stations, legs);
    expect(days.get("l2")).toEqual(["2026-06-03", "2026-06-04"]);
    // Undated destination: borrows nothing, the leg keeps its departure day.
    expect(days.get("l9")).toEqual(["2026-06-10"]);
    // Nothing places it at all.
    expect(days.has("l10")).toBe(false);
  });

  it("day 3 selected: day-3 legs are active, the others dimmed but present, undated ones neutral", () => {
    const parts = splitToursByDay([entry()], "2026-06-03");
    const ids = (k: "dim" | "neutral" | "active") =>
      parts
        .filter((p) => (k === "dim" ? p.dim : k === "neutral" ? p.neutral : !p.dim && !p.neutral))
        .flatMap((p) => p.geometry.features.map((f) => f.properties.legId));
    expect(ids("active").sort()).toEqual(["l1", "l2"]);
    expect(ids("neutral")).toEqual(["l10"]);
    expect(ids("dim")).toHaveLength(8);
    // Every leg is still drawn.
    expect(parts.flatMap((p) => p.geometry.features)).toHaveLength(11);
  });

  it("an undated tour stays in the all-days style instead of vanishing", () => {
    const e = { ...entry(), legDays: undefined };
    const [only] = splitToursByDay([e], "2026-06-03");
    expect(only.neutral).toBe(true);
    expect(only.dim).toBe(false);
    expect(tourState(only, true)).toBe("normal");
  });

  it("no day chosen leaves everything as it was", () => {
    const parts = splitToursByDay([entry()], null);
    expect(parts).toHaveLength(1);
    expect(parts[0].dim || parts[0].neutral).toBe(false);
  });

  it("the flat map paints day-3 legs full colour and the others grey but visible", () => {
    const tourPathData = buildTourPaths(
      splitToursByDay([{ ...entry(), rgb: [0, 200, 100], isRoadtrip: true }], "2026-06-03")
    );
    const layers = buildMercatorTripLayers({
      flightArcs: [],
      cruisePaths: [],
      tourPathData,
      airportPoints: [],
      stopPoints: [],
      lodgings: [],
      dimLodgingIds: new Set(),
      lodgingColors: {} as never,
      labelItems: [],
      directionLines: [],
      zoom: 6,
      dayChosen: true,
    });
    const props = layers.find((l) => l.id === "trip-tour-paths")?.props as unknown as {
      data: { dim?: boolean; neutral?: boolean }[];
      getColor: (d: unknown) => number[];
    };
    const alphas = props.data.map((d) => ({ d, a: props.getColor(d)[3] }));
    const dim = alphas.filter((x) => x.d.dim).map((x) => x.a);
    expect(dim.length).toBeGreaterThan(0);
    // 25-35 % of 255, and drawn.
    for (const a of dim) expect(a).toBeGreaterThanOrEqual(64);
    for (const a of dim) expect(a).toBeLessThanOrEqual(90);
    // The day's own legs come last (on top), in full colour.
    const last = props.data[props.data.length - 1];
    expect(props.getColor(last)).toEqual([0, 200, 100, 255]);
  });
});
