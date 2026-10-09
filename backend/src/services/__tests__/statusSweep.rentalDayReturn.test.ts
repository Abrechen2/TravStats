import { prisma } from "../../db";
import { deriveRentalStatus } from "../../shared/statusDerivation";
import { sweepStatuses } from "../statusSweep";

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

    afterAll(async () => {
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.$disconnect();
    });

    it("keeps such a rental in progress during its return day, and completes it after", async () => {
      // The DB backstop allows a day-only return before a timed pickup.
      const row = await prisma.rentalBooking.create({
        data: {
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
          status: "completed",
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
  });
});
