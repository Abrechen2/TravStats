/**
 * A trip shared between two accounts of one server is taken without a question (the recipient's
 * consent said yes beforehand) — which is why nobody noticed it (2026-11-24). It must reach the
 * recipient's inbox marked "automatisch angenommen", the badge, the banner list, and name its
 * sharer as a companion where the recipient may link to them.
 */
import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { shareTripWithUser } from "../shareTrip";
import { inboxCount } from "../notices";
import { markReceivedTripsSeen, receivedTrips } from "../receivedTrips";

const users: string[] = [];
async function user(firstName: string): Promise<string> {
  const u = await prisma.user.create({
    data: { username: `rcv-${randomUUID().slice(0, 8)}`, passwordHash: "test-only", firstName },
  });
  users.push(u.id);
  return u.id;
}
const consent = (requesterId: string, targetId: string) =>
  prisma.shareConsent.create({ data: { requesterId, targetId, status: "accepted" } });

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

it("an auto-accepted share reaches the inbox, the badge and the banner list, marked as such", async () => {
  const anna = await user("Anna");
  const ben = await user("Ben");
  await consent(anna, ben);
  const trip = await prisma.trip.create({ data: { userId: anna, name: "Antarktis 2027" } });
  const before = await inboxCount(ben);

  const result = await shareTripWithUser(anna, trip.id, ben);
  expect(result.tripCreated).toBe(true);

  const notice = await prisma.shareNotice.findFirstOrThrow({
    where: { userId: ben, kind: "shared", entityType: "trip" },
  });
  expect(notice.after).toMatchObject({ tripName: "Antarktis 2027", autoAccepted: true });
  expect(await inboxCount(ben)).toBe(before + 1);
  const received = await receivedTrips(ben);
  expect(
    received.items.map((i) => [i.kind, i.tripName, i.from.displayName, i.autoAccepted])
  ).toEqual([["shared", "Antarktis 2027", "Anna", true]]);
  await markReceivedTripsSeen(ben);
  expect((await receivedTrips(ben)).count).toBe(0);
});

it("the recipient's new trip names the sharer as a linked companion when they may link to them", async () => {
  const anna = await user("Anna");
  const ben = await user("Ben");
  await consent(anna, ben);
  await consent(ben, anna);
  const trip = await prisma.trip.create({ data: { userId: anna, name: "Lissabon" } });
  const { groupId } = await shareTripWithUser(anna, trip.id, ben);
  const benTrip = await prisma.trip.findFirstOrThrow({
    where: { userId: ben, shareGroupId: groupId },
  });
  const links = await prisma.tripCompanion.findMany({
    where: { tripId: benTrip.id },
    include: { companion: true },
  });
  expect(links.map((l) => [l.companion.displayName, l.companion.linkedUserId])).toEqual([
    ["Anna", anna],
  ]);
  expect(benTrip.companions).toEqual(["Anna"]);
});

it("without the recipient's own consent, or over a same-name companion, nothing is linked", async () => {
  const anna = await user("Anna");
  const ben = await user("Ben");
  await consent(anna, ben);
  const trip = await prisma.trip.create({ data: { userId: anna, name: "Porto" } });
  const { groupId } = await shareTripWithUser(anna, trip.id, ben);
  const benTrip = await prisma.trip.findFirstOrThrow({
    where: { userId: ben, shareGroupId: groupId },
  });
  expect(await prisma.tripCompanion.count({ where: { tripId: benTrip.id } })).toBe(0);

  const cleo = await user("Cleo");
  await consent(cleo, ben);
  await consent(ben, cleo);
  const own = await prisma.companion.create({
    data: { userId: ben, canonicalName: "cleo", displayName: "Cleo", searchName: "cleo" },
  });
  const trip2 = await prisma.trip.create({ data: { userId: cleo, name: "Faro" } });
  const shared = await shareTripWithUser(cleo, trip2.id, ben);
  const benTrip2 = await prisma.trip.findFirstOrThrow({
    where: { userId: ben, shareGroupId: shared.groupId },
  });
  expect(await prisma.tripCompanion.count({ where: { tripId: benTrip2.id } })).toBe(0);
  expect(
    (await prisma.companion.findUniqueOrThrow({ where: { id: own.id } })).linkedUserId
  ).toBeNull();
});
