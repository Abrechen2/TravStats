import { prisma } from "../db";
import { mergeTrips } from "../services/tripCleanupService";
import { takeTravTrackLock } from "../services/travtrack/lock";
import { makeTrip, makeUser, wipeTravTrack } from "../services/travtrack/__tests__/fixtures";

/**
 * A trip merge and a TravTrack ingest take the same per-account lock (Codex
 * P2 on T1–T3). Without it, an ingest that resolved the SOURCE trip before the
 * merge committed inserted its link after `moveTripLinks` had copied, and the
 * link was left on a trip that no longer exists although the phone held a
 * receipt for it.
 */

const PREFIX = "travtrack-merge-lock-";

describe("trip merge under the TravTrack lock", () => {
  let userId: string;

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("waits for an ingest in flight, so a link it writes to the source trip moves too", async () => {
    await wipeTravTrack([userId]);
    const target = await makeTrip(userId, "Ziel");
    const source = await makeTrip(userId, "Quelle");
    const point = await prisma.travTrackPoint.create({
      data: {
        userId,
        t: new Date("2026-10-12T01:00:00Z"),
        tS: Date.parse("2026-10-12T01:00:00Z") / 1000,
        lat: 1,
        lon: 1,
        origin: "companion:p",
        originRef: "r",
      },
    });

    let merged = false;
    let mergePromise: Promise<unknown> | null = null;
    // An ingest holding the lock, having resolved the source trip, writes its link late.
    await prisma.$transaction(
      async (tx) => {
        await takeTravTrackLock(tx, userId);
        mergePromise = mergeTrips(userId, { tripIds: [target, source], targetId: target }).then(
          (r) => {
            merged = true;
            return r;
          }
        );
        await new Promise((resolve) => setTimeout(resolve, 600));
        expect(merged).toBe(false);
        await tx.travTrackPointLink.create({
          data: { userId, pointId: point.id, entryKind: "trip", entryId: source },
        });
      },
      { timeout: 10_000 }
    );
    await mergePromise;

    const links = await prisma.travTrackPointLink.findMany({
      where: { userId },
      select: { entryId: true },
    });
    expect(links).toEqual([{ entryId: target }]);
  });
});
