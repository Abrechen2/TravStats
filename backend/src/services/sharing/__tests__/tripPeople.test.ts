// backend/src/services/sharing/__tests__/tripPeople.test.ts
import { afterAll, beforeEach, describe, expect, it } from "@jest/globals";

import { prisma } from "../../../db";
import {
  linkWithConsent,
  makeAccount,
  sharedPair,
  wipeShareTestAccounts,
  type TestAccount,
} from "../../../routes/__tests__/sharingFixtures";
import { tripPeople } from "../tripPeople";

/**
 * One row per person on a trip (spec 2026-10-16, D9): every companion of the
 * trip and every member of its group, each with what the trip page needs to
 * say about them — and why sharing with them is not possible yet.
 */
describe("tripPeople", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let carl: TestAccount;

  const companionOnTrip = async (tripId: string, name: string, linkedUserId: string | null) => {
    const companion = await prisma.companion.create({
      data: {
        userId: anna.id,
        canonicalName: name.toLowerCase(),
        displayName: name,
        searchName: name.toLowerCase(),
        linkedUserId,
      },
    });
    const position = await prisma.tripCompanion.count({ where: { tripId } });
    await prisma.tripCompanion.create({ data: { tripId, companionId: companion.id, position } });
    return companion;
  };

  beforeEach(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-people");
    ben = await makeAccount("ben-people");
    carl = await makeAccount("carl-people");
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("says why an unlinked, a pending and a consenting companion can or cannot be shared with", async () => {
    const trip = await prisma.trip.create({ data: { userId: anna.id, name: "Rom" } });
    await companionOnTrip(trip.id, "Oma Ilse", null);
    await prisma.shareConsent.create({
      data: { requesterId: anna.id, targetId: carl.id, status: "pending" },
    });
    await companionOnTrip(trip.id, "Carl", carl.id);
    const benLink = await linkWithConsent(anna, ben);
    await prisma.tripCompanion.create({
      data: { tripId: trip.id, companionId: benLink.id, position: 2 },
    });

    const { people, linkableUsers } = await tripPeople(anna.id, trip);
    const by = (name: string) => people.find((p) => p.name === name)!;
    expect(by("Oma Ilse")).toMatchObject({ account: null, shareBlockedBy: "notLinked" });
    expect(by("Carl")).toMatchObject({ consent: "pending", shareBlockedBy: "consentPending" });
    expect(by(ben.username)).toMatchObject({
      consent: "accepted",
      member: false,
      shareBlockedBy: null,
    });
    expect(linkableUsers.map((u) => u.id)).toEqual([ben.id]);
  });

  it("lists a member who is no companion of the trip, and marks a member without consent", async () => {
    const { full } = await sharedPair(anna, ben);
    // Carl joined the group onward through Ben, before the consent rule: no
    // consent between Anna and Carl in either direction.
    const group = (await prisma.trip.findUniqueOrThrow({ where: { id: full.trip.id } }))
      .shareGroupId!;
    await prisma.trip.create({
      data: { userId: carl.id, name: "Lissabon 2025", shareGroupId: group },
    });

    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: full.trip.id } });
    const { people } = await tripPeople(anna.id, trip);
    const benRow = people.find((p) => p.account?.id === ben.id)!;
    const carlRow = people.find((p) => p.account?.id === carl.id)!;
    expect(benRow).toMatchObject({
      member: true,
      receivesChanges: true,
      shareBlockedBy: "alreadyMember",
    });
    expect(carlRow).toMatchObject({
      key: `u:${carl.id}`,
      companionId: null,
      member: true,
      receivesChanges: false,
    });
  });

  it("blocks a newcomer whom a current member has not agreed to", async () => {
    const { full } = await sharedPair(anna, ben);
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: full.trip.id } });
    const carlLink = await linkWithConsent(anna, carl);
    await prisma.tripCompanion.create({
      data: { tripId: trip.id, companionId: carlLink.id, position: 5 },
    });
    const { people } = await tripPeople(anna.id, trip);
    expect(people.find((p) => p.account?.id === carl.id)).toMatchObject({
      consent: "accepted",
      shareBlockedBy: "groupConsentMissing",
    });
  });

  it("never lists a deactivated account as linkable", async () => {
    const trip = await prisma.trip.create({ data: { userId: anna.id, name: "Wien" } });
    await linkWithConsent(anna, ben);
    await linkWithConsent(anna, carl);
    await prisma.user.update({ where: { id: carl.id }, data: { isActive: false } });
    const { linkableUsers } = await tripPeople(anna.id, trip);
    expect(linkableUsers.map((u) => u.id)).toEqual([ben.id]);
  });

  it("blocks a deactivated account that has accepted, and still lists a deactivated member", async () => {
    const { full } = await sharedPair(anna, ben);
    const trip = await prisma.trip.findUniqueOrThrow({ where: { id: full.trip.id } });
    const carlLink = await linkWithConsent(anna, carl);
    await prisma.tripCompanion.create({
      data: { tripId: trip.id, companionId: carlLink.id, position: 5 },
    });
    await prisma.user.update({ where: { id: carl.id }, data: { isActive: false } });
    await prisma.user.update({ where: { id: ben.id }, data: { isActive: false } });
    const { people } = await tripPeople(anna.id, trip);
    expect(people.find((p) => p.account?.id === carl.id)).toMatchObject({
      consent: "accepted",
      member: false,
      shareBlockedBy: "accountInactive",
    });
    expect(people.find((p) => p.account?.id === ben.id)).toMatchObject({
      member: true,
      receivesChanges: true,
      shareBlockedBy: "accountInactive",
    });
  });
});
