/**
 * Two passes over one account at the same time — against real Postgres.
 *
 * `runner.test.ts` next door drives the runner through an in-memory double, and
 * that double CANNOT produce this defect: it has no unique index, so its
 * `create` never throws P2002, and a green run there says nothing about what
 * happens when two passes overlap. The collision only exists at the column, so
 * the test has to be at the column too.
 *
 * The defect being pinned: the runner reads the flags, decides, and writes,
 * with no transaction around the pair. Two passes for one account therefore both
 * saw "no such flag" and both created it; the unique index made the loser throw,
 * and that error came out of `runDataQualityChecks` and abandoned the loser's
 * ENTIRE pass — every check after the colliding one went unrun. It is reachable
 * in production: a place import fires the checks immediately while a lodging
 * import fires them after geocoding, so one user doing both in a session can
 * have two passes in flight. `dataQualityTrigger.ts` queues them per process,
 * which leaves two containers on one database, and the nightly sweep meeting an
 * import, uncovered.
 */
import { prisma } from "../../../db";
import { runDataQualityChecks } from "../runner";

/**
 * The owner's own case, as in `dataQualityIdempotence.test.ts`: a hotel whose
 * address names Slovenia while the row claims Romania, and — having no stay —
 * a country whose entire case is undated. One row, two flags of different
 * shapes, so a truncated pass is visible as a missing SECOND flag rather than
 * as no flags at all.
 */
async function seedHotelSport(userId: string): Promise<void> {
  await prisma.lodging.create({
    data: {
      userId,
      name: "Hotel Sport",
      address: "Grajska cesta 2, Otočec, Slovenia",
      country: "Romania",
      isoCountryCode: "RO",
    },
  });
}

const EXPECTED_KINDS = ["address_country_mismatch", "undated_country_evidence"];

