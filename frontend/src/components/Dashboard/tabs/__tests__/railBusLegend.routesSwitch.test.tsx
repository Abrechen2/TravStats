import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("../../../../hooks/useDomainVisible", () => ({ useDomainVisible: () => true }));
vi.mock("../../../../hooks/useDashboardRail", () => ({
  useDashboardRail: () => ({
    journeys: [
      {
        id: "j1",
        depLat: 50,
        depLon: 8,
        arrLat: 48,
        arrLon: 11,
        depStationName: "A",
        arrStationName: "B",
        geometry: null,
      },
    ],
  }),
}));
vi.mock("../../../../hooks/useDomainColors", () => ({
  useDomainColors: () => ({ colorOf: () => "#336699" }),
}));

import { useRailOverlay } from "../railMapOverlay";
import { useMapRoutesStore } from "../../../../store/mapRoutesStore";
import { ALL_ROUTES_VISIBLE } from "../../../../lib/mapRoutes";

describe("route switches: the rail legend follows the rail lines", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useMapRoutesStore.setState({ visible: { ...ALL_ROUTES_VISIBLE } });
  });

  it("is empty once rail routes are off and back when they are on again", () => {
    const useOverlay = () => useRailOverlay(true, false, (k) => k);
    const on = renderHook(useOverlay);
    expect(on.result.current.legendRows.length).toBeGreaterThan(0);
    act(() => useMapRoutesStore.getState().setVisible("rail", false));
    const off = renderHook(useOverlay);
    expect(off.result.current.legendRows).toEqual([]);
    act(() => useMapRoutesStore.getState().setVisible("rail", true));
    expect(renderHook(useOverlay).result.current.legendRows.length).toBeGreaterThan(0);
  });
});
