import { beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { buildTourLegendRows, useTourDeckLayers } from "../tourMapOverlay";
import { useMapRoutesStore } from "../../../../store/mapRoutesStore";
import { ALL_ROUTES_VISIBLE } from "../../../../lib/mapRoutes";
import { paletteColorForRoadtrip } from "../../../../lib/roadtripColor";
import type { TourPathDatum } from "../../../layers/tourPathsLayer";

const datum = (legId: string, isRoadtrip: boolean): TourPathDatum => ({
  legId,
  routeId: legId,
  path: [
    [0, 0],
    [1, 1],
  ],
  color: [1, 2, 3],
  isPlaceholder: false,
  isRoadtrip,
  label: legId,
});
const data = [datum("tour-leg", false), datum("trip-leg", true)];
const dataOf = (layers: ReturnType<typeof useTourDeckLayers>): string[] =>
  layers.flatMap((l) => (l.props.data as TourPathDatum[]).map((d) => d.legId));

describe("route switches: tours and roadtrips are two switches over one layer", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useMapRoutesStore.setState({ visible: { ...ALL_ROUTES_VISIBLE } });
  });

  it("draws both by default", () => {
    const { result } = renderHook(() => useTourDeckLayers(data, false));
    expect(dataOf(result.current)).toEqual(["tour-leg", "trip-leg"]);
  });

  it("tour off drops only the day-tour legs; roadtrip off drops only the roadtrip legs", () => {
    act(() => useMapRoutesStore.getState().setVisible("tour", false));
    const a = renderHook(() => useTourDeckLayers(data, false));
    expect(dataOf(a.result.current)).toEqual(["trip-leg"]);
    act(() => useMapRoutesStore.getState().setVisible("tour", true));
    act(() => useMapRoutesStore.getState().setVisible("roadtrip", false));
    const b = renderHook(() => useTourDeckLayers(data, false));
    expect(dataOf(b.result.current)).toEqual(["tour-leg"]);
  });

  it("both off leaves no layer at all", () => {
    act(() => useMapRoutesStore.getState().setVisible("tour", false));
    act(() => useMapRoutesStore.getState().setVisible("roadtrip", false));
    const { result } = renderHook(() => useTourDeckLayers(data, false));
    expect(result.current).toEqual([]);
  });
});

describe("route switches: a hidden line leaves the legend", () => {
  const fetch = {
    toursLoading: false,
    toursLoadError: false,
    tours: [{ mode: "road" }, { kind: "roadtrip" }],
  };
  const t = (k: string): string => k;
  const row = (_bg: string, _label: string, key: string) => ({ key }) as never;
  const rows = (lines: { tour: boolean; roadtrip: boolean }) =>
    buildTourLegendRows(true, fetch, t, row, { color: "#fff", label: "rt" }, lines).rows.map(
      (r) => (r as unknown as { key: string }).key
    );

  it("keeps both rows while both are drawn", () => {
    expect(rows({ tour: true, roadtrip: true })).toEqual(["tour-road", "roadtrip"]);
  });
  it("drops the tour rows with the tour lines, the roadtrip row with the roadtrip lines", () => {
    expect(rows({ tour: false, roadtrip: true })).toEqual(["roadtrip"]);
    expect(rows({ tour: true, roadtrip: false })).toEqual(["tour-road"]);
    expect(rows({ tour: false, roadtrip: false })).toEqual([]);
  });
});

describe("per-roadtrip colour mode: the legend lists each roadtrip with its swatch (GitHub #408)", () => {
  const fetch = {
    toursLoading: false,
    toursLoadError: false,
    tours: [
      { id: "r1", name: "Island loop", kind: "roadtrip", color: "#ef4444" },
      { id: "r2", name: "Alps", kind: "roadtrip", color: null },
      { id: "t1", name: "Day tour", kind: "tour", mode: "road" },
    ],
  };
  const t = (k: string): string => k;
  const row = (bg: string, label: string, key: string) => ({ bg, label, key }) as never;
  const both = { tour: true, roadtrip: true };

  it("names every roadtrip, in the colour its line is drawn in", () => {
    const rows = buildTourLegendRows(
      true,
      fetch,
      t,
      row,
      { color: "#112233", label: "Roadtrip", mode: "perRoadtrip" },
      both
    ).rows.map((r) => r as unknown as { bg: string; label: string; key: string });
    const roadtrips = rows.filter((r) => r.key.startsWith("roadtrip-"));
    expect(roadtrips.map((r) => [r.key, r.label])).toEqual([
      ["roadtrip-r1", "Island loop"],
      ["roadtrip-r2", "Alps"],
    ]);
    expect(roadtrips[0].bg).toBe("#ef4444");
    expect(roadtrips[1].bg).toBe(paletteColorForRoadtrip("r2"));
  });

  it("single mode keeps the one domain row", () => {
    const rows = buildTourLegendRows(
      true,
      fetch,
      t,
      row,
      { color: "#112233", label: "Roadtrip", mode: "single" },
      both
    ).rows.map((r) => (r as unknown as { key: string }).key);
    expect(rows.filter((k) => k.startsWith("roadtrip"))).toEqual(["roadtrip"]);
  });
});
