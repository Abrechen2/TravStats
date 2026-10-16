import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { suspendComparisonAfterRestore } from "../restore";

const users: string[] = [];
const scope = { groups: ["trips"], domains: ["flight"], year: null };

async function makeUser(): Promise<string> {
  const u = await prisma.user.create({
    data: { username: `lb-rs-${randomUUID().slice(0, 8)}`, passwordHash: "x" },
  });
  users.push(u.id);
  return u.id;
}

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

describe("suspendComparisonAfterRestore - leaderboard consents", () => {
  it("turns accepted leaderboard consents back into questions and voids invitations", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await prisma.leaderboardConsent.create({
      data: { ownerId: a, viewerId: b, status: "accepted", scope, decidedAt: new Date() },
    });
    await prisma.leaderboardInvite.create({
      data: { hash: randomUUID(), userId: a, expiresAt: new Date(Date.now() + 60_000) },
    });
    await suspendComparisonAfterRestore();
    expect(await prisma.leaderboardConsent.findFirst({ where: { ownerId: a } })).toMatchObject({
      status: "pending",
      decidedAt: null,
    });
    expect(await prisma.leaderboardInvite.count({ where: { userId: a } })).toBe(0);
  });

  it("turns a held-back offer into a question so it cannot auto-accept unconfirmed", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await prisma.leaderboardConsent.create({
      data: { ownerId: a, viewerId: b, status: "pending", scope, decidedAt: new Date() },
    });
    await suspendComparisonAfterRestore();
    expect(await prisma.leaderboardConsent.findFirst({ where: { ownerId: a } })).toMatchObject({
      status: "pending",
      decidedAt: null,
    });
  });

  it("re-asks a remote friend's consent the same way and leaves declined rows alone", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const remote = await prisma.leaderboardRemote.create({
      data: {
        userId: a,
        origin: "https://other.example",
        channel: randomUUID(),
        username: "far",
        displayName: "Far",
      },
    });
    await prisma.leaderboardConsent.create({
      data: { ownerId: a, remoteId: remote.id, status: "accepted", scope, decidedAt: new Date() },
    });
    const declinedAt = new Date("2026-01-01T00:00:00Z");
    await prisma.leaderboardConsent.create({
      data: { ownerId: b, viewerId: a, status: "declined", decidedAt: declinedAt },
    });
    await suspendComparisonAfterRestore();
    expect(
      await prisma.leaderboardConsent.findFirst({ where: { remoteId: remote.id } })
    ).toMatchObject({
      status: "pending",
      decidedAt: null,
    });
    expect(await prisma.leaderboardConsent.findFirst({ where: { ownerId: b } })).toMatchObject({
      status: "declined",
      decidedAt: declinedAt,
    });
  });
});
