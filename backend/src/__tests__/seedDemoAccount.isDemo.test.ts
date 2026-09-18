import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { Prisma } from "@prisma/client";
import { ensureUser, ensureUserSettings } from "../seedDemoAccount";
import { appVersion } from "../utils/version";

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
    const updateSpy = jest.spyOn(prisma.user, "update").mockImplementation(((args: never) => {
      order.push("lock");
      return realUpdate(args);
    }) as never);
    // The first statement of `wipeDemoUser`.
    const wipeSpy = jest.spyOn(prisma.placeVisit, "deleteMany").mockImplementation(((
      args: never
    ) => {
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

  /**
   * Finding A4 (independent review, 2026-09-17). I5 reset historical
   * enrichment only on a FRESH row: the `update` branch left whatever a
   * visitor had switched on, and auto-update — the same kind of switch, the
   * same unattended background work against the instance's provider keys —
   * was never reset at all. Both are put back on every run now, which is what
   * "the reseed restores a known-good account" has to mean for a setting that
   * spends money.
   */
  it("switches both background sweeps back off on every run", async () => {
    const id = await ensureUser();
    await ensureUserSettings(id);
    await prisma.userSettings.update({
      where: { userId: id },
      data: { autoUpdateEnabled: true, historicalEnrichmentEnabled: true },
    });

    await ensureUserSettings(id);

    const settings = await prisma.userSettings.findUnique({
      where: { userId: id },
      select: { autoUpdateEnabled: true, historicalEnrichmentEnabled: true },
    });
    expect(settings?.autoUpdateEnabled).toBe(false);
    expect(settings?.historicalEnrichmentEnabled).toBe(false);
  });

  /**
   * The nightly reseed rebuilds this account from nothing, so every visitor to
   * a public preview was greeted by the release highlights of a version they
   * had never run — measured on beta.travstats.de on 2026-09-18, where the
   * 2.6.0 modal opened over the dashboard on first login and came back after
   * every reset. Same reasoning as `stampWhatsNewSeen` for a fresh signup:
   * nothing is new to an account that starts here.
   */
  it("stamps the running version as seen, so no modal greets the first visitor", async () => {
    const id = await ensureUser();
    await ensureUserSettings(id);

    const fresh = await prisma.userSettings.findUnique({
      where: { userId: id },
      select: { data: true },
    });
    expect((fresh?.data as { whatsNewSeenVersion?: string })?.whatsNewSeenVersion).toBe(appVersion);

    // And again on the update branch, which is the one the reseed takes.
    await prisma.userSettings.update({
      where: { userId: id },
      data: { data: { welcomeSeen: true } as Prisma.InputJsonValue },
    });
    await ensureUserSettings(id);

    const reseeded = await prisma.userSettings.findUnique({
      where: { userId: id },
      select: { data: true },
    });
    expect((reseeded?.data as { whatsNewSeenVersion?: string })?.whatsNewSeenVersion).toBe(
      appVersion
    );
  });

  /**
   * Finding A7 (independent review, 2026-09-17). `wipeDemoUser` covered the
   * domains a visitor is shown and missed thirteen other user-owned tables, so
   * a public instance accumulated the shared account's leavings for as long as
   * it ran: hotel loyalty numbers, import batches, parser templates, uploaded
   * receipts, a location-history sweep cursor, pairing codes.
   *
   * Every table this case writes is one the wipe did NOT touch before. It is
   * the counterpart of the enumeration comment beside the wipe — a list in a
   * comment that nothing exercises would rot the first time a model is added.
   */
  it("removes every user-owned row the wipe used to miss", async () => {
    const id = await ensureUser();

    const flight = await prisma.flight.create({
      data: { userId: id, depLat: 48.35, depLon: 11.79, arrLat: 50.03, arrLon: 8.57 },
      select: { id: true },
    });

    await prisma.countryDay.create({
      data: {
        userId: id,
        date: new Date("2026-03-01T00:00:00.000Z"),
        countryCode: "DE",
        source: "track",
        pointCount: 12,
        spanKm: 3.5,
      },
    });
    await prisma.dataQualityFlag.create({
      data: {
        userId: id,
        entityType: "flight",
        entityId: flight.id,
        kind: "missing_times",
        details: {},
      },
    });
    await prisma.dawarichSweepState.create({ data: { userId: id } });
    await prisma.importBatch.create({ data: { userId: id, domain: "flight", source: "csv" } });
    await prisma.lodgingMembership.create({ data: { userId: id, programName: "Demo Rewards" } });
    await prisma.pairingCode.create({
      data: {
        userId: id,
        codeHash: "a-pairing-code-hash",
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    await prisma.parseTrainingLog.create({
      data: {
        userId: id,
        templateHit: true,
        fieldCount: 7,
        missingFields: [],
        parserProvider: "template",
      },
    });
    await prisma.parserTemplate.create({
      data: { userId: id, name: "A visitor's template", fingerprint: {}, patterns: {} },
    });
    await prisma.pendingFlightUpdate.create({
      data: {
        userId: id,
        flightId: flight.id,
        originalData: {},
        proposedData: {},
        changes: [],
        apiSource: "airlabs",
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    await prisma.pendingUpdateStatistics.create({
      data: { userId: id, mostChangedFields: {} },
    });
    await prisma.photoJourney.create({
      data: {
        userId: id,
        startDate: new Date("2026-03-01T00:00:00.000Z"),
        endDate: new Date("2026-03-05T00:00:00.000Z"),
        photoCount: 20,
        locatedCount: 18,
        lat: 41.9,
        lon: 12.5,
        fingerprint: "a-visitors-journey",
      },
    });
    await prisma.receiptUpload.create({
      data: { userId: id, filename: "a-visitors-receipt.pdf" },
    });
    await prisma.trainingData.create({
      data: {
        userId: id,
        type: "email",
        originalFile: "a-visitors-sample.eml",
        annotations: {},
        extractedData: {},
      },
    });

    await ensureUser();

    const counts = {
      countryDay: await prisma.countryDay.count({ where: { userId: id } }),
      dataQualityFlag: await prisma.dataQualityFlag.count({ where: { userId: id } }),
      dawarichSweepState: await prisma.dawarichSweepState.count({ where: { userId: id } }),
      importBatch: await prisma.importBatch.count({ where: { userId: id } }),
      lodgingMembership: await prisma.lodgingMembership.count({ where: { userId: id } }),
      pairingCode: await prisma.pairingCode.count({ where: { userId: id } }),
      parseTrainingLog: await prisma.parseTrainingLog.count({ where: { userId: id } }),
      parserTemplate: await prisma.parserTemplate.count({ where: { userId: id } }),
      pendingFlightUpdate: await prisma.pendingFlightUpdate.count({ where: { userId: id } }),
      pendingUpdateStatistics: await prisma.pendingUpdateStatistics.count({
        where: { userId: id },
      }),
      photoJourney: await prisma.photoJourney.count({ where: { userId: id } }),
      receiptUpload: await prisma.receiptUpload.count({ where: { userId: id } }),
      trainingData: await prisma.trainingData.count({ where: { userId: id } }),
      flight: await prisma.flight.count({ where: { userId: id } }),
    };

    expect(counts).toEqual({
      countryDay: 0,
      dataQualityFlag: 0,
      dawarichSweepState: 0,
      importBatch: 0,
      lodgingMembership: 0,
      pairingCode: 0,
      parseTrainingLog: 0,
      parserTemplate: 0,
      pendingFlightUpdate: 0,
      pendingUpdateStatistics: 0,
      photoJourney: 0,
      receiptUpload: 0,
      trainingData: 0,
      flight: 0,
    });
  });
});
