import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Place } from "../../../../types/place";
import { useDashboardFilterStore } from "../../../../store/dashboardFilterStore";

/**
 * The places legend swatch has to be the mark the map draws.
 *
 * It was a hollow ring, because the pin layer drew a ringed mark to separate a
 * place from a cruise port. The ring was removed from the map on 2026-08-28 by
 * owner decision — a place reads as the same plain dot every other domain
 * draws — and the legend was not moved with it, so the key showed a shape that
 * was nowhere on screen. Reported from the running app, not by any test.
 *
 * What is pinned is the pairing, not the pixel: the places swatch must be
 * filled and round exactly like the lodging swatch beside it.
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

vi.mock("../../../../lib/api/lodging", () => ({
  listLodgings: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: ["flight", "cruise", "lodging", "poi"],
    isEnabled: () => true,
  }),
}));

// The POI legend is gated on this hook, which combines the domain switch with
// the instance beta flag and fails closed.
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

// Imported after the mocks above so the module graph picks them up.
import { AllTab } from "../AllTab";

const makePlace = (): Place =>
  ({
    id: "place-1",
    name: "Sydney Opera House",
    category: "landmark",
    lat: -33.8568,
    lon: 151.2153,
    city: "Sydney",
    country: "Australia",
    isoCountryCode: "AU",
    visited: true,
  }) as unknown as Place;

/** The legend swatch element next to `label`. */
const swatchOf = (label: string): HTMLElement | undefined => {
  const row = screen.getByText(label).parentElement;
  const swatch = row?.querySelector("span[aria-hidden]");
  return swatch instanceof HTMLElement ? swatch : undefined;
};

describe("AllTab: the places legend draws the mark the map draws", () => {
  beforeEach(() => {
    mapProps.length = 0;
    listPlacesMock.mockReset();
    listPlacesMock.mockResolvedValue([makePlace()]);
    useDashboardFilterStore.getState().reset();
    // The chip row has to have POI on, or the legend row is not rendered at all.
    useDashboardFilterStore.getState().setDomains(["flight", "cruise", "lodging", "poi"]);
  });

  it("draws the places swatch as a filled round dot, not a hollow ring", async () => {
    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("dashboard:poi.legend.solid")).toBeInTheDocument();
    });

    const swatch = swatchOf("dashboard:poi.legend.solid");
    expect(swatch).toBeDefined();
    // Round, and actually filled — a ring is transparent with a border, which
    // is precisely what shipped and what a user saw as an empty circle.
    expect(swatch?.style.borderRadius).toBe("50%");
    expect(swatch?.style.background).not.toBe("transparent");
    expect(swatch?.style.background).not.toBe("");
    expect(swatch?.style.border).toBe("");
  });

  it("gives places the same swatch geometry as lodging", async () => {
    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("dashboard:legend.lodging")).toBeInTheDocument();
    });

    const poi = swatchOf("dashboard:poi.legend.solid");
    const lodging = swatchOf("dashboard:legend.lodging");
    // Same shape, different colour — that is the whole contract.
    expect(poi?.style.width).toBe(lodging?.style.width);
    expect(poi?.style.height).toBe(lodging?.style.height);
    expect(poi?.style.borderRadius).toBe(lodging?.style.borderRadius);
  });
});
