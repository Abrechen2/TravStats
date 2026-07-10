jest.mock("../../db", () => ({
  prisma: {
    flight: { findFirst: jest.fn(), findMany: jest.fn() },
  },
}));

import { findExistingFlight } from "../boardingpassMatch";
import { prisma } from "../../db";

const findFirst = prisma.flight.findFirst as jest.Mock;
const findMany = prisma.flight.findMany as jest.Mock;

const USER = "user-1";

beforeEach(() => {
  findFirst.mockReset();
  findMany.mockReset();
  findFirst.mockResolvedValue(null);
  findMany.mockResolvedValue([]);
});

describe("findExistingFlight — timezone-aware day window (#dup)", () => {
  it("matches a flight stored on the previous UTC day for a UTC+ airport", async () => {
    // Munich (UTC+2 in summer): a 2026-06-14 local-midnight flight is stored at
    // 2026-06-13T22:00Z. The matcher must search the UTC day that actually holds
    // it, not the bare date as UTC midnight.
    const stored = {
      id: "f1",
      flightNumber: "LH2080",
      departureTime: new Date("2026-06-13T22:00:00.000Z"),
      depIata: "MUC",
      arrIata: "XFW",
      seatNumber: null,
      gate: null,
      terminal: null,
      bookingReference: null,
      bookingClassLetter: null,
    };
    findMany.mockResolvedValue([stored]);

    const match = await findExistingFlight(USER, "LH2080", "2026-06-14", undefined, "Europe/Berlin");
    expect(match?.id).toBe("f1");

    // The query window must start on 2026-06-13 (UTC), not 2026-06-14.
    const where = findMany.mock.calls[0][0].where.departureTime;
    expect((where.gte as Date).toISOString()).toBe("2026-06-13T00:00:00.000Z");
    expect((where.lt as Date).toISOString()).toBe("2026-06-14T00:00:00.000Z");
  });

  it("falls back to a UTC window when no timezone is known", async () => {
    await findExistingFlight(USER, "LH2080", "2026-06-14", undefined, null);
    const where = findMany.mock.calls[0][0].where.departureTime;
    expect((where.gte as Date).toISOString()).toBe("2026-06-14T00:00:00.000Z");
  });

  it("matches by PNR first when present, without a date window query", async () => {
    findFirst.mockResolvedValue({ id: "f2", flightNumber: "LH400", departureTime: null });
    const match = await findExistingFlight(USER, "LH400", "2026-06-14", "ABC123", "Europe/Berlin");
    expect(match?.id).toBe("f2");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER, bookingReference: "ABC123" } })
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it("returns null when the flight number differs within the window", async () => {
    findMany.mockResolvedValue([
      {
        id: "f3",
        flightNumber: "LH999",
        departureTime: new Date("2026-06-13T22:00:00.000Z"),
        depIata: "MUC",
        arrIata: "XFW",
        seatNumber: null,
        gate: null,
        terminal: null,
        bookingReference: null,
        bookingClassLetter: null,
      },
    ]);
    const match = await findExistingFlight(USER, "LH2080", "2026-06-14", undefined, "Europe/Berlin");
    expect(match).toBeNull();
  });
});
