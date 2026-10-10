/**
 * forgejo#247 end to end for rail: the real panel, the real rail adapter, the
 * real rail form. A ride that was stored but whose list failed to reload must
 * say so inside the form — and the open form must not create it twice.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import DomainImportPanel from "../DomainImportPanel";
import { useRailImportAdapter } from "../adapters/railAdapter";
import { makeRailJourney } from "../../rail/__tests__/railJourneyFixture";
import { getNamed, queryNamed } from "../../../__tests__/helpers/namedElement";

const create = vi.fn();
vi.mock("../../../lib/api/rail", () => ({
  railApi: {
    create: (...a: unknown[]) => create(...a),
    update: vi.fn(),
    entrySuggestions: () =>
      Promise.resolve({ trains: [], operators: [], travelClass: null, coaches: [], seats: [] }),
    searchStations: () => Promise.resolve([]),
    lookup: vi.fn(),
    lookupProviders: () =>
      Promise.resolve({ transitous: true, dbRest: true, transitousSourcesUrl: "https://x" }),
  },
}));
vi.mock("../../../lib/api", () => ({ tripsApi: { getAll: () => Promise.resolve([]) } }));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ addToast: vi.fn() }),
}));
vi.mock("../../../hooks/useRecentCurrencies", () => ({ useRecentCurrencies: () => [] }));
vi.mock("../../CompanionPicker", () => ({ default: () => null }));
vi.mock("../EmailImportTab", () => ({ default: () => null }));
vi.mock("../../location/LocationInput", () => ({
  LocationInput: ({
    label,
    onChange,
  }: {
    label: string;
    onChange: (s: { lat: number; lon: number; name?: string }) => void;
  }) => (
    <button
      type="button"
      onClick={() =>
        onChange(
          label === "rail:form.departureStation"
            ? { lat: 50.1071, lon: 8.6632, name: "Frankfurt (Main) Hbf" }
            : { lat: 48.8768, lon: 2.3591, name: "Paris Est" }
        )
      }
    >
      pick {label}
    </button>
  ),
}));

function Host({ reload }: { reload: () => Promise<void> }): React.JSX.Element {
  const adapter = useRailImportAdapter();
  return <DomainImportPanel open onClose={vi.fn()} onItemsCreated={reload} adapter={adapter} />;
}

describe("rail add flow — a failed reload after the create", () => {
  beforeEach(() => create.mockReset());

  it("keeps the form open with the saved-but-not-refreshed notice and creates once", async () => {
    create.mockResolvedValue({ journey: { id: "new" }, geometry: null });
    const reload = vi.fn().mockRejectedValue(new Error("list unavailable"));
    render(<Host reload={reload} />);

    fireEvent.click(getNamed("button", "import:route.manual"));
    for (const b of await screen.findAllByRole("button", { name: "rail:station.useGeocoder" })) {
      fireEvent.click(b);
    }
    fireEvent.click(screen.getByText("pick rail:form.departureStation"));
    fireEvent.click(screen.getByText("pick rail:form.arrivalStation"));
    fireEvent.change(screen.getByLabelText(/^rail:form\.departureTime\s*\*?$/), {
      target: { value: "2026-07-01T08:15" },
    });
    fireEvent.click(getNamed("button", "rail:form.save"));

    expect(await screen.findByText("common:form.savedButRefreshFailed")).toBeInTheDocument();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    // The form is still there; the only action left is to close it.
    await waitFor(() => expect(queryNamed("button", "rail:form.save")).toBeNull());
  });

  // Review minor 9: a leg stored by "save and add a connection" reloads the
  // list at once, so cancelling the next leg leaves nothing missing.
  it("reloads the list after a leg stored by 'save and add a connection', and stays open", async () => {
    create.mockResolvedValue({ journey: makeRailJourney({ id: "leg1" }), geometry: null });
    const reload = vi.fn().mockResolvedValue(undefined);
    render(<Host reload={reload} />);

    fireEvent.click(getNamed("button", "import:route.manual"));
    for (const b of await screen.findAllByRole("button", { name: "rail:station.useGeocoder" })) {
      fireEvent.click(b);
    }
    fireEvent.click(screen.getByText("pick rail:form.departureStation"));
    fireEvent.click(screen.getByText("pick rail:form.arrivalStation"));
    fireEvent.change(screen.getByLabelText(/^rail:form\.departureTime\s*\*?$/), {
      target: { value: "2026-07-01T08:15" },
    });
    fireEvent.click(screen.getByTestId("rail-save-and-connect"));

    expect(await screen.findByTestId("rail-connection-banner")).toBeInTheDocument();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
