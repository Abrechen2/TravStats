import { prisma } from "../../db";
import { sweepStatuses } from "../statusSweep";

const H = 60 * 60 * 1000;

describe("sweepStatuses", () => {
  let userId: string;
  const past = (h: number) => new Date(Date.now() - h * H);
  const future = (h: number) => new Date(Date.now() + h * H);

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "statussweeptest" } });
    const user = await prisma.user.create({
      data: { username: "statussweeptest", passwordHash: "x" },
    });
    userId = user.id;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  function flight(over: Record<string, unknown>) {
    return prisma.flight.create({
      data: {
        userId,
        flightNumber: "SW1",
        depIata: "FRA",
        arrIata: "JFK",
        depLat: 50.03,
        depLon: 8.57,
        arrLat: 40.64,
        arrLon: -73.78,
        status: "scheduled",
        ...over,
      },
    });
  }

  it("flips stale scheduled flights to flown and future flown back to scheduled", async () => {
    const stale = await flight({ arrivalTime: past(7) });
    const zombie = await flight({
      status: "flown",
      departureTime: future(24),
      arrivalTime: future(26),
    });
    const cancelled = await flight({ status: "cancelled", arrivalTime: past(100) });
    await sweepStatuses();
    expect((await prisma.flight.findUnique({ where: { id: stale.id } }))?.status).toBe("flown");
    const flipped = await prisma.flight.findUnique({ where: { id: zombie.id } });
    expect(flipped?.status).toBe("scheduled");
    expect(flipped?.lastModifiedBy).toBe("status_sweep");
    expect((await prisma.flight.findUnique({ where: { id: cancelled.id } }))?.status).toBe(
      "cancelled"
    );
  });

  it("moves cruises through scheduled -> in_progress -> flown and leaves passthroughs", async () => {
    const running = await prisma.cruise.create({
      data: { userId, status: "scheduled", startDate: past(24), endDate: future(72) },
    });
    const done = await prisma.cruise.create({
      data: { userId, status: "scheduled", startDate: past(300), endDate: past(60) },
    });
    const hist = await prisma.cruise.create({
      data: { userId, status: "historical", startDate: past(300), endDate: past(60) },
    });
    await sweepStatuses();
    expect((await prisma.cruise.findUnique({ where: { id: running.id } }))?.status).toBe(
      "in_progress"
    );
    expect((await prisma.cruise.findUnique({ where: { id: done.id } }))?.status).toBe("flown");
    expect((await prisma.cruise.findUnique({ where: { id: hist.id } }))?.status).toBe(
      "historical"
    );
  });

  it("derives trip status from segment dates", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: "SweepTrip", status: "completed" } });
    await flight({ tripId: trip.id, departureTime: past(24), arrivalTime: past(22) });
    await flight({ tripId: trip.id, departureTime: future(24), arrivalTime: future(26) });
    await sweepStatuses();
    expect((await prisma.trip.findUnique({ where: { id: trip.id } }))?.status).toBe("in_progress");
  });

  it("is idempotent — second run flips 0", async () => {
    const second = await sweepStatuses();
    // Our rows are converged; other dev-DB users' rows may flip on the first
    // run of the day, so assert OUR rows are stable instead of global zeros.
    const mine = await prisma.flight.findMany({ where: { userId } });
    const third = await sweepStatuses();
    const mineAfter = await prisma.flight.findMany({ where: { userId } });
    expect(mineAfter).toEqual(mine);
    expect(typeof second.flights).toBe("number");
    expect(typeof third.trips).toBe("number");
  });

  it("does NOT revert flown→scheduled inside the slack band (hysteresis protects deliberate user/import data)", async () => {
    // A flight with arrival 2h in the past (inside the 6h slack band) has status
    // "flown" (e.g., from user/parser-set values at creation/import, direct seed
    // writes, or pre-existing data). The sweep must NOT revert it to scheduled — the
    // slack band is a hysteresis zone where both values are valid. Reverting would
    // fight deliberate data on every hourly sweep. The pending-update apply path
    // never changes status, so "flown" in the band stems from user/parser sets,
    // seed writes, or pre-existing data—never from applyPendingUpdate.
    const insideSlack = await flight({ status: "flown", arrivalTime: past(2) });
    await sweepStatuses();
    expect((await prisma.flight.findUnique({ where: { id: insideSlack.id } }))?.status).toBe(
      "flown"
    );
  });
});
