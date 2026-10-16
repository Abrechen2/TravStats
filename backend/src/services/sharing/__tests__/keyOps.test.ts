import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";

import { prisma } from "../../../db";
import {
  makeAccount,
  makeFullTrip,
  wipeShareTestAccounts,
  type TestAccount,
} from "../../../routes/__tests__/sharingFixtures";
import {
  assignShareKeys,
  clearTripKeys,
  keyedDelegate,
  keyedIdsOnTrip,
  sharedIdsOf,
} from "../keyOps";
import { SHARE_ENTITIES } from "../shareTypes";

/**
 * Keying, clearing and finding shared rows is one loop over the registry
 * (spec 2026-10-16, D2) — so a type added there is keyed on share, cleared on
 * detach and found by the bulk sync without a line elsewhere.
 */
describe("key operations over every registered type", () => {
  let anna: TestAccount;

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-keys");
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  /** makeFullTrip holds one flight, stay, cruise, rail ride and rental, two stops, no bus or ferry ride. */
  const expected = (entity: string) =>
    entity === "stop" ? 2 : entity === "bus" || entity === "ferry" ? 0 : 1;

  it("keys every entry of the trip once, and clears them again", async () => {
    const full = await makeFullTrip(anna);
    await prisma.$transaction((tx) => assignShareKeys(tx, anna.id, full.trip.id));
    for (const entity of SHARE_ENTITIES) {
      const ids = await prisma.$transaction((tx) =>
        keyedIdsOnTrip(tx, entity, anna.id, full.trip.id)
      );
      expect({ entity, n: ids.length }).toEqual({ entity, n: expected(entity) });
    }
    const first = await prisma.flight.findUniqueOrThrow({ where: { id: full.flight.id } });
    await prisma.$transaction((tx) => assignShareKeys(tx, anna.id, full.trip.id));
    const again = await prisma.flight.findUniqueOrThrow({ where: { id: full.flight.id } });
    expect(again.shareKey).toBe(first.shareKey);

    await prisma.$transaction((tx) => clearTripKeys(tx, anna.id, full.trip.id));
    for (const entity of SHARE_ENTITIES) {
      const left = await prisma.$transaction((tx) =>
        keyedDelegate(tx, entity).findMany({
          where: entity === "stop" ? { tripId: full.trip.id } : { userId: anna.id },
          select: { id: true, shareKey: true },
        })
      );
      expect({ entity, keyed: left.filter((r) => r.shareKey).length }).toEqual({
        entity,
        keyed: 0,
      });
    }
  });

  it("finds a user's rows on a shared trip for the bulk sync", async () => {
    const full = await makeFullTrip(anna);
    const group = await prisma.tripShareGroup.create({ data: { createdById: anna.id } });
    await prisma.trip.update({ where: { id: full.trip.id }, data: { shareGroupId: group.id } });
    for (const entity of SHARE_ENTITIES) {
      const ids = await prisma.$transaction((tx) => sharedIdsOf(tx, anna.id, entity));
      expect({ entity, n: ids.length }).toEqual({ entity, n: expected(entity) });
    }
  });
});
