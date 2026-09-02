/**
 * The runner claims re-running is free. This is the claim measured, not read.
 *
 * Both new triggers rest on it entirely: the nightly sweep re-runs every
 * account every night, and an import re-runs the account it touched. If a
 * second run over unchanged data opened anything, wiring those two up would
 * turn the inbox into a duplicate machine within a week — and the property is
 * invisible in the code, because it depends on what a `jsonb` column does to
 * the key order of `details` on the way in and out.
 *
 * `runner.test.ts` next door asserts this against an in-memory double that
 * imitates the column. This asserts it against the column.
 */
import { prisma } from "../../db";
import { runDataQualityChecks } from "../dataQuality";

describe("runDataQualityChecks, run twice against Postgres", () => {
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: `dq-idempotence-${Date.now()}`, passwordHash: "x" },
    });
    userId = user.id;

    /**
     * The owner's own case, verbatim from design §1.4: a hotel whose address
     * names Slovenia while the row claims Romania. With no stay it is also a
     * country whose entire case is undated, so one row raises both an
     * `address_country_mismatch` and an `undated_country_evidence` — two flags
     * of different shapes, which is what makes the second run worth measuring.
     */
    await prisma.lodging.create({
      data: {
        userId,
        name: "Hotel Sport",
        address: "Grajska cesta 2, Otočec, Slovenia",
        country: "Romania",
        isoCountryCode: "RO",
      },
    });
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("opens nothing on the second run, and re-resolves nothing", async () => {
    const first = await runDataQualityChecks(userId);
    expect(first.opened).toBeGreaterThan(0);

    const second = await runDataQualityChecks(userId);

    expect(second.opened).toBe(0);
    expect(second.reopened).toBe(0);
    expect(second.autoResolved).toBe(0);
    // The third value is the one the jsonb key order breaks: an unchanged run
    // that "updates" is a pointless write on every sweep, for ever.
    expect(second.updated).toBe(0);
    expect(second.open).toBe(first.open);

    // And the storage layer agrees — no second copy of either question.
    const flags = await prisma.dataQualityFlag.findMany({ where: { userId } });
    expect(flags).toHaveLength(first.open);
    expect(flags.map((f) => f.kind).sort()).toEqual(
      ["address_country_mismatch", "undated_country_evidence"].sort()
    );
  });
});
