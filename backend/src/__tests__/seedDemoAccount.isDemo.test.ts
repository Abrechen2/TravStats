import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { ensureUser } from "../seedDemoAccount";

/**
 * `seedDemoAccount` is the seeder the Docker entrypoint runs when
 * CREATE_DEMO_USER is set. It created the demo user WITHOUT `isDemo`, while the
 * other demo seeder (seedDemoUser) always set it.
 *
 * Measured on a production install: the demo account existed with
 * is_demo = false, so its 160 sample flights and 22 sample cruises counted as
 * real data in the instance-wide statistics, and the demo guards in
 * routes/flights.ts — which key off that flag — did not apply to it.
 *
 * NOTE: like the catalogue-seed suites, this removes the "demo" user around
 * each case. The demo account is disposable by definition (`npm run seed:demo`
 * recreates it); no other account is touched.
 */
describe("seedDemoAccount.ensureUser flags the demo account", () => {
  const DEMO_USERNAME = "demo";

  const dropDemo = async (): Promise<void> => {
    const existing = await prisma.user.findUnique({ where: { username: DEMO_USERNAME } });
    if (existing) await prisma.user.delete({ where: { id: existing.id } });
  };

  beforeEach(dropDemo);
  afterAll(dropDemo);

  it("creates the demo user with isDemo set", async () => {
    const id = await ensureUser();
    const user = await prisma.user.findUnique({
      where: { id },
      select: { username: true, isDemo: true },
    });
    expect(user?.username).toBe(DEMO_USERNAME);
    expect(user?.isDemo).toBe(true);
  });

  it("heals an existing demo row that predates the flag", async () => {
    // Exactly the shape the entrypoint used to leave behind.
    const stale = await prisma.user.create({
      data: {
        username: DEMO_USERNAME,
        passwordHash: await hashPassword("demo123"),
        mustChangePassword: false,
        isDemo: false,
      },
      select: { id: true },
    });

    const id = await ensureUser();
    expect(id).toBe(stale.id); // reused, not replaced

    const after = await prisma.user.findUnique({
      where: { id },
      select: { isDemo: true },
    });
    expect(after?.isDemo).toBe(true);
  });

  it("is idempotent — a second call keeps the same user and the flag", async () => {
    const first = await ensureUser();
    const second = await ensureUser();
    expect(second).toBe(first);
    const after = await prisma.user.findUnique({
      where: { id: second },
      select: { isDemo: true },
    });
    expect(after?.isDemo).toBe(true);
  });
});
