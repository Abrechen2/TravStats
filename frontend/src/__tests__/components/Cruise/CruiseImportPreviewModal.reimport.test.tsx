import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CruiseImportPreviewModal } from "../../../components/Cruise/CruiseImportPreviewModal";
import { cruiseApi } from "../../../lib/api/cruise";
import type { ParsedCruiseEntry } from "../../../lib/api/parse";
import type { Cruise, Port } from "../../../types";

/**
 * forgejo#225 end to end: reading a booking the server already holds used to
 * end in "1 Buchung(en) waren schon eingelesen" and nothing else — a swapped
 * port in the new confirmation was silently dropped. The stored plan is now
 * compared first, and the import finishes after that.
 */

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" }, ready: true }),
}));
vi.mock("../../../lib/api", () => ({
  shipsApi: { search: vi.fn().mockResolvedValue([]), create: vi.fn() },
  portsApi: { search: vi.fn().mockResolvedValue([]), create: vi.fn() },
  airportsApi: { search: vi.fn().mockResolvedValue([]), getByCode: vi.fn() },
  setupApi: { getAirportSeedingStatus: vi.fn().mockResolvedValue({ status: "idle" }) },
}));
vi.mock("../../../lib/api/cruise", () => ({
  cruiseApi: { create: vi.fn(), get: vi.fn(), update: vi.fn() },
}));
vi.mock("../../../lib/api/flights", () => ({ flightsApi: { create: vi.fn() } }));
vi.mock("../../../lib/api/trips", () => ({
  tripsApi: { create: vi.fn(), assignFlights: vi.fn() },
}));
vi.mock("../../../store/toastStore", () => ({
  useToastStore: (selector: (s: { addToast: (...args: unknown[]) => void }) => unknown) =>
    selector({ addToast: vi.fn() }),
}));
vi.mock("@/hooks/useRecentCurrencies", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/hooks/useRecentCurrencies")>();
  return { ...actual, useRecentCurrencies: () => [] };
});
vi.mock("@/lib/api/importBatches", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/importBatches")>();
  return { ...actual, createImportBatch: vi.fn().mockResolvedValue("batch-1") };
});

const bergen = { id: 3, name: "Bergen", timezone: "Europe/Oslo" } as Port;
const stavanger = { id: 5, name: "Stavanger", timezone: "Europe/Oslo" } as Port;

const entry: ParsedCruiseEntry = {
  input: {
    cruiseLine: "AIDA",
    bookingReference: "ABC123",
    startDate: "2026-10-05",
    endDate: "2026-10-12",
    status: "scheduled",
    stops: [{ dayNumber: 4, isAtSea: false, portId: 5 }],
  },
  stopPorts: { 4: stavanger },
  shipMatched: false,
  unmatchedPorts: [],
};

const stored = {
  id: "existing-1",
  shipNameOverride: "AIDAsol",
  ship: null,
  stops: [
    {
      id: "s4",
      cruiseId: "existing-1",
      dayNumber: 4,
      portId: 3,
      port: bergen,
      isAtSea: false,
      date: null,
      arrivalTime: null,
      departureTime: null,
      excursionNote: "Fløibanen",
      unresolvedPortName: null,
    },
  ],
} as unknown as Cruise;

describe("CruiseImportPreviewModal — a booking read again", () => {
  it("compares the new plan with the stored one before the import is done", async () => {
    vi.mocked(cruiseApi.create).mockRejectedValue({
      response: { status: 409, data: { error: "already_imported", data: { id: "existing-1" } } },
    });
    vi.mocked(cruiseApi.get).mockResolvedValue(stored);
    vi.mocked(cruiseApi.update).mockResolvedValue(stored);
    const onSaved = vi.fn();
    render(<CruiseImportPreviewModal entries={[entry]} onCancel={vi.fn()} onSaved={onSaved} />);

    await userEvent.click(screen.getByRole("button", { name: "cruise:import.save" }));

    const swap = await screen.findByRole("checkbox", { name: /reimport\.port/ });
    expect(swap).toBeChecked();
    expect(onSaved).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: /reimport\.apply/ }));

    await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
    expect(cruiseApi.create).toHaveBeenCalledTimes(1);
    const [id, body] = vi.mocked(cruiseApi.update).mock.calls[0];
    expect(id).toBe("existing-1");
    // One call on day 4, now at Stavanger, with the note written for that day.
    expect(body.stops).toHaveLength(1);
    expect(body.stops?.[0]).toMatchObject({ dayNumber: 4, portId: 5, excursionNote: "Fløibanen" });
  });
});