describe("runDataQualityChecks under a concurrent pass", () => {
  let userId: string;

  beforeEach(async () => {
    const user = await prisma.user.create({
      data: {
        username: `dq-race-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        passwordHash: "x",
      },
    });
    userId = user.id;
  });

  afterEach(async () => {
    await prisma.user.delete({ where: { id: userId } });
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("lets both passes finish, and neither claims the other's row", async () => {
    await seedHotelSport(userId);

    const settled = await Promise.allSettled([
      runDataQualityChecks(userId),
      runDataQualityChecks(userId),
    ]);

    // A rejection here IS the defect: the loser's pass died on a collision the
    // database had already handled correctly.
    const rejected = settled.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    );
    expect(rejected.map((r) => String(r.reason))).toEqual([]);

    const summaries = settled.flatMap((result) =>
      result.status === "fulfilled" ? [result.value] : []
    );
    expect(summaries).toHaveLength(2);

    // The storage layer holds one row per question, whichever pass wrote it.
    const flags = await prisma.dataQualityFlag.findMany({ where: { userId } });
    expect(flags.map((f) => f.kind).sort()).toEqual([...EXPECTED_KINDS].sort());
    expect(flags.every((f) => f.status === "open")).toBe(true);

    // And the counters add up to what happened: two questions were opened in
    // total, not two per pass. Whether they collided or happened to serialise,
    // `opened` never counts a row the other pass inserted.
    const totalOpened = summaries.reduce((sum, s) => sum + s.opened, 0);
    expect(totalOpened).toBe(2);
    expect(summaries.map((s) => s.reopened)).toEqual([0, 0]);
    expect(summaries.map((s) => s.autoResolved)).toEqual([0, 0]);

    // Neither pass stopped early: each one only reaches its closing count after
    // it has reconciled every finding, so both seeing both flags is the proof
    // that the loser ran to the end.
    expect(summaries.map((s) => s.open)).toEqual([2, 2]);
  });

  /**
   * The natural race above only collides when the scheduler interleaves the two
   * passes, which is likely but not a guarantee — so it cannot be the decisive
   * test. This forces the exact interleaving instead: a pass whose read of the
   * flags happened before the other pass wrote anything.
   *
   * Only the READ is faked. The create, the unique index and the P2002 are the
   * real ones, and every finding is guaranteed to collide, so the adoption path
   * is exercised deterministically on every run.
   */
  const withStaleFlagRead = async <T>(body: () => Promise<T>): Promise<T> => {
    const spy = jest
      .spyOn(prisma.dataQualityFlag, "findMany")
      .mockImplementation(
        () => Promise.resolve([]) as ReturnType<typeof prisma.dataQualityFlag.findMany>
      );
    try {
      return await body();
    } finally {
      spy.mockRestore();
    }
  };

  it("adopts the row the other pass wrote instead of counting it as opened", async () => {
    await seedHotelSport(userId);
    const first = await runDataQualityChecks(userId);
    expect(first.opened).toBe(2);

    const second = await withStaleFlagRead(() => runDataQualityChecks(userId));

    // Every create in this pass lost. None of it is this pass's work, and the
    // details both passes derived are identical — so it reports exactly what a
    // sequential second run reports: nothing.
    expect(second).toEqual({ opened: 0, reopened: 0, updated: 0, autoResolved: 0, open: 2 });

    const flags = await prisma.dataQualityFlag.findMany({ where: { userId } });
    expect(flags).toHaveLength(2);
  });

  it("does not resurrect a dismissed flag it lost the create to", async () => {
    // The reason this is catch-and-adopt rather than an `upsert`: an upsert has
    // to name its update payload before it can see the row's status, and the
    // only payload that fits the create case ("open, with these details") turns
    // "this is not wrong, stop asking" back into an open question every time
    // two passes overlap. The escape hatch has to be permanent or it is not one.
    await seedHotelSport(userId);
    await runDataQualityChecks(userId);

    const mismatch = await prisma.dataQualityFlag.findFirstOrThrow({
      where: { userId, kind: "address_country_mismatch" },
    });
    await prisma.dataQualityFlag.update({
      where: { id: mismatch.id },
      data: { status: "dismissed", resolvedAt: new Date() },
    });

    const summary = await withStaleFlagRead(() => runDataQualityChecks(userId));

    const after = await prisma.dataQualityFlag.findUniqueOrThrow({ where: { id: mismatch.id } });
    expect(after.status).toBe("dismissed");
    expect(summary).toMatchObject({ opened: 0, reopened: 0, updated: 0, open: 1 });
  });

  it("re-opens a resolved flag it lost the create to", async () => {
    // The other half of the same table. A collision must not make "I corrected
    // the data" stick when the contradiction is still there — the transition
    // depends on the row's current status, not on when this pass first saw it.
    await seedHotelSport(userId);
    await runDataQualityChecks(userId);
    await prisma.dataQualityFlag.updateMany({
      where: { userId, kind: "address_country_mismatch" },
      data: { status: "resolved", resolvedAt: new Date() },
    });

    const summary = await withStaleFlagRead(() => runDataQualityChecks(userId));

    expect(summary).toMatchObject({ opened: 0, reopened: 1, open: 2 });
    const flags = await prisma.dataQualityFlag.findMany({ where: { userId } });
    expect(flags.every((f) => f.status === "open")).toBe(true);
  });

  it("still runs the checks that come after the one that collided", async () => {
    // The defect in one sentence: the loser's remaining checks never ran. So a
    // finding that only the second pass can see has to survive a collision on
    // the findings before it. `collectFindings` yields address mismatches, then
    // undated countries, then reversed stays — the reversed stay is last, and
    // therefore behind both collisions.
    await seedHotelSport(userId);
    await runDataQualityChecks(userId);

    const lisbon = await prisma.lodging.create({
      // No address, so this house raises no mismatch; a dated stay, so Portugal
      // is dated evidence and raises no undated-country flag either. Its ONLY
      // finding is the reversed pair — which is what makes it a clean probe.
      data: { userId, name: "Pensão Lisboa", country: "Portugal", isoCountryCode: "PT" },
    });
    await prisma.lodgingStay.create({
      data: {
        userId,
        lodgingId: lisbon.id,
        checkIn: new Date("2024-09-03"),
        checkOut: new Date("2024-03-09"),
      },
    });

    const summary = await withStaleFlagRead(() => runDataQualityChecks(userId));

    expect(summary.opened).toBe(1);
    const kinds = (await prisma.dataQualityFlag.findMany({ where: { userId } }))
      .map((f) => f.kind)
      .sort();
    expect(kinds).toEqual([...EXPECTED_KINDS, "stay_dates_reversed"].sort());
  });
});
