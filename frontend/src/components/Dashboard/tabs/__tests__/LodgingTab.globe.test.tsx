import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Lodging } from "../../../../types/lodging";

/**
 * THE bug, end to end: `/dashboard/lodging?mode=globe` drew an empty sphere
 * while the sidebar beside it listed the hotels. Every link in the chain was
 * fine on its own — the tab knew its lodgings, the flat map drew them — and
 * the break was the one hop in between, where MapContainer3D built its
 * `<GlobeView>` call without `lodgingsOverride`.
 *
 * So this test walks the whole chain with only the renderer itself stubbed:
 * LodgingTab → MapContainer3D (real) → GlobeView (captured) → buildNativeGlobe
 * (real). It fails if ANY link drops the lodgings again.
 *
 * What it cannot judge: whether the pins are visible on screen. jsdom has no
 * WebGL and MapLibre never paints here, so the layer's existence is the
 * strongest claim available from a test — a browser look is what confirms the
 * pin is where the hotel is.
 */

const listLodgingsMock = vi.fn();
const getLodgingStatsMock = vi.fn();
const capturedGlobeProps = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock("../../../../lib/api/lodging", () => ({
  listLodgings: (...args: unknown[]) => listLodgingsMock(...args),
  getLodgingStats: (...args: unknown[]) => getLodgingStatsMock(...args),
}));

vi.mock("../../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: ["lodging"],
    isEnabled: (key: string) => key === "lodging",
  }),
}));

vi.mock("../../../../hooks/useDashboardRoute", () => ({
  useDashboardRoute: () => ({ tab: "lodging", mode: "globe", setTab: vi.fn(), setMode: vi.fn() }),
}));

// The globe RENDERER is stubbed — MapLibre needs WebGL. Its props are not:
// they are fed to the real layer factory below.
vi.mock("../../../GlobeView", () => ({
  default: (props: Record<string, unknown>) => {
    capturedGlobeProps.push(props);
    return <div data-testid="globe-stub" />;
  },
}));

import { LodgingTab } from "../LodgingTab";
import { EMPTY_LODGING_STATS_BLOCKS } from "../../../../types/lodgingStatsFixture";
import { buildNativeGlobe, type NativeGlobeSpec } from "../../../Globe/native/nativeGlobeLayers";
import { ALL_ROUTES_VISIBLE } from "../../../../lib/mapRoutes";
import { DEFAULT_LODGING_COLOR_CONFIG } from "../../../../lib/lodgingColor";
import { DEFAULT_PLACE_COLOR_CONFIG } from "../../../../lib/placeColor";

const LODGING: Lodging = {
  id: "lodging-1",
  userId: "user-1",
  type: "hotel",
  name: "Hotel Test Ludwigsburg",
  chainId: null,
  chain: null,
  address: null,
  city: "Ludwigsburg",
  country: "DE",
  isoCountryCode: null,
  lat: 48.9,
  lon: 9.19,
  stars: 4,
  amenities: [],
  visited: true,
  notes: null,
  dataSource: null,
  createdAt: "2024-01-01T00:00:00.000Z",
  updatedAt: "2024-01-01T00:00:00.000Z",
  stays: [],
  overallRating: 4.3,
  stayCount: 1,
  nights: 2,
  totalSpendBase: 0,
  totalSpendBaseByCurrency: {},
};

/** Everything the native layer builder needs that the tab has no opinion about. */
function specFromGlobeProps(props: Record<string, unknown>): NativeGlobeSpec {
  return buildNativeGlobe({
    nightCells: [],
    showNight: false,
    cruisePaths: [],
    cruiseWidthScale: 1,
    airportPoints: [],
    airportColor: [1, 1, 1],
    airportRadius: 5,
    portPoints: [],
    portColor: [2, 2, 2],
    portRadius: 5,
    lodgings: (props.lodgings ?? []) as readonly Lodging[],
    lodgingColors: DEFAULT_LODGING_COLOR_CONFIG,
    lodgingRadius: 5 * ((props.lodgingMarkerSize as number) ?? 1),
    places: [],
    placeColors: DEFAULT_PLACE_COLOR_CONFIG,
    placeRadius: 5,
    extraLayers: [],
    routesVisible: ALL_ROUTES_VISIBLE,
    lite: false,
  });
}

describe("LodgingTab in globe mode", () => {
  beforeEach(() => {
    capturedGlobeProps.length = 0;
    listLodgingsMock.mockReset();
    getLodgingStatsMock.mockReset();
    listLodgingsMock.mockResolvedValue([LODGING]);
    getLodgingStatsMock.mockResolvedValue({
      lodgingsCount: 1,
      staysCount: 1,
      totalNights: 2,
      nightsByYear: {},
      nightsByMonth: {},
      longestStayNights: 2,
      chainsUnique: 0,
      citiesUnique: 1,
      countries: [],
      countriesCount: 1,
      countriesByYear: {},
      spendBaseTotal: 0,
      spendByCurrency: {},
      spendUnconvertedStays: 0,
      spendBaseByCurrency: {},
      awardNights: 0,
      nightsByType: {},
      avgRatingOverall: 4.3,
      chainLoyaltyMax: 0,
      sameHotelRepeatMax: 0,
      plannedStaysCount: 0,
      plannedNights: 0,
      plannedLodgingsCount: 0,
      notedLodgingsCount: 0,
      ...EMPTY_LODGING_STATS_BLOCKS,
    });
  });

  it("hands the hotel all the way to the globe, and the globe builds a pin for it", async () => {
    render(
      <MemoryRouter>
        <LodgingTab />
      </MemoryRouter>
    );

    await waitFor(() => expect(screen.getByTestId("globe-stub")).toBeInTheDocument());
    await waitFor(() => expect(capturedGlobeProps.length).toBeGreaterThan(0));

    const props = capturedGlobeProps[capturedGlobeProps.length - 1];
    expect((props.lodgings as Lodging[]).map((l) => l.id)).toEqual(["lodging-1"]);
    // Only the lodging appearance section, exactly as in flat-map mode.
    expect(props.appearanceDomains).toEqual(["lodging"]);

    const spec = specFromGlobeProps(props);
    expect(spec.layers.map((l) => l.id)).toContain("globe-lodging-pins");
    expect(spec.sources["globe-lodging-pins"].features).toHaveLength(1);
  });
});
