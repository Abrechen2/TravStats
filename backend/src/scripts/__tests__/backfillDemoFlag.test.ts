import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { backfillDemoFlag } from "../backfillDemoFlag";

/**
 * 2.5.0 shipped the demo-flag repair INSIDE the demo seeder, and `init.ts` runs
 * that seeder only on a first install or with CREATE_DEMO_USER=true. An install
 * that turned the switch off — the sensible choice once real users exist — kept
 * an unflagged demo account forever, its sample data counting as real in the
 * instance-wide statistics. The release notes promised "existing installs are
 * corrected on startup"; they were not.
 *
 * The repair therefore has to stand on its own, outside the seeder.
 */
describe("backfillDemoFlag", () => {
  const usernames = ["demo", "demo-real-person"];

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { username: { in: usernames } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: usernames } } });
  });

  it("flags the seeded demo account that a previous version left unflagged", async () => {
    await prisma.user.create({
      data: {
        username: "demo",
        passwordHash: await hashPassword("demo123"),
        isDemo: false,
      },
    });

    const healed = await backfillDemoFlag();
    expect(healed).toBe(1);

    const after = await prisma.user.findUnique({
      where: { username: "demo" },
      select: { isDemo: true },
    });
    expect(after?.isDemo).toBe(true);
  });

  it("is idempotent — a second run heals nothing", async () => {
    await prisma.user.create({
      data: {
        username: "demo",
        passwordHash: await hashPassword("demo123"),
        isDemo: false,
      },
    });

    await backfillDemoFlag();
    expect(await backfillDemoFlag()).toBe(0);
  });

  // The account is identified by its seeded credentials, not by its name alone.
  // Someone whose real account happens to be called "demo" keeps their data in
  // the instance statistics and keeps the endpoints the demo guard closes.
  it("leaves an account named demo alone when it does not carry the seeded password", async () => {
    await prisma.user.create({
      data: {
        username: "demo",
        passwordHash: await hashPassword("a-real-persons-password"),
        isDemo: false,
      },
    });

    expect(await backfillDemoFlag()).toBe(0);
    const after = await prisma.user.findUnique({
      where: { username: "demo" },
      select: { isDemo: true },
    });
    expect(after?.isDemo).toBe(false);
  });

  it("does nothing on an install that has no demo account at all", async () => {
    expect(await backfillDemoFlag()).toBe(0);
  });
});
