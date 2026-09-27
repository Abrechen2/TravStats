import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * Tester 2026-09-26: the dashboard's Roadtrips tab showed the lines only.
 * It now marks the roadtrips' own stations too — and only on that tab: the
 * day-tour tab has no stations to mark and must not ask for them.
 */
const { mapProps } = vi.hoisted(() => ({ mapProps: [] as Record<string, unknown>[] }));
vi.mock("../../../MapContainer3D", () => ({
  default: (props: Record<string, unknown>) => {
    mapProps.push(props);
    return <div data-testid="map" />;
  },
}));
vi.mock("../../../../hooks/useDashboardTours", () => ({
  useDashboardTours: () => ({
    tours: [],
    toursLoading: false,
    toursLoadError: false,
    geometries: [],
    reload: vi.fn(),
  }),
}));
vi.mock("../../../../hooks/useDashboardRoute", () => ({
  useDashboardRoute: () => ({ tab: "roadtrip", mode: "routes", setTab: vi.fn(), setMode: vi.fn() }),
}));
const list = vi.hoisted(() => vi.fn());
vi.mock("../../../../lib/api/roadtrips", () => ({ roadtripsApi: { list } }));

import { TourTab } from "../TourTab";

const SUMMARY = {
  id: "rt",
  name: "Norwegen",
  stations: [
    { id: "a", title: "Hamburg", lat: 53.55, lon: 9.99, state: "pass" },
    { id: "b", title: "Mosvangen", lat: 58.95, lon: 5.72, state: "stay" },
  ],
};

function stationLayer(): { props: { data: Array<{ title: string }> } } | undefined {
  const layers = mapProps[mapProps.length - 1]?.extraLayers as Array<{
    id: string;
    props: { data: Array<{ title: string }> };
  }>;
  return layers?.find((l) => l.id === "dashboard-roadtrip-stations");
}

describe("TourTab — roadtrip stations", () => {
  it("marks every station of every roadtrip on the map, with a legend for what they were", async () => {
    list.mockResolvedValue([SUMMARY]);
    render(
      <MemoryRouter>
        <TourTab kind="roadtrip" />
      </MemoryRouter>
    );
    await waitFor(() => expect(stationLayer()).toBeDefined());
    expect(stationLayer()?.props.data.map((s) => s.title)).toEqual(["Hamburg", "Mosvangen"]);
    expect(screen.getByText("roadtrips:night.stay")).toBeInTheDocument();
    expect(screen.getByText("roadtrips:night.pass")).toBeInTheDocument();
  });

  it("says so when the stations could not be loaded, rather than drawing none", async () => {
    list.mockImplementation(() => Promise.reject(new Error("down")));
    render(
      <MemoryRouter>
        <TourTab kind="roadtrip" />
      </MemoryRouter>
    );
    expect(await screen.findByText("roadtrips:dashboard.stationsLoadError")).toBeInTheDocument();
  });

  it("does not ask for stations on the day-tour tab", () => {
    list.mockClear();
    render(
      <MemoryRouter>
        <TourTab />
      </MemoryRouter>
    );
    expect(list).not.toHaveBeenCalled();
  });
});
