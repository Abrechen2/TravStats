import { randomUUID } from "crypto";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";

/**
 * Sharing UAT 2: deleting the test account on the Beta left 58 empty share groups and 73 inbound
 * log rows behind. A group a trip was offered in from another server has no creator here, and its
 * members (the account's trip and its membership row) went with the account. Deleting an account now
 * removes the groups only it held, with the inbound log rows of their home; a group someone else
 * still holds stays.
 */
const ADMIN = "adminDeleteGroupsAdmin";
const VICTIM = "adminDeleteGroupsVictim";
const BYSTANDER = "adminDeleteGroupsBystander";
const HOME = "https://home.example.org";

const cookiesOf = (res: request.Response): string[] =>
  (res.headers["set-cookie"] as unknown as string[]) ?? [];

async function makeUser(username: string, isAdmin = false): Promise<string> {
  await prisma.user.deleteMany({ where: { username } });
  const user = await prisma.user.create({
    data: { username, passwordHash: await hashPassword("password123"), isAdmin },
  });
  return user.id;
}

describe("DELETE /admin/users/:id and the account's share groups", () => {
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: [ADMIN, VICTIM, BYSTANDER] } } });
    await prisma.tripShareInbound.deleteMany({ where: { peerOrigin: HOME } });
    await prisma.$disconnect();
  });

  it("removes the empty groups and their inbound log, and keeps a group someone else holds", async () => {
    await makeUser(ADMIN, true);
    const victim = await makeUser(VICTIM);
    const bystander = await makeUser(BYSTANDER);
    const remote = await prisma.remoteShareAccount.create({
      data: {
        userId: victim,
        origin: HOME,
        channel: randomUUID(),
        localChannel: randomUUID(),
        username: "dennis",
        displayName: "Dennis",
        state: "active",
      },
    });
    const lonelyRef = randomUUID();
    const lonely = await prisma.tripShareGroup.create({
      data: { homeOrigin: HOME, federatedRef: lonelyRef, createdById: null },
    });
    await prisma.trip.create({ data: { userId: victim, name: "Linked", shareGroupId: lonely.id } });
    await prisma.tripShareRemoteMember.create({
      data: { groupId: lonely.id, remoteId: remote.id, state: "active" },
    });
    const offeredOnly = await prisma.tripShareGroup.create({
      data: { homeOrigin: HOME, federatedRef: randomUUID(), createdById: null },
    });
    await prisma.tripShareRemoteMember.create({
      data: { groupId: offeredOnly.id, remoteId: remote.id, state: "invited" },
    });
    const shared = await prisma.tripShareGroup.create({ data: { createdById: victim } });
    await prisma.trip.create({ data: { userId: victim, name: "Ours", shareGroupId: shared.id } });
    await prisma.trip.create({
      data: { userId: bystander, name: "Ours too", shareGroupId: shared.id },
    });
    await prisma.tripShareInbound.create({
      data: { peerOrigin: HOME, messageId: randomUUID(), groupRef: lonelyRef, reply: {} },
    });
    await prisma.tripShareInbound.create({
      data: { peerOrigin: HOME, messageId: randomUUID(), groupRef: "someone-else", reply: {} },
    });

    const login = await request(app)
      .post("/api/v1/auth/login")
      .send({ username: ADMIN, password: "password123" });
    await request(app)
      .delete(`/api/v1/admin/users/${victim}`)
      .set("Cookie", cookiesOf(login))
      .expect(200);

    const left = await prisma.tripShareGroup.findMany({
      where: { id: { in: [lonely.id, offeredOnly.id, shared.id] } },
      select: { id: true },
    });
    expect(left.map((g) => g.id)).toEqual([shared.id]);
    const inbound = await prisma.tripShareInbound.findMany({ where: { peerOrigin: HOME } });
    expect(inbound.map((r) => r.groupRef)).toEqual(["someone-else"]);
  });
});
