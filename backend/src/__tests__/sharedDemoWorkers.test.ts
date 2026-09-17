import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { findAutoUpdateEligibleUserIds } from "../services/flightAutoUpdate";
import { findHistoricalEnrichmentEligibleUserIds } from "../jobs/historicalEnrichmentScheduler";

/**
 * Finding A4 of the independent review on 2026-09-17, second half.
 *
 * Two background workers pick their accounts by an enabled flag on
 * `user_settings`: the flight auto-update sweep and the historical-enrichment
 * sweep. Both spend the INSTANCE's provider quota, and both run unattended, so
 * the shared demo account — whose password is printed on a public login page —
 * must never appear in either list, however its flag came to be true.
 *
 * The route refuses the two settings and the nightly reseed puts them back to
 * false; this is the third line, and the only one that still holds if a row
 * was flipped before either of those existed.
 */
describe("background workers skip the shared demo account", () => {
  const ids: string[] = [];
  let demoId: string;
  let flaggedId: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({
      where: { username: { in: ["demo", "workerFlagged", "workerUser"] } },
    });
    const demo = await prisma.user.create({
      data: { username: "demo", passwordHash: await hashPassword("demo123"), isDemo: true },
    });
    // Flagged as sample data, but its own account — the preview's `admin`,
    // `alex` and `claude`, and the local dev admin. They keep their sweeps.
    const flagged = await prisma.user.create({
      data: {
        username: "workerFlagged",
        passwordHash: await hashPassword("password123"),
        isDemo: true,
      },
    });
    const user = await prisma.user.create({
      data: { username: "workerUser", passwordHash: await hashPassword("password123") },
    });
    demoId = demo.id;
    flaggedId = flagged.id;
    userId = user.id;
    ids.push(demoId, flaggedId, userId);

    for (const id of ids) {
      await prisma.userSettings.create({
        data: {
          userId: id,
          data: {},
          autoUpdateEnabled: true,
          historicalEnrichmentEnabled: true,
        },
      });
    }
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  it("leaves the shared demo account out of the auto-update sweep", async () => {
    const eligible = await findAutoUpdateEligibleUserIds();
    expect(eligible).not.toContain(demoId);
    expect(eligible).toEqual(expect.arrayContaining([flaggedId, userId]));
  });

  it("leaves the shared demo account out of the historical-enrichment sweep", async () => {
    const eligible = await findHistoricalEnrichmentEligibleUserIds();
    expect(eligible).not.toContain(demoId);
    expect(eligible).toEqual(expect.arrayContaining([flaggedId, userId]));
  });
});
