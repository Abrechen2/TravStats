/**
 * The last question asked about a flight that landed without its actual times.
 *
 * What these pin is mostly the "exactly once" property, because that is what
 * the design rests on and it is carried by a field that means something else
 * everywhere else: on a `flown` row, `nextApiCheckAt` means "a last attempt is
 * outstanding". If a failure could leave it standing, the sweep would ask the
 * provider about the same flight every five minutes for ever.
 */
import { describe, it, expect, jest, beforeEach } from "@jest/globals";

const flightLookupMock = {
  lookupFlightWithHistorical: jest.fn(),
};
jest.mock("../services/flightLookup", () => flightLookupMock);

const prismaMock = {
  flight: {
    findMany: jest.fn(),
    update: jest.fn(),
  },
};
jest.mock("../db", () => ({ prisma: prismaMock }));

jest.mock("../utils/timezone", () => ({
  getAirportTimezone: jest.fn(async () => "Europe/Zurich"),
  toLocalDateString: jest.fn(() => "2026-09-02"),
}));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

import { runFinalArrivalSweep } from "../services/finalArrivalLookup";

const dueFlight = (over: Record<string, unknown> = {}) => ({
  id: "f1",
  userId: "u1",
  flightNumber: "LX93",
  departureTime: new Date("2026-09-02T21:25:00.000Z"),
  depIata: "GRU",
  depIcao: null,
  aircraft: "",
  actualDeparture: null,
  ...over,
});

/** Every `flight.update` call, as `[id, data]` pairs. */
function updates(): Array<[string, Record<string, unknown>]> {
  return (
    prismaMock.flight.update.mock.calls as Array<
      [{ where: { id: string }; data: Record<string, unknown> }]
    >
  ).map((call) => [call[0].where.id, call[0].data]);
}

describe("runFinalArrivalSweep", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    prismaMock.flight.update.mockResolvedValue({});
  });

  it("fills the actual times and the aircraft the provider returns", async () => {
    prismaMock.flight.findMany.mockResolvedValue([dueFlight()]);
    flightLookupMock.lookupFlightWithHistorical.mockResolvedValue({
      flights: [
        {
          aircraft: "Boeing 777-300ER",
          departure: { actualTime: "2026-09-02T21:31:00.000Z" },
          arrival: { actualTime: "2026-09-03T08:52:00.000Z" },
        },
      ],
    });

    const summary = await runFinalArrivalSweep();

    expect(summary).toEqual({ attempted: 1, filled: 1 });
    const [, patch] = updates()[1];
    expect(patch).toEqual({
      actualArrival: new Date("2026-09-03T08:52:00.000Z"),
      actualDeparture: new Date("2026-09-02T21:31:00.000Z"),
      aircraft: "Boeing 777-300ER",
    });
  });

  it("clears the outstanding mark BEFORE it asks", async () => {
    // The order is the point: a provider that throws must still cost the one
    // attempt. Clearing afterwards would leave the flight due for ever and
    // turn a five-minute sweep into a permanent retry loop.
    prismaMock.flight.findMany.mockResolvedValue([dueFlight()]);
    flightLookupMock.lookupFlightWithHistorical.mockRejectedValue(new Error("provider 500"));

    const summary = await runFinalArrivalSweep();

    expect(summary).toEqual({ attempted: 1, filled: 0 });
    expect(updates()).toEqual([["f1", { nextApiCheckAt: null }]]);
  });

  it("clears the mark even when the provider simply has nothing", async () => {
    prismaMock.flight.findMany.mockResolvedValue([dueFlight()]);
    flightLookupMock.lookupFlightWithHistorical.mockResolvedValue({ flights: [] });

    const summary = await runFinalArrivalSweep();

    expect(summary).toEqual({ attempted: 1, filled: 0 });
    expect(updates()).toEqual([["f1", { nextApiCheckAt: null }]]);
  });

  it("never overwrites an actual departure or an aircraft already recorded", async () => {
    prismaMock.flight.findMany.mockResolvedValue([
      dueFlight({ aircraft: "A340-300", actualDeparture: new Date("2026-09-02T21:20:00.000Z") }),
    ]);
    flightLookupMock.lookupFlightWithHistorical.mockResolvedValue({
      flights: [
        {
          aircraft: "Boeing 777-300ER",
          departure: { actualTime: "2026-09-02T21:31:00.000Z" },
          arrival: { actualTime: "2026-09-03T08:52:00.000Z" },
        },
      ],
    });

    await runFinalArrivalSweep();

    // Only the arrival, which is the one field this sweep exists for and the
    // only one the query guarantees is empty.
    const [, patch] = updates()[1];
    expect(patch).toEqual({ actualArrival: new Date("2026-09-03T08:52:00.000Z") });
  });

  it("asks only about landed flights with an outstanding mark", async () => {
    prismaMock.flight.findMany.mockResolvedValue([]);

    await runFinalArrivalSweep();

    const where = (
      prismaMock.flight.findMany.mock.calls[0] as [{ where: Record<string, unknown> }]
    )[0].where;
    expect(where).toMatchObject({
      status: "flown",
      actualArrival: null,
      nextApiCheckAt: { not: null, lte: expect.any(Date) },
    });
  });

  it("writes nothing at all when the provider adds nothing new", async () => {
    prismaMock.flight.findMany.mockResolvedValue([
      dueFlight({ aircraft: "A340-300", actualDeparture: new Date("2026-09-02T21:20:00.000Z") }),
    ]);
    flightLookupMock.lookupFlightWithHistorical.mockResolvedValue({
      flights: [{ aircraft: "Boeing 777-300ER", departure: {}, arrival: {} }],
    });

    const summary = await runFinalArrivalSweep();

    expect(summary.filled).toBe(0);
    // The mark-clearing update, and nothing else.
    expect(updates()).toHaveLength(1);
  });
});
