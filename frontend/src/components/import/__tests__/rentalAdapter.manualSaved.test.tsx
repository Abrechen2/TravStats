/**
 * forgejo#247 end to end for rentals: the real panel, the real rental adapter,
 * the real rental form. A rental that was stored but whose list failed to
 * reload says so inside the form — and the open form never creates it twice.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import DomainImportPanel from "../DomainImportPanel";
import { useRentalImportAdapter } from "../adapters/rentalAdapter";
import { makeRental } from "../../rental/__tests__/rentalFixture";

const create = vi.fn();
vi.mock("../../../lib/api/rental", () => ({
  rentalApi: {
    create: (...a: unknown[]) => create(...a),
    update: vi.fn(),
    searchStations: () =>
      Promise.resolve([
        {
          kind: "airport",
          airportId: 9,
          iata: "FRA",
          name: "Frankfurt Airport",
          address: null,
          city: "Frankfurt",
          lat: 50.03,
          lon: 8.57,
          country: "DE",
          timezone: "Europe/Berlin",
        },
      ]),
  },
}));
vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn() } }));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ addToast: vi.fn() }),
}));
vi.mock("../../../hooks/useRecentCurrencies", () => ({ useRecentCurrencies: () => [] }));
vi.mock("../EmailImportTab", () => ({ default: () => null }));
vi.mock("../../location/LocationInput", () => ({ LocationInput: () => null }));

function Host({ reload }: { reload: () => Promise<void> }): React.JSX.Element {
  const adapter = useRentalImportAdapter();
  return <DomainImportPanel open onClose={vi.fn()} onItemsCreated={reload} adapter={adapter} />;
}

describe("rental add flow — a failed reload after the create", () => {
  beforeEach(() => create.mockReset());

  it("keeps the form open with the saved-but-not-refreshed notice and creates once", async () => {
    create.mockResolvedValue(makeRental({ id: "new" }));
    const reload = vi.fn().mockRejectedValue(new Error("list unavailable"));
    render(<Host reload={reload} />);

    fireEvent.click(screen.getByRole("button", { name: "import:route.manual" }));
    fireEvent.change(await screen.findByLabelText(/^rental:form\.provider/), {
      target: { value: "Testcar" },
    });
    fireEvent.change(screen.getByLabelText(/^rental:form\.pickupStation/), {
      target: { value: "Frank" },
    });
    fireEvent.click(await screen.findByText("Frankfurt Airport"));
    fireEvent.change(screen.getByLabelText(/^rental:form\.pickupLocal\s*\*?$/), {
      target: { value: "2026-07-01T10:00" },
    });
    fireEvent.change(screen.getByLabelText(/^rental:form\.returnLocal\s*\*?$/), {
      target: { value: "2026-07-05T09:30" },
    });
    fireEvent.click(screen.getByRole("button", { name: "rental:form.save" }));

    expect(await screen.findByText("common:form.savedButRefreshFailed")).toBeInTheDocument();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledTimes(1);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "rental:form.save" })).toBeNull()
    );
  });
});
