import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

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
// The panel's own delete control, as a plain button.
vi.mock("../../../FlightPanel", () => ({
  FlightPanel: ({ onDelete }: { onDelete: (id: string) => void }) => (
    <button type="button" onClick={() => onDelete("f1")}>
      panel-delete
    </button>
  ),
}));
vi.mock("../../../FlightEditModal", () => ({ default: () => null }));
vi.mock("../../../SimplifiedFlightFormV2", () => ({ default: () => null }));
vi.mock("../../../SpecialFlightModal", () => ({ default: () => null }));
vi.mock("../../modes/buildStatsMapLayer", () => ({ buildStatsMapLayer: () => null }));
vi.mock("../DomainDisabledNotice", () => ({ DomainDisabledNotice: () => null }));

const deleteFlight = vi.fn();
// The recording count reads through the API barrel.
vi.mock("../../../../lib/api", () => ({
  flightsApi: { getTrack: vi.fn().mockResolvedValue({ id: "tr1", pointCount: 1 }) },
}));
vi.mock("../../../../lib/api/documents", () => ({
  documentsApi: { listForEntry: vi.fn().mockResolvedValue([{ id: "d1" }]) },
}));
const getAllGeoJSON = vi.fn();
const getAll = vi.fn();
vi.mock("../../../../lib/api/flights", () => ({
  flightsApi: {
    getAllGeoJSON: (...a: unknown[]) => getAllGeoJSON(...a),
    getAll: (...a: unknown[]) => getAll(...a),
    delete: (...a: unknown[]) => deleteFlight(...a),
  },
}));

import { FlightsTab } from "../FlightsTab";

/** forgejo#250 — the dashboard panel's delete deleted on the click, unasked. */
describe("FlightsTab — delete asks first", () => {
  beforeEach(() => {
    getAllGeoJSON.mockReset().mockResolvedValue({ type: "FeatureCollection", features: [] });
    getAll.mockReset().mockResolvedValue({
      flights: [{ id: "f1", flightNumber: "LH1", depIata: "MUC", arrIata: "CPH" }],
      total: 1,
      page: 1,
      limit: 500,
    });
    deleteFlight.mockReset().mockResolvedValue(undefined);
  });

  it("names the flight and its documents, in a red confirm, before deleting", async () => {
    render(<FlightsTab />);
    await waitFor(() => expect(getAll).toHaveBeenCalled());
    fireEvent.click(await screen.findByText("panel-delete"));
    expect(deleteFlight).not.toHaveBeenCalled();
    const dialog = await screen.findByTestId("confirm-modal");
    await waitFor(() => expect(dialog).toHaveTextContent("documents:deleteCascadeNote"));
    await waitFor(() => expect(dialog).toHaveTextContent("flights:deleteParts.recording"));
    const confirm = screen.getByRole("button", { name: "flights:table.deleteConfirm.confirm" });
    expect(confirm.className).toContain("bg-[var(--danger)]");
    fireEvent.click(confirm);
    await waitFor(() => expect(deleteFlight).toHaveBeenCalledWith("f1"));
  });
});
