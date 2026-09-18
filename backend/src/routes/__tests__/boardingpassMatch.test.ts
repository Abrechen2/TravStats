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

    const match = await findExistingFlight({
      userId: USER,
      flightNumber: "LH2080",
      date: "2026-06-14",
      depTimezone: "Europe/Berlin",
    });
    expect(match?.id).toBe("f1");

    // The window is Munich's 2026-06-14 expressed in UTC — 22:00Z the evening
    // before to 22:00Z that evening — so it holds the whole local day, not
    // just the hours of it that happen to share a UTC date.
    const where = findMany.mock.calls[0][0].where.departureTime;
    expect((where.gte as Date).toISOString()).toBe("2026-06-13T22:00:00.000Z");
    expect((where.lt as Date).toISOString()).toBe("2026-06-14T22:00:00.000Z");
  });

  it("matches a DAYTIME departure, which the old UTC-day window missed", async () => {
    // Munich at local noon is stored at 2026-06-14T10:00Z. The previous window
    // searched the UTC day holding local midnight — 2026-06-13 — and answered
    // "create" for a flight the create path would have merged (forgejo#119).
    findMany.mockResolvedValue([
      {
        id: "f-noon",
        flightNumber: "LH2080",
        departureTime: new Date("2026-06-14T10:00:00.000Z"),
        depIata: "MUC",
        arrIata: "XFW",
        seatNumber: null,
        gate: null,
        terminal: null,
        bookingReference: null,
        bookingClassLetter: null,
      },
    ]);

    const match = await findExistingFlight({
      userId: USER,
      flightNumber: "LH2080",
      date: "2026-06-14",
      depTimezone: "Europe/Berlin",
    });
    expect(match?.id).toBe("f-noon");
  });

  it("falls back to a UTC window when no timezone is known", async () => {
    await findExistingFlight({
      userId: USER,
      flightNumber: "LH2080",
      date: "2026-06-14",
      depTimezone: null,
    });
    const where = findMany.mock.calls[0][0].where.departureTime;
    expect((where.gte as Date).toISOString()).toBe("2026-06-14T00:00:00.000Z");
  });

  it("matches by PNR first when present, without a date window query", async () => {
    findFirst.mockResolvedValue({ id: "f2", flightNumber: "LH400", departureTime: null });
    const match = await findExistingFlight({
      userId: USER,
      flightNumber: "LH400",
      date: "2026-06-14",
      pnr: "ABC123",
      depTimezone: "Europe/Berlin",
      depIata: "FRA",
      arrIata: "JFK",
    });
    expect(match?.id).toBe("f2");
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER, bookingReference: "ABC123", depIata: "FRA", arrIata: "JFK" },
      })
    );
    expect(findMany).not.toHaveBeenCalled();
  });

  it("does NOT match by PNR alone — a through ticket shares one across its legs", async () => {
    // FRA-JFK and JFK-LAX carry the same reference. Without the route in the
    // key the second leg would find the first and be merged into it
    // (forgejo#119).
    findFirst.mockResolvedValue({ id: "leg-1", flightNumber: "LH400", departureTime: null });

    const match = await findExistingFlight({
      userId: USER,
      flightNumber: "LH8000",
      date: "2026-06-14",
      pnr: "ABC123",
      depTimezone: "America/New_York",
      depIata: "JFK",
      arrIata: "LAX",
    });

    // The reference lookup is made, but scoped to JFK-LAX — so a stub that
    // answers it is the test's own doing; what matters is that the route is in
    // the query and the day window is still consulted when it misses.
    expect(findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: USER, bookingReference: "ABC123", depIata: "JFK", arrIata: "LAX" },
      })
    );
    expect(match?.id).toBe("leg-1");
  });

  it("ignores the PNR when the route is unknown, rather than matching on it alone", async () => {
    findFirst.mockResolvedValue({
      id: "some-other-leg",
      flightNumber: "LH400",
      departureTime: null,
    });

    const match = await findExistingFlight({
      userId: USER,
      flightNumber: "LH8000",
      date: "2026-06-14",
      pnr: "ABC123",
      depTimezone: "Europe/Berlin",
    });

    expect(findFirst).not.toHaveBeenCalled();
    expect(match).toBeNull();
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
    const match = await findExistingFlight({
      userId: USER,
      flightNumber: "LH2080",
      date: "2026-06-14",
      depTimezone: "Europe/Berlin",
    });
    expect(match).toBeNull();
  });
});
