import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

/**
 * M1 (fix round 1 review, 2026-08-30): the gated URL redirect
 * (`tab === "tour" && betaFeaturesEnabled !== null && !tourAllowed`) is
 * only HALF of the `/dashboard/poi` treatment this tab was supposed to
 * copy -- POI also withholds `<PoiTab>` itself from the dispatch below
 * (`tab === "poi" && placesVisible && <PoiTab .../>`) so a cold-load
 * "don't know yet" state (`betaFeaturesEnabled: null`) shows neither tab
 * NOR bounces. Before this fix, `TourTab` had no such conjunct, so at
 * `betaFeaturesEnabled: null` the tour tab rendered its full shell (map,
 * sidebar, loading banner) while the POI tab correctly rendered nothing
 * -- the reviewer's own probe.
 *
 * Deliberate-break protocol: remove `tourAllowed` from the `tab ===
 * "tour" && tourAllowed && <TourTab .../>` line in DashboardPage.tsx --
 * the first test below fails (TourTab renders when it must not).
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
  it("renders neither PoiTab nor TourTab while betaFeaturesEnabled is null (pending)", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: null });

    renderAt("tour");
    expect(screen.queryByTestId("tour-tab")).not.toBeInTheDocument();

    renderAt("poi");
    expect(screen.queryByTestId("poi-tab")).not.toBeInTheDocument();
  });

  it("renders TourTab once the flag resolves true, matching PoiTab's own resolved case", () => {
    useSettingsStore.setState({ betaFeaturesEnabled: true });

    renderAt("tour");
    expect(screen.getByTestId("tour-tab")).toBeInTheDocument();

    renderAt("poi");
    expect(screen.getByTestId("poi-tab")).toBeInTheDocument();
  });
});
