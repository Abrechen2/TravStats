import { prisma } from "../db";
import { seedDemoUser } from "../seedDemoUser";

/**
 * `seedDemoUser` seeds the public preview's `admin`, `alex` and `claude` and
 * the local dev admin. Until 2.7.0-beta.17 it flagged every one of them
 * `is_demo = true` — measured on the preview, all four rows carried the flag —
 * so accounts their owners log into read as "the shared demo" to anything
 * that asks the flag. Only the shared `demo` username is sample data by
 * default now; a caller can still ask for the flag explicitly.
 *
 * NOTE: like `seedDemoAccount.isDemo.test.ts`, this removes the "demo" user
 * around each case. The demo account is disposable by definition.
 */
const OWNED = "b17-preview-alex";
const DEMO = "demo";

async function drop(username: string): Promise<void> {
  await prisma.user.deleteMany({ where: { username } });
}

async function flagOf(username: string): Promise<boolean | undefined> {
  const row = await prisma.user.findUnique({ where: { username }, select: { isDemo: true } });
  return row?.isDemo;
}

describe("seedDemoUser flags only the shared demo account", () => {
  beforeEach(async () => {
    await drop(OWNED);
    await drop(DEMO);
  });
  afterAll(async () => {
    await drop(OWNED);
    await drop(DEMO);
  });

  it("creates a named preview account as an ordinary account", async () => {
    await seedDemoUser({ username: OWNED, password: "pw-for-test-only", isAdmin: false });
    expect(await flagOf(OWNED)).toBe(false);
  }, 180_000);

  it("heals the flag on an existing named account when its credentials are reset", async () => {
    await prisma.user.create({
      data: { username: OWNED, passwordHash: "x", isDemo: true, mustChangePassword: false },
    });
    await seedDemoUser({ username: OWNED, password: "pw-for-test-only", resetCredentials: true });
    expect(await flagOf(OWNED)).toBe(false);
  }, 180_000);

  it("still flags the shared demo username", async () => {
    await seedDemoUser({ username: DEMO, password: "demo123" });
    expect(await flagOf(DEMO)).toBe(true);
  }, 180_000);

  it("flags any account whose caller asks for it", async () => {
    await seedDemoUser({ username: OWNED, password: "pw-for-test-only", isDemo: true });
    expect(await flagOf(OWNED)).toBe(true);
  }, 180_000);
});
