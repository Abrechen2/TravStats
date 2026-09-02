import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * What the dispatch in DashboardPage does with a beta flag that has not
 * answered yet (`betaFeaturesEnabled: null` on a cold load).
 *
 * POI is still gated on `poiDomain`, and its rule is the interesting one: a
 * pending flag must show nothing rather than flash the tab and take it away
 * again, so `<PoiTab>` is withheld from the dispatch as well as guarded by the
 * redirect above it. Half a treatment is what this file was written to catch —
 * the tour tab once had the redirect without the dispatch conjunct and
 * rendered its full shell (map, sidebar, loading banner) at `null`.
 *
 * Tours themselves are no longer part of that question: the owner released
 * `tourRoutes` on 2026-09-01, so `<TourTab>` renders whatever the flag says.
 * It stays in these cases as the CONTRAST — an ungated tab beside a gated one,
 * proving the pending-state rule belongs to the gate and not to the dispatch
 * in general.
 */

const mockUseDashboardRoute = vi.hoisted(() => vi.fn());
vi.mock("../../hooks/useDashboardRoute", () => ({
  useDashboardRoute: () => mockUseDashboardRoute(),
}));

vi.mock("../../hooks/useClearMapSelectionsOnTabChange", () => ({
  useClearMapSelectionsOnTabChange: () => {},
}));

vi.mock("../../lib/api/flights", () => ({
  flightsApi: { getAll: vi.fn().mockResolvedValue({ total: 0, items: [] }) },
}));
vi.mock("../../lib/api/cruise", () => ({
  cruiseApi: { list: vi.fn().mockResolvedValue([]) },
}));
vi.mock("../../lib/api/lodging", () => ({
  getLodgingStats: vi.fn().mockResolvedValue({ lodgingsCount: 0 }),
}));
vi.mock("../../lib/api/places", () => ({
  placesApi: { count: vi.fn().mockResolvedValue(0) },
}));
// DashboardLayout (the wrapper DashboardPage always renders) fetches this
// on mount -- unmocked, it fires a real, always-failing XHR in jsdom.
vi.mock("../../lib/api/upcoming", () => ({
  getUpcoming: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../components/Dashboard/tabs/AllTab", () => ({
  AllTab: () => <div data-testid="all-tab" />,
}));
vi.mock("../../components/Dashboard/tabs/FlightsTab", () => ({
  FlightsTab: () => <div data-testid="flights-tab" />,
}));
vi.mock("../../components/Dashboard/tabs/CruisesTab", () => ({
  CruisesTab: () => <div data-testid="cruises-tab" />,
}));
vi.mock("../../components/Dashboard/tabs/PoiTab", () => ({
  PoiTab: () => <div data-testid="poi-tab" />,
}));
vi.mock("../../components/Dashboard/tabs/LodgingTab", () => ({
  LodgingTab: () => <div data-testid="lodging-tab" />,
}));
vi.mock("../../components/Dashboard/tabs/TourTab", () => ({
  TourTab: () => <div data-testid="tour-tab" />,
}));

// The real store -- `betaFeaturesEnabled`/`enabledDomains` drive
// `useBetaFeatures`/`useEnabledDomains`/`usePlacesAccess` for real, the
// same way DomainTabStrip.test.tsx exercises this gate.
vi.unmock("../../store/settingsStore");

// Imported after the mocks above so the module graph picks them up.
import DashboardPage from "../DashboardPage";
import { useSettingsStore } from "../../store/settingsStore";

function renderAt(tab: string): ReturnType<typeof render> {
  mockUseDashboardRoute.mockReturnValue({
    tab,
    mode: "routes",
    setTab: vi.fn(),
    setMode: vi.fn(),
  });
  return render(
    <MemoryRouter initialEntries={[`/dashboard/${tab}`]}>
      <DashboardPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  mockUseDashboardRoute.mockReset();
  useSettingsStore.setState({ enabledDomains: ["flight", "cruise", "lodging", "poi"] });
});

describe("DashboardPage: gated tabs at a cold-load 'don't know yet' beta flag", () => {
  it("withholds PoiTab while betaFeaturesEnabled is null (pending), but not the ungated TourTab", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: null });

    renderAt("poi");
    expect(screen.queryByTestId("poi-tab")).not.toBeInTheDocument();

    renderAt("tour");
    expect(screen.getByTestId("tour-tab")).toBeInTheDocument();
  });

  // Separate cases rather than one flag-flipping walk: `setState` re-renders
  // every mount still in the document, so flipping mid-test resurrects the
  // earlier render and the query matches three nodes.
  it("renders TourTab even with the flag definitively OFF, where PoiTab stays hidden", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: false });

    renderAt("tour");
    expect(screen.getByTestId("tour-tab")).toBeInTheDocument();

    renderAt("poi");
    expect(screen.queryByTestId("poi-tab")).not.toBeInTheDocument();
  });

  it("renders both once the flag resolves true", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: true });

    renderAt("tour");
    expect(screen.getByTestId("tour-tab")).toBeInTheDocument();

    renderAt("poi");
    expect(screen.getByTestId("poi-tab")).toBeInTheDocument();
  });
});
