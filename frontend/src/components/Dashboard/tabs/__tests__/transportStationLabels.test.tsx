import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { Layer } from "@deck.gl/core";
import { useTransportOverlays } from "../allTabTransportOverlays";
import { useDomainColorStore } from "../../../../store/domainColorStore";
import { useMapLabelsModeStore } from "../../../../store/mapLabelsModeStore";

/**
 * forgejo#320 on the "Alle" map: the station names of rail, bus and ferry are
 * built from the SAME rows as their lines — so a domain the filter switched off
 * names no station — in the colour the domain colour store holds, and follow
 * the map's label switch.
 */
const STATIONS = {
  status: "completed",
  depStationName: "Berlin Hbf",
  depLat: 52.525,
  depLon: 13.369,
  arrStationName: "Hamburg Hbf",
  arrLat: 53.553,
  arrLon: 10.007,
  geometry: null,
};

vi.mock("../../../../hooks/useDomainVisible", () => ({ useDomainVisible: () => true }));
vi.mock("../../../../hooks/useDashboardRail", () => ({
  useDashboardRail: (enabled: boolean) => ({
    journeys: enabled ? [{ id: "r1", geometrySource: "straight", ...STATIONS }] : [],
  }),
}));
vi.mock("../../../../lib/api/bus", () => ({
  busApi: { listAll: vi.fn(async () => [{ id: "b1", ...STATIONS }]) },
}));
vi.mock("../../../../lib/api/ferry", () => ({
  ferryApi: { listAll: vi.fn(async () => [{ id: "f1", ...STATIONS }]) },
}));
// Rentals name no station; their own fetch is out of this test's way.
const NO_RENTALS = { layers: [], legendRows: [] };
vi.mock("../rentalMapOverlay", () => ({ useRentalOverlay: () => NO_RENTALS }));

const t = (key: string): string => key;
const labelIds = (layers: readonly Layer[]) =>
  layers.filter((l) => l.id.endsWith("-station-labels")).map((l) => l.id);
const borderOf = (layers: readonly Layer[], id: string) =>
  (layers.find((l) => l.id === id)?.props as unknown as { color: number[] }).color;

const ALL = ["all-rail-station-labels", "all-bus-station-labels", "all-ferry-station-labels"];

describe("station labels on the 'Alle' map (forgejo#320)", () => {
  beforeEach(() => {
    useDomainColorStore.getState().setColor("rail", "#010203");
    useDomainColorStore.getState().setColor("bus", "#0a0b0c");
    useDomainColorStore.getState().setColor("ferry", "#c8641e");
    useMapLabelsModeStore.setState({ mode: "important" });
  });
  afterEach(() => {
    // Still mounted here: the reset re-renders the hook, so it goes through act.
    act(() => useDomainColorStore.getState().resetToBrand());
    window.localStorage.clear();
  });

  it("names the stations of every shown domain, in the store's colour", async () => {
    const { result } = renderHook(() => useTransportOverlays(true, () => true, false, t));
    await waitFor(() => expect(labelIds(result.current.layers)).toEqual(ALL));
    expect(borderOf(result.current.layers, "all-rail-station-labels")).toEqual([1, 2, 3]);
    expect(borderOf(result.current.layers, "all-bus-station-labels")).toEqual([10, 11, 12]);
    expect(borderOf(result.current.layers, "all-ferry-station-labels")).toEqual([200, 100, 30]);
  });

  it("names no station of a domain the filter switched off", async () => {
    const { result } = renderHook(() =>
      useTransportOverlays(true, (key) => key !== "rail" && key !== "ferry", false, t)
    );
    await waitFor(() =>
      expect(labelIds(result.current.layers)).toEqual(["all-bus-station-labels"])
    );
  });

  it("follows the map's label switch", async () => {
    const { result } = renderHook(() => useTransportOverlays(true, () => true, false, t));
    await waitFor(() => expect(labelIds(result.current.layers)).toEqual(ALL));
    act(() => useMapLabelsModeStore.getState().setMode("off"));
    await waitFor(() => expect(labelIds(result.current.layers)).toEqual([]));
  });
});
