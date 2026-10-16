import { afterAll, beforeEach, describe, expect, it, jest } from "@jest/globals";

import { prisma } from "../../../db";
import {
  linkWithConsent,
  makeAccount,
  wipeShareTestAccounts,
  type TestAccount,
} from "../../../routes/__tests__/sharingFixtures";
import { backfillSharedFerries, unconsentedPairs } from "../backfillFerries";
import { shareTrip } from "../shareTrip";

/**
 * Production holds groups shared before crossings were shareable, and groups
 * joined onward before the consent rule (spec 2026-10-16, §10). The backfill
 * copies the missing crossings through the share path's own `copyInto`; the
 * report names the half-connected pairs. A dry run writes nothing.
 */
describe("sharing rollout — ferry backfill and consent report", () => {
  jest.setTimeout(30_000);
  let anna: TestAccount;
  let ben: TestAccount;
  let tripId: string;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-backfill");
    ben = await makeAccount("ben-backfill");
    tripId = (await prisma.trip.create({ data: { userId: anna.id, name: "Fjorde" } })).id;
    const companion = await linkWithConsent(anna, ben);
    await shareTrip(anna.id, tripId, companion.id);
    // A crossing filed on the shared trip as if before ferry was shareable:
    // written straight to the table, so nothing propagated it.
    await prisma.ferryJourney.create({
      data: {
        userId: anna.id,
        tripId,
        operator: "Fjord Line",
        depStationName: "Hirtshals",
        depLat: 57.5927,
        depLon: 9.9628,
        depTimezone: "Europe/Copenhagen",
        arrStationName: "Bergen",
        arrLat: 60.3958,
        arrLon: 5.3141,
        arrTimezone: "Europe/Oslo",
        departureTime: new Date("2026-07-01T18:00:00Z"),
        status: "scheduled",
      },
    });
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("counts on a dry run and writes nothing", async () => {
    const result = await backfillSharedFerries({ apply: false });
    expect(result).toMatchObject({ keyed: 1, copied: 1, joined: 0 });
    expect(await prisma.ferryJourney.count({ where: { userId: ben.id } })).toBe(0);
    expect(await prisma.ferryJourney.count({ where: { shareKey: { not: null } } })).toBe(0);
    expect(await prisma.shareNotice.count({ where: { userId: ben.id, entityType: "ferry" } })).toBe(
      0
    );
  });

  it("copies the crossing with a created notice when applied, once", async () => {
    await backfillSharedFerries({ apply: true });
    const second = await backfillSharedFerries({ apply: true });
    expect(second).toMatchObject({ keyed: 0, copied: 0, joined: 0 });
    expect(await prisma.ferryJourney.count({ where: { userId: ben.id } })).toBe(1);
    expect(
      await prisma.shareNotice.count({
        where: { userId: ben.id, kind: "created", entityType: "ferry" },
      })
    ).toBe(1);
  });

  it("skips an inactive member", async () => {
    await prisma.user.update({ where: { id: ben.id }, data: { isActive: false } });
    const result = await backfillSharedFerries({ apply: true });
    expect(result).toMatchObject({ keyed: 1, copied: 0 });
    expect(await prisma.ferryJourney.count({ where: { userId: ben.id } })).toBe(0);
    expect(await prisma.shareNotice.count({ where: { userId: ben.id, entityType: "ferry" } })).toBe(
      0
    );
  });

  it("reports a member pair without consent", async () => {
    const carl = await makeAccount("carl-backfill");
    const group = (await prisma.trip.findUniqueOrThrow({ where: { id: tripId } })).shareGroupId!;
    await prisma.trip.create({ data: { userId: carl.id, name: "Fjorde", shareGroupId: group } });
    const report = await unconsentedPairs();
    const entry = report.find((r) => r.groupId === group)!;
    expect(entry.pairs.map((p) => [...p].sort())).toEqual(
      expect.arrayContaining([[anna.id, carl.id].sort(), [ben.id, carl.id].sort()])
    );
    expect(entry.pairs).toHaveLength(2);
  });
});
