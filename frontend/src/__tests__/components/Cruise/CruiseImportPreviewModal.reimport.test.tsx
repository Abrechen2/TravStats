import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CruiseImportPreviewModal } from "../../../components/Cruise/CruiseImportPreviewModal";
import { cruiseApi } from "../../../lib/api/cruise";
import { flightsApi } from "../../../lib/api/flights";
import { tripsApi } from "../../../lib/api/trips";
import type { Airport } from "../../../lib/api";
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
vi.mock("../../../lib/api/flights", () => ({ flightsApi: { create: vi.fn(), getAll: vi.fn() } }));
vi.mock("../../../lib/api/trips", () => ({
  tripsApi: { create: vi.fn(), assignFlights: vi.fn(), delete: vi.fn() },
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

  /**
   * Review I4: re-reading a fly & cruise booking created its flights again,
   * and a new trip for them. Flights belong to the booking stored NOW; the
   * trip is taken back when nothing was stored.
   */
  describe("a fly & cruise booking read again", () => {
    const fra = {
      iata: "FRA",
      name: "Frankfurt",
      lat: 50,
      lon: 8,
      timezone: "Europe/Berlin",
    } as Airport;
    const bgo = {
      iata: "BGO",
      name: "Bergen",
      lat: 60,
      lon: 5,
      timezone: "Europe/Oslo",
    } as Airport;
    const withFlight = (ref: string): ParsedCruiseEntry =>
      ({
        ...entry,
        input: { ...entry.input, bookingReference: ref },
        flights: [
          {
            flightNumber: "LH123",
            airline: "Lufthansa",
            date: "2026-10-05",
            departureAirport: fra,
            arrivalAirport: bgo,
            direction: "outbound",
          },
        ],
      }) as ParsedCruiseEntry;
    const conflict = {
      response: { status: 409, data: { error: "already_imported", data: { id: "existing-1" } } },
    };

    /** The logbook's copy of LH123 on 5 Oct, as the server lists it. */
    const storedLh123 = {
      id: "f-old",
      flightNumber: "LH123",
      depIata: "FRA",
      arrIata: "BGO",
      times: {
        departure: {
          utc: "2026-10-04T22:00:00.000Z",
          zone: "Europe/Berlin",
          offset: "+02:00",
          local: "2026-10-05T00:00:00",
          precision: "day",
        },
      },
    };
    const logbook = (flights: unknown[]): void => {
      vi.mocked(flightsApi.getAll).mockResolvedValue({ flights, total: flights.length } as never);
    };

    beforeEach(() => {
      vi.clearAllMocks();
      logbook([storedLh123]);
      vi.mocked(tripsApi.create).mockResolvedValue({ id: "trip-new" } as never);
      vi.mocked(tripsApi.delete).mockResolvedValue(undefined);
      vi.mocked(flightsApi.create).mockResolvedValue({ id: "f1" } as never);
      vi.mocked(cruiseApi.get).mockResolvedValue(stored);
    });

    it("creates no flights and leaves no trip behind when the booking was already there", async () => {
      vi.mocked(cruiseApi.create).mockRejectedValue(conflict);
      const onSaved = vi.fn();
      render(
        <CruiseImportPreviewModal
          entries={[withFlight("ABC123")]}
          onCancel={vi.fn()}
          onSaved={onSaved}
        />
      );

      await userEvent.click(screen.getByRole("button", { name: "cruise:import.save" }));
      await userEvent.click(await screen.findByRole("button", { name: "reimport.keepStored" }));

      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(flightsApi.create).not.toHaveBeenCalled();
      expect(tripsApi.assignFlights).not.toHaveBeenCalled();
      // A trip made before the answer is taken back again.
      const made = vi.mocked(tripsApi.create).mock.calls.length;
      expect(vi.mocked(tripsApi.delete).mock.calls.length).toBe(made);
    });

    it("creates the flights of the booking that is new, and only those", async () => {
      vi.mocked(cruiseApi.create)
        .mockRejectedValueOnce(conflict)
        .mockResolvedValueOnce({ id: "c-new" } as Cruise);
      const onSaved = vi.fn();
      render(
        <CruiseImportPreviewModal
          entries={[withFlight("ABC123"), withFlight("NEW999")]}
          onCancel={vi.fn()}
          onSaved={onSaved}
        />
      );

      await userEvent.click(screen.getByRole("button", { name: "cruise:import.save" }));
      await userEvent.click(await screen.findByRole("button", { name: "reimport.keepStored" }));

      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(flightsApi.create).toHaveBeenCalledTimes(1);
      expect(tripsApi.create).toHaveBeenCalledTimes(1);
      expect(tripsApi.delete).not.toHaveBeenCalled();
      expect(tripsApi.assignFlights).toHaveBeenCalledWith("trip-new", {
        flightIds: ["f1"],
        action: "add",
      });
    });

    /**
     * Re-review residual of I4: a flight that failed after its cruise was
     * stored was lost for good — the next read answers 409 and skips the
     * booking's flights. It is named now, with a retry that stores only what
     * the logbook lacks.
     */
    it("names a flight that failed after its cruise was stored, and stores it on retry", async () => {
      logbook([]);
      vi.mocked(cruiseApi.create).mockResolvedValue({ id: "c-new" } as Cruise);
      vi.mocked(flightsApi.create)
        .mockRejectedValueOnce(new Error("timeout"))
        .mockResolvedValueOnce({ id: "f2" } as never);
      const onSaved = vi.fn();
      render(
        <CruiseImportPreviewModal
          entries={[withFlight("NEW1")]}
          onCancel={vi.fn()}
          onSaved={onSaved}
        />
      );
      await userEvent.click(screen.getByRole("button", { name: "cruise:import.save" }));

      expect(await screen.findByText("flightGap.introSaved")).toBeInTheDocument();
      expect(screen.getByText("flightGap.item")).toBeInTheDocument();
      expect(onSaved).not.toHaveBeenCalled();
      await userEvent.click(screen.getByRole("button", { name: "flightGap.retry" }));

      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(flightsApi.create).toHaveBeenCalledTimes(2);
      expect(tripsApi.assignFlights).toHaveBeenLastCalledWith("trip-new", {
        flightIds: ["f2"],
        action: "add",
      });
    });

    it("does not create a flight twice when the failed request had in fact arrived", async () => {
      logbook([]);
      vi.mocked(cruiseApi.create).mockResolvedValue({ id: "c-new" } as Cruise);
      vi.mocked(flightsApi.create).mockRejectedValueOnce(new Error("timeout"));
      const onSaved = vi.fn();
      render(
        <CruiseImportPreviewModal
          entries={[withFlight("NEW1")]}
          onCancel={vi.fn()}
          onSaved={onSaved}
        />
      );
      await userEvent.click(screen.getByRole("button", { name: "cruise:import.save" }));
      await screen.findByText("flightGap.introSaved");

      // The server stored it after all; the retry finds it in the logbook.
      logbook([storedLh123]);
      await userEvent.click(screen.getByRole("button", { name: "flightGap.retry" }));

      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(flightsApi.create).toHaveBeenCalledTimes(1);
    });

    it("offers a known booking's flight the logbook lacks, and creates nothing unasked", async () => {
      logbook([]);
      vi.mocked(cruiseApi.create).mockRejectedValue(conflict);
      const onSaved = vi.fn();
      render(
        <CruiseImportPreviewModal
          entries={[withFlight("ABC123")]}
          onCancel={vi.fn()}
          onSaved={onSaved}
        />
      );
      await userEvent.click(screen.getByRole("button", { name: "cruise:import.save" }));
      await userEvent.click(await screen.findByRole("button", { name: "reimport.keepStored" }));

      expect(await screen.findByText("flightGap.introKnown")).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "flightGap.skip" }));
      await waitFor(() => expect(onSaved).toHaveBeenCalledTimes(1));
      expect(flightsApi.create).not.toHaveBeenCalled();
    });
  });
});
