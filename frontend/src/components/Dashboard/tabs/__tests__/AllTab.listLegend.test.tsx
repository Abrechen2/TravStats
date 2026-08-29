import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { Place } from "../../../../types/place";
import { useDashboardFilterStore } from "../../../../store/dashboardFilterStore";
import { usePlaceColorStore } from "../../../../store/placeColorStore";

/**
 * In "by list" colouring, the legend has to name the lists.
 *
 * It named exactly one row — "In keiner Liste" — while the map drew a pin per
 * list in each list's own colour. A key whose only entry is the negative case
 * makes the map unreadable: every coloured dot on screen is unexplained, and
 * the one thing the key does explain is the absence of colour (Alex,
 * 2026-08-29).
 *
 * The cause was not a missing capability. `buildPlaceLegend(config, usedLists)`
 * has always accepted the lists — this tab called it with one argument, while
 * the POI tab passed both. The resolution it needed was already being computed
 * on the same component, only further down the file.
 */
const { mapProps } = vi.hoisted(() => ({ mapProps: [] as Record<string, unknown>[] }));

vi.mock("../../../MapContainer3D", () => ({
  default: (props: Record<string, unknown>) => {
    mapProps.push(props);
    return <div data-testid="map" />;
  },
}));

const listPlacesMock = vi.fn();
vi.mock("../../../../lib/api/places", () => ({
  listPlaces: (...args: unknown[]) => listPlacesMock(...args),
}));

const listPlaceListsMock = vi.fn();
vi.mock("../../../../lib/api/placeLists", () => ({
  listPlaceLists: (...args: unknown[]) => listPlaceListsMock(...args),
}));

vi.mock("../../../../lib/api/lodging", () => ({
  listLodgings: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: ["flight", "cruise", "lodging", "poi"],
    isEnabled: () => true,
  }),
}));

vi.mock("../../../../hooks/usePlacesVisible", () => ({
  usePlacesVisible: () => true,
}));

vi.mock("../../../../hooks/useDashboardRoute", () => ({
  useDashboardRoute: () => ({ tab: "all", mode: "overview", setTab: () => {}, setMode: () => {} }),
}));

vi.mock("../../../../hooks/useFlightLookup", () => ({
  useFlightLookup: () => ({ lookup: () => null, lookupMany: () => [] }),
}));

vi.mock("../../../../lib/api/flights", () => ({
  flightsApi: { getAllGeoJSON: vi.fn().mockResolvedValue({ features: [] }) },
}));
vi.mock("../../../../lib/api/cruise", () => ({
  cruiseApi: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../../../../lib/api/trips", () => ({
  tripsApi: { getAll: vi.fn().mockResolvedValue([]) },
}));

import { AllTab } from "../AllTab";

const place = (id: string, name: string): Place =>
  ({
    id,
    name,
    category: "restaurant",
    lat: 41.9,
    lon: 12.48,
    city: "Rom",
    country: "Italien",
    isoCountryCode: "IT",
    visited: true,
  }) as unknown as Place;

describe("AllTab: the legend names the lists it colours by", () => {
  beforeEach(() => {
    mapProps.length = 0;
    listPlacesMock.mockReset();
    listPlaceListsMock.mockReset();

    listPlacesMock.mockResolvedValue([place("p1", "McDonald's Trevi"), place("p2", "Kolosseum")]);
    listPlaceListsMock.mockResolvedValue([
      {
        id: "l1",
        name: "Maccis",
        color: "#f0a947",
        icon: "🍟",
        labelMode: "icon",
        entries: [{ placeId: "p1" }],
      },
      {
        id: "l2",
        name: "Rom",
        color: "#6fa0d6",
        icon: null,
        labelMode: "name",
        entries: [{ placeId: "p2" }],
      },
    ]);

    useDashboardFilterStore.getState().reset();
    useDashboardFilterStore.getState().setDomains(["flight", "cruise", "lodging", "poi"]);
    usePlaceColorStore.getState().setMode("list");
  });

  it("shows a row per list, by name", async () => {
    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("Maccis")).toBeInTheDocument();
    });
    expect(screen.getByText("Rom")).toBeInTheDocument();
  });

  it("still names the places that are in no list", async () => {
    // The negative row is not the bug — being the ONLY row was.
    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("dashboard:poi.legend.unlisted")).toBeInTheDocument();
    });
  });
});
