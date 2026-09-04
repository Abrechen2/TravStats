import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../../hooks/useDashboardRoute", () => ({
  useDashboardRoute: () => ({
    tab: "flight",
    mode: "routes",
    setMode: vi.fn(),
    navigateTo: vi.fn(),
  }),
}));
vi.mock("../../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ isEnabled: () => true, enabledDomains: ["flight"], loading: false }),
}));
vi.mock("../../../../hooks/useFlightLookup", () => ({
  useFlightLookup: () => ({ lookup: vi.fn(), lookupMany: vi.fn() }),
}));
vi.mock("../../../../store/dashboardFilterStore", () => ({
  useDashboardFilterStore: (selector?: (s: Record<string, unknown>) => unknown) => {
    const state = { time: { from: null, to: null }, year: null, filters: {}, setYear: vi.fn() };
    return selector ? selector(state) : state;
  },
}));
vi.mock("../../../../store/flightSelectionStore", () => ({
  useFlightSelectionStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ setSelection: vi.fn(), detailMode: "none", selectedIds: [] }),
}));
vi.mock("../../../../store/toastStore", () => ({
  useToastStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ addToast: vi.fn() }),
}));
vi.mock("../../../../lib/logger", () => ({
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock("../../../MapContainer3D", () => ({ default: () => <div data-testid="map" /> }));
vi.mock("../../../FlightPanel", () => ({ FlightPanel: () => null }));
vi.mock("../../../FlightEditModal", () => ({ default: () => null }));
vi.mock("../../../SimplifiedFlightFormV2", () => ({ default: () => null }));
vi.mock("../../../SpecialFlightModal", () => ({ default: () => null }));
vi.mock("../../modes/buildStatsMapLayer", () => ({ buildStatsMapLayer: () => null }));
vi.mock("../DomainDisabledNotice", () => ({ DomainDisabledNotice: () => null }));

const getAllGeoJSON = vi.fn();
const getAll = vi.fn();
vi.mock("../../../../lib/api/flights", () => ({
  flightsApi: {
    getAllGeoJSON: (...a: unknown[]) => getAllGeoJSON(...a),
    getAll: (...a: unknown[]) => getAll(...a),
  },
}));

import { FlightsTab } from "../FlightsTab";

/**
 * #262 — a fresh account opened the flights tab on an empty map with no
 * starting point, while the cruises tab already explained itself. The fix
 * shipped in rc.7 with no test; this is the one that fails without it.
 */
describe("FlightsTab — empty state (#262)", () => {
  beforeEach(() => {
    getAllGeoJSON.mockReset();
    getAll.mockReset();
  });

  it("explains itself and offers the first flight when the account has none", async () => {
    getAllGeoJSON.mockResolvedValue({ type: "FeatureCollection", features: [] });
    getAll.mockResolvedValue({ flights: [], total: 0, page: 1, limit: 500 });

    render(<FlightsTab />);

    await waitFor(() =>
      expect(screen.getByText("dashboard:flightTab.emptyTitle")).toBeInTheDocument()
    );
    expect(screen.getByText("dashboard:flightTab.emptyBody")).toBeInTheDocument();
    expect(screen.getByText("dashboard:flightTab.emptyCta")).toBeInTheDocument();
  });

  it("shows no empty state once a flight exists", async () => {
    getAllGeoJSON.mockResolvedValue({ type: "FeatureCollection", features: [] });
    getAll.mockResolvedValue({ flights: [{ id: "f1" }], total: 1, page: 1, limit: 500 });

    render(<FlightsTab />);

    await waitFor(() => expect(getAll).toHaveBeenCalled());
    expect(screen.queryByText("dashboard:flightTab.emptyTitle")).toBeNull();
  });
});
