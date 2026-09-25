import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, waitFor } from "@testing-library/react";
import FlightEditModal from "../../components/FlightEditModal";
import type { Flight } from "../../types";

/**
 * SRV-UI-001 (audit 2026-09-20): opening a flight saved at 0 EUR and changing
 * only the seat number wrote `price: null` back, and the server then dropped
 * `priceBase`, `fxRate` and the currency metadata with it. The modal loaded 0
 * and null into the same form state (`f.price || 0`) and wrote
 * `price > 0 ? price : null` out, so a zero could not survive a save that had
 * nothing to do with money.
 */

const mocks = vi.hoisted(() => ({ companionsList: vi.fn() }));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../components/ReceiptUpload", () => ({ default: () => null }));
vi.mock("../../store/settingsStore", () => ({
  useSettingsStore: () => ({ features: { enableCostTracking: true } }),
}));
vi.mock("../../lib/api/catalogue", () => ({
  airlinesApi: {
    search: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    create: vi.fn(),
  },
  aircraftApi: {
    search: vi.fn().mockResolvedValue([]),
    list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    create: vi.fn(),
  },
}));
vi.mock("../../lib/api", () => ({ companionsApi: { list: mocks.companionsList } }));
vi.mock("@/lib/api/trips", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/trips")>();
  return { ...actual, tripsApi: { ...actual.tripsApi, getAll: vi.fn().mockResolvedValue([]) } };
});

const freeFlight: Flight = {
  id: "1",
  userId: "u1",
  airline: "LH",
  flightNumber: "LH123",
  depLat: 50.033,
  depLon: 8.571,
  arrLat: 48.354,
  arrLon: 11.786,
  departureTime: "2026-06-01T10:00:00.000Z",
  arrivalTime: "2026-06-01T11:00:00.000Z",
  status: "flown",
  createdAt: "2026-01-01T00:00:00.000Z",
  price: 0,
  currency: "EUR",
  taxes: 0,
  fees: 0,
};

function priceInput(): HTMLInputElement {
  const inputs = Array.from(
    document.querySelectorAll<HTMLInputElement>('input[type="number"][step="0.01"]')
  );
  return inputs[0];
}

describe("FlightEditModal — a recorded price of 0 (SRV-UI-001)", () => {
  beforeEach(() => {
    mocks.companionsList.mockReset().mockResolvedValue([]);
  });

  it("shows the stored 0 in the price field instead of an empty one", async () => {
    render(
      <FlightEditModal flight={freeFlight} isOpen={true} onClose={vi.fn()} onSave={vi.fn()} />
    );
    // Awaited rather than asserted straight after render: the modal hydrates
    // airport-local times in an effect, and reading before it settles is an
    // intermediate render the act guard rightly refuses.
    await waitFor(() => expect(priceInput().value).toBe("0"));
  });

  it("keeps price, taxes and fees at 0 when only the seat number changes", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { getByText } = render(
      <FlightEditModal flight={freeFlight} isOpen={true} onClose={vi.fn()} onSave={onSave} />
    );

    const seat = document.querySelector(
      'input[placeholder="flights:form.placeholders.seat"]'
    ) as HTMLInputElement;
    fireEvent.change(seat, { target: { value: "14C" } });
    fireEvent.click(getByText("flights:edit.saveChanges"));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, updates] = onSave.mock.calls[0];
    expect(updates.seatNumber).toBe("14C");
    expect(updates.price).toBe(0);
    expect(updates.taxes).toBe(0);
    expect(updates.fees).toBe(0);
  });

  it("still sends null when the price field is cleared", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    const { getByText } = render(
      <FlightEditModal flight={freeFlight} isOpen={true} onClose={vi.fn()} onSave={onSave} />
    );

    fireEvent.change(priceInput(), { target: { value: "" } });
    fireEvent.click(getByText("flights:edit.saveChanges"));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const [, updates] = onSave.mock.calls[0];
    expect(updates.price).toBeNull();
  });
});
