import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { ensureUser, ensureUserSettings } from "../seedDemoAccount";

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

  it("restores the demo credentials on every run", async () => {
    const id = await ensureUser();
    const before = await prisma.user.findUnique({
      where: { id },
      select: { sessionEpoch: true },
    });
    await prisma.user.update({
      where: { id },
      data: {
        passwordHash: await hashPassword("changed-by-a-visitor"),
        mustChangePassword: true,
        twoFactorSecret: "PENDINGSECRET",
        twoFactorPendingSecret: "PENDINGSECRETTOO",
        twoFactorEnabledAt: new Date(),
        twoFactorToken: "some-hashed-login-challenge",
        twoFactorTokenExpiry: new Date(),
      },
    });
    await prisma.twoFactorRecoveryCode.create({
      data: { userId: id, codeHash: "some-recovery-code-hash" },
    });
    await prisma.webAuthnCredential.create({
      data: {
        userId: id,
        credentialId: "some-credential-id",
        publicKey: "some-public-key",
        name: "A visitor's device",
        rpId: "example.com",
      },
    });
    await prisma.apiToken.create({
      data: {
        userId: id,
        label: "A visitor's token",
        lookupHash: "some-lookup-hash",
        hash: "some-token-hash",
      },
    });

    await ensureUser();

    const after = await prisma.user.findUnique({ where: { id } });
    expect(after?.mustChangePassword).toBe(false);
    expect(after?.twoFactorEnabledAt).toBeNull();
    expect(after?.twoFactorSecret).toBeNull();
    expect(after?.twoFactorPendingSecret).toBeNull();
    expect(after?.twoFactorToken).toBeNull();
    expect(after?.twoFactorTokenExpiry).toBeNull();
    // A reset of a shared public login must end sessions issued before it —
    // otherwise a visitor's live demo JWT would survive the reset.
    expect(after?.sessionEpoch).toBeGreaterThan(before!.sessionEpoch);
    const { comparePassword } = await import("../utils/password");
    expect(await comparePassword("demo123", after!.passwordHash)).toBe(true);

    const [recoveryCodes, webauthnCredentials, apiTokens] = await Promise.all([
      prisma.twoFactorRecoveryCode.count({ where: { userId: id } }),
      prisma.webAuthnCredential.count({ where: { userId: id } }),
      prisma.apiToken.count({ where: { userId: id } }),
    ]);
    expect(recoveryCodes).toBe(0);
    expect(webauthnCredentials).toBe(0);
    expect(apiTokens).toBe(0);
  });

  /**
   * Findings I1 and C3: the reset put the credentials back but left everything
   * a visitor could still show or use — the name in the header greeting, the
   * birthdate, the notification address a reset link would go to, and any
   * reset/change token already outstanding.
   */
  it("clears the identity a visitor could leave behind", async () => {
    const id = await ensureUser();
    await prisma.user.update({
      where: { id },
      data: {
        firstName: "A",
        lastName: "Visitor",
        birthdate: new Date("1990-05-05T12:00:00.000Z"),
        notificationEmail: "attacker@example.com",
        resetToken: "a-reset-token-hash",
        resetTokenExpiry: new Date(Date.now() + 60_000),
        changeToken: "a-change-token-hash",
        changeTokenExpiry: new Date(Date.now() + 60_000),
      },
    });

    await ensureUser();

    const after = await prisma.user.findUnique({ where: { id } });
    expect(after?.firstName).toBeNull();
    expect(after?.lastName).toBeNull();
    expect(after?.birthdate).toBeNull();
    expect(after?.notificationEmail).toBeNull();
    expect(after?.resetToken).toBeNull();
    expect(after?.resetTokenExpiry).toBeNull();
    expect(after?.changeToken).toBeNull();
    expect(after?.changeTokenExpiry).toBeNull();
  });

  /**
   * Ruling R12 (finding I4). The wipe deletes a few thousand rows; a visitor
   * whose session is still live writes into that window and leaves rows the
   * wipe has already passed. Bumping `sessionEpoch` and restoring the password
   * FIRST ends every live session before the first delete runs.
   */
  it("ends live sessions before deleting the data, not after", async () => {
    await ensureUser();

    const order: string[] = [];
    const realUpdate = prisma.user.update.bind(prisma.user);
    const realWipe = prisma.placeVisit.deleteMany.bind(prisma.placeVisit);
    const updateSpy = jest
      .spyOn(prisma.user, "update")
      .mockImplementation(((args: never) => {
        order.push("lock");
        return realUpdate(args);
      }) as never);
    // The first statement of `wipeDemoUser`.
    const wipeSpy = jest
      .spyOn(prisma.placeVisit, "deleteMany")
      .mockImplementation(((args: never) => {
        order.push("wipe");
        return realWipe(args);
      }) as never);

    try {
      await ensureUser();
    } finally {
      updateSpy.mockRestore();
      wipeSpy.mockRestore();
    }

    expect(order).toEqual(["lock", "wipe"]);
  });

  /**
   * Finding I5: the demo settings switched historical enrichment ON, so a
   * public instance's shared account spent the admin's flight-API quota
   * enriching sample flights in the background, unattended.
   */
  it("leaves historical enrichment off", async () => {
    const id = await ensureUser();
    await ensureUserSettings(id);
    const settings = await prisma.userSettings.findUnique({
      where: { userId: id },
      select: { historicalEnrichmentEnabled: true },
    });
    expect(settings?.historicalEnrichmentEnabled).toBe(false);
  });
});
