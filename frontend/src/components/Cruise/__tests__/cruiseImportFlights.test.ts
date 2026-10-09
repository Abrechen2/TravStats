import { describe, it, expect, vi, beforeEach } from "vitest";
import { flightIsStored, storeFlights } from "../cruiseImportFlights";
import { flightsApi } from "../../../lib/api/flights";
import type { FlightInput } from "../../../types";

/** Re-review residual of I4: a retry asks the logbook first and never stores a flight twice. */

vi.mock("../../../lib/api/flights", () => ({ flightsApi: { getAll: vi.fn(), create: vi.fn() } }));

const input = (extra: Partial<FlightInput> = {}): FlightInput =>
  ({
    flightNumber: "LH 123",
    departure: { iata: "FRA", lat: 0, lon: 0 },
    arrival: { iata: "BGO", lat: 0, lon: 0 },
    departureLocal: "2026-10-05T00:00",
    ...extra,
  }) as FlightInput;

const stored = (number: string, local: string, dep = "FRA", arr = "BGO") => ({
  flightNumber: number,
  depIata: dep,
  arrIata: arr,
  times: {
    departure: { utc: "x", zone: "Europe/Berlin", offset: "+02:00", local, precision: "day" },
  },
});

const logbook = (flights: unknown[]): void => {
  vi.mocked(flightsApi.getAll).mockResolvedValue({ flights, total: flights.length } as never);
};

describe("cruiseImportFlights", () => {
  beforeEach(() => vi.clearAllMocks());

  it("finds a flight by its number and the airport's departure day", async () => {
    logbook([stored("LH123", "2026-10-05T00:00:00")]);
    expect(await flightIsStored(input())).toBe(true);
    logbook([stored("LH123", "2026-10-06T00:00:00")]);
    expect(await flightIsStored(input())).toBe(false);
  });

  it("finds a flight without a number by its route and day", async () => {
    logbook([stored("XY9", "2026-10-05T07:00:00")]);
    expect(await flightIsStored(input({ flightNumber: null }))).toBe(true);
    logbook([stored("XY9", "2026-10-05T07:00:00", "MUC")]);
    expect(await flightIsStored(input({ flightNumber: null }))).toBe(false);
  });

  it("stores only what the logbook lacks, and reports one it cannot check", async () => {
    vi.mocked(flightsApi.getAll)
      .mockResolvedValueOnce({
        flights: [stored("LH123", "2026-10-05T00:00:00")],
        total: 1,
      } as never)
      .mockResolvedValueOnce({ flights: [], total: 0 } as never)
      .mockRejectedValueOnce(new Error("down"));
    vi.mocked(flightsApi.create).mockResolvedValue({ id: "new" } as never);
    const result = await storeFlights(
      [input(), input({ flightNumber: "LH124" }), input({ flightNumber: "LH125" })],
      { checkFirst: true, failedReason: "failed" }
    );
    expect(result.present).toBe(1);
    expect(result.ids).toEqual(["new"]);
    expect(result.gap.map((g) => [g.flight.flightNumber, g.reason])).toEqual([
      ["LH125", "unchecked"],
    ]);
    expect(flightsApi.create).toHaveBeenCalledTimes(1);
  });
});
