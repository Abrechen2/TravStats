import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Lodging } from "../../../../types/lodging";
import { MAP_LAYER_COLORS } from "../../../../types/mapTheme";
import { PORT_RGB } from "../../../layers/cruisePortsLayer";
import { DOMAINS } from "../../../../shared/domains";
import { useDashboardFilterStore } from "../../../../store/dashboardFilterStore";

// Captures every prop set MapContainer3D is rendered with, so we can assert
// what AllTab tells the map — the domain chip in MapChromeSections toggles
// `dashboardFilterStore.domains`, and until this task the lodging entry in
// that pill row did nothing: AllTab never fetched lodgings or passed them
// down, so toggling the chip had no visible effect.
const { mapProps } = vi.hoisted(() => ({ mapProps: [] as Record<string, unknown>[] }));

vi.mock("../../../MapContainer3D", () => ({
  default: (props: Record<string, unknown>) => {
    mapProps.push(props);
    return <div data-testid="map" />;
  },
}));

const listLodgingsMock = vi.fn();
vi.mock("../../../../lib/api/lodging", () => ({
  listLodgings: (...args: unknown[]) => listLodgingsMock(...args),
}));

vi.mock("../../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: ["flight", "cruise", "lodging"],
    isEnabled: () => true,
  }),
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

function makeLodging(overrides: Partial<Lodging> = {}): Lodging {
  return {
    id: "lodging-1",
    userId: "user-1",
    type: "hotel",
    name: "Hotel Test Ludwigsburg",
    chainId: null,
    chain: null,
    address: null,
    city: "Ludwigsburg",
    country: "DE",
    lat: 48.9,
    lon: 9.19,
    stars: 4,
    amenities: [],
    notes: null,
    dataSource: null,
    createdAt: "2024-01-01T00:00:00.000Z",
    updatedAt: "2024-01-01T00:00:00.000Z",
    stays: [],
    overallRating: null,
    stayCount: 1,
    nights: 2,
    totalSpendBase: 340,
    totalSpendBaseByCurrency: { EUR: 340 },
    ...overrides,
  };
}

/** The legend swatch element next to `label`. */
const swatchOf = (label: string): HTMLElement | undefined => {
  const row = screen.getByText(label).parentElement;
  const swatch = row?.querySelector("span[aria-hidden]");
  return swatch instanceof HTMLElement ? swatch : undefined;
};

/** The `background` style of the legend swatch next to `label`. */
const swatchBackground = (label: string): string | undefined => swatchOf(label)?.style.background;

describe("AllTab: the lodging domain chip actually does something", () => {
  beforeEach(() => {
    mapProps.length = 0;
    listLodgingsMock.mockReset();
    listLodgingsMock.mockResolvedValue([makeLodging()]);
    useDashboardFilterStore.getState().reset();
  });

  it("fetches lodgings and passes them to MapContainer3D as lodgingsOverride when the chip is on", async () => {
    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(listLodgingsMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      const last = mapProps[mapProps.length - 1];
      expect((last.lodgingsOverride as Lodging[]).length).toBe(1);
    });
  });

  it("legend gains a lodging row, coloured from DOMAINS.lodging.color — the SAME constant the pin layer uses", async () => {
    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("dashboard:legend.lodging")).toBeInTheDocument();
    });
    // #d4778f -> rgb(212, 119, 143)
    expect(DOMAINS.lodging.color).toBe("#d4778f");
    expect(swatchBackground("dashboard:legend.lodging")).toBe("rgb(212, 119, 143)");
  });

  it("draws the lodging swatch as a dot, because a stay is a place and not a route", async () => {
    // Alex, Discord 2026-08-09: "Da Unterkünfte keine 'Strecken' sind sollte
    // hier auch in der Legende ein Kreis sein." Every swatch used to be the
    // same 14x2 bar, so the key claimed lodgings were drawn as lines while the
    // map drew them as pins.
    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("dashboard:legend.lodging")).toBeInTheDocument();
    });

    const dot = swatchOf("dashboard:legend.lodging");
    expect(dot?.style.borderRadius).toBe("50%");
    expect(dot?.style.width).toBe(dot?.style.height); // a circle, not an oval

    // The route domains keep their line swatch — the point is the contrast.
    const line = swatchOf("dashboard:legend.flightPast");
    expect(line?.style.borderRadius).not.toBe("50%");
  });

  it("names the airport and port dots too, in the colours the layers paint them", async () => {
    // Same message as the lodging circle: the marks that are ONLY marks had no
    // key at all. Colours are asserted against the sources the layers use —
    // the map theme for the airport dot, cruisePortsLayer's own constant for
    // the port — so a copied literal here would fail.
    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("dashboard:legend.airport")).toBeInTheDocument();
    });

    expect(swatchBackground("dashboard:legend.airport")).toBe(
      `rgb(${MAP_LAYER_COLORS.glassmorphism.airportDot.join(", ")})`
    );
    expect(swatchBackground("dashboard:legend.port")).toBe(`rgb(${PORT_RGB.join(", ")})`);
    expect(swatchOf("dashboard:legend.airport")?.style.borderRadius).toBe("50%");
    expect(swatchOf("dashboard:legend.port")?.style.borderRadius).toBe("50%");
  });

  it("drops the port row when the cruise chip is off — a key for marks that are not drawn is noise", async () => {
    useDashboardFilterStore.setState({ domains: ["flight", "lodging"] });

    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(screen.getByText("dashboard:legend.airport")).toBeInTheDocument();
    });
    expect(screen.queryByText("dashboard:legend.port")).not.toBeInTheDocument();
  });

  it("toggling the chip off hides the pins AND the legend row — the previously-dead chip is now functional", async () => {
    // Mirrors what MapChromeSections' toggleDomain does when the user
    // clicks the "Unterkünfte" pill: it removes "lodging" from the array.
    useDashboardFilterStore.setState({ domains: ["flight", "cruise"] });

    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );

    // Lodgings are still fetched (domain-gating is about isEnabled, not the
    // chip) but the map/legend must not surface them while the chip is off.
    await waitFor(() => {
      expect(listLodgingsMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      const last = mapProps[mapProps.length - 1];
      expect((last.lodgingsOverride as Lodging[]).length).toBe(0);
    });
    expect(screen.queryByText("dashboard:legend.lodging")).toBeNull();
  });

  it("passes appearanceDomains including lodging to MapContainer3D — so the lodging size slider appears in the control panel", async () => {
    render(
      <MemoryRouter>
        <AllTab />
      </MemoryRouter>
    );

    await waitFor(() => {
      expect(listLodgingsMock).toHaveBeenCalled();
    });
    await waitFor(() => {
      const last = mapProps[mapProps.length - 1];
      expect(last.appearanceDomains).toEqual(["flight", "cruise", "lodging"]);
    });
  });
});
