import { prisma } from "../../../db";
import { derivationProgress } from "../derivationProgress";
import { COUNTRY_DAYS_BIT, EXPLORED_BIT, MONTHS_BIT, markTravTrackDaysDirty } from "../dirtyDays";
import { makeUser, wipeTravTrack } from "./fixtures";

const PREFIX = "travtrack-derivation-progress-";

describe("derivationProgress (the history of a 13-year import is visible while it is worked off)", () => {
  let userId: string;
  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });
  afterAll(async () => {
    await wipeTravTrack([userId]);
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  });

  it("counts the days still waiting for a derivation bit, and estimates by the schedule's 62 days a tick", async () => {
    expect(await derivationProgress(userId)).toEqual({
      pendingDays: 0,
      totalDays: 0,
      estimateMinutes: 0,
    });
    const days = Array.from({ length: 130 }, (_, i) =>
      new Date(Date.UTC(2020, 0, 1 + i)).toISOString().slice(0, 10)
    );
    await prisma.$transaction((tx) => markTravTrackDaysDirty(tx, userId, days));
    const all = COUNTRY_DAYS_BIT | EXPLORED_BIT | MONTHS_BIT;
    await prisma.travTrackDirtyDay.updateMany({
      where: { userId, day: { lt: new Date("2020-01-11T00:00:00Z") } },
      data: { done: all },
    });
    // 10 days finished, 120 waiting: 2 ticks of 62 days, 15 minutes each
    expect(await derivationProgress(userId)).toEqual({
      pendingDays: 120,
      totalDays: 130,
      estimateMinutes: 30,
    });
  });
});
