import { prisma } from "../../db";
import { deriveRentalStatus } from "../../shared/statusDerivation";
import { dayReturnRentalsToDerive, sweepStatuses } from "../statusSweep";

/**
 * A same-day rental whose return is known only by its day (re-review, fix
 * round 3): the day-only return is stored at the day's start, 22:00Z the day
 * before for Berlin in July, but the car is out until that day is over —
 * rail's rule (`rideEndsAt`). Pickup 10:00 Berlin = 08:00Z on 1 July 2026.
 */
const pickupTime = new Date("2026-07-01T08:00:00Z");
const returnTime = new Date("2026-06-30T22:00:00Z");
const NOON = new Date("2026-07-01T10:00:00Z");
// 2 July 00:00 Berlin — the end of the return day.
const AFTER_DAY = new Date("2026-07-01T22:00:00Z");

describe("rental status with a day-only return", () => {
  const derive = (now: Date, returnPrecision: string) =>
    deriveRentalStatus({
      pickupTime,
      returnTime,
      current: "scheduled",
      now,
      returnPrecision,
      returnTimezone: "Europe/Berlin",
    });

  it("is in progress from the pickup until the return day is over", () => {
    expect(derive(NOON, "day")).toBe("in_progress");
    expect(derive(AFTER_DAY, "day")).toBe("completed");
    expect(derive(new Date("2026-07-01T07:00:00Z"), "day")).toBe("scheduled");
  });

  it("keeps a timed return's own instant", () => {
    expect(derive(NOON, "minute")).toBe("completed");
  });

  describe("the hourly sweep", () => {
    let userId: string;

    beforeAll(async () => {
      await prisma.user.deleteMany({ where: { username: "sweepdayreturn" } });
      userId = (
        await prisma.user.create({ data: { username: "sweepdayreturn", passwordHash: "x" } })
      ).id;
    });

    const base = () => ({
      userId,
      provider: "Testcar",
      pickupStationName: "Testport",
      pickupLat: 50,
      pickupLon: 8,
      pickupTimezone: "Europe/Berlin",
      returnStationName: "Testport",
      returnLat: 50,
      returnLon: 8,
      returnTimezone: "Europe/Berlin",
    });

    afterEach(async () => {
      jest.restoreAllMocks();
      await prisma.rentalBooking.deleteMany({ where: { userId } });
    });

    afterAll(async () => {
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });

    it("keeps such a rental in progress during its return day, and completes it after", async () => {
      // The DB backstop allows a day-only return before a timed pickup.
      const row = await prisma.rentalBooking.create({
        data: {
          ...base(),
          userId,
          provider: "Testcar",
          pickupStationName: "Testport",
          pickupLat: 50,
          pickupLon: 8,
          pickupTimezone: "Europe/Berlin",
          returnStationName: "Testport",
          returnLat: 50,
          returnLon: 8,
          returnTimezone: "Europe/Berlin",
          pickupTime,
          returnTime,
          returnPrecision: "day",
          status: "scheduled",
        },
      });
      await sweepStatuses(NOON);
      expect((await prisma.rentalBooking.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
        "in_progress"
      );
      await sweepStatuses(AFTER_DAY);
      expect((await prisma.rentalBooking.findUniqueOrThrow({ where: { id: row.id } })).status).toBe(
        "completed"
      );
    });

    // Fix round 3: the per-row pass is bounded in the query, not in JS.
    it("never reads an old rental, completed or not — the query bounds the pass", async () => {
      const longAgo = {
        ...base(),
        pickupTime: new Date("2026-05-01T08:00:00Z"),
        returnTime: new Date("2026-05-02T22:00:00Z"),
        returnPrecision: "day",
      };
      const done = await prisma.rentalBooking.create({ data: { ...longAgo, status: "completed" } });
      const stuck = await prisma.rentalBooking.create({
        data: { ...longAgo, status: "in_progress" },
      });
      const findMany = jest.spyOn(prisma.rentalBooking, "findMany");
      await sweepStatuses(NOON);
      const passes = findMany.mock.calls.filter(
        ([args]) =>
          (args as { where?: { returnPrecision?: string } })?.where?.returnPrecision === "day"
      );
      expect(passes).toHaveLength(1);
      expect(passes[0][0]?.where).toEqual(dayReturnRentalsToDerive(NOON));
      const read = (await findMany.mock.results[findMany.mock.calls.indexOf(passes[0])]
        .value) as Array<{
        id: string;
      }>;
      expect(read.map((r) => r.id)).not.toContain(done.id);
      expect(read.map((r) => r.id)).not.toContain(stuck.id);
      // The old open one is completed in bulk; the completed one is untouched.
      expect(
        (await prisma.rentalBooking.findUniqueOrThrow({ where: { id: stuck.id } })).status
      ).toBe("completed");
      expect(
        (
          await prisma.rentalBooking.findUniqueOrThrow({ where: { id: done.id } })
        ).updatedAt.getTime()
      ).toBe(done.updatedAt.getTime());
    });

    it("bounds the pass to open rentals whose return day may not have ended", () => {
      expect(dayReturnRentalsToDerive(NOON)).toEqual({
        returnPrecision: "day",
        status: { in: ["scheduled", "in_progress"] },
        pickupTime: { lte: NOON },
        returnTime: { gt: new Date(NOON.getTime() - 26 * 3_600_000) },
      });
    });
  });
});
