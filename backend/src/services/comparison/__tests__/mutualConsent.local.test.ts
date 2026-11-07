import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import type { LeaderboardScope } from "../../../schemas/comparison";
import { listPeople } from "../consents";
import { readLeaderboard } from "../leaderboard";

const SCOPE: LeaderboardScope = { groups: ["trips"], domains: ["flight"], year: null };
const users: string[] = [];
async function user(): Promise<{ id: string; username: string }> {
  const u = await prisma.user.create({
    data: { username: `lb-ml-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
  });
  users.push(u.id);
  return u;
}
const grant = (ownerId: string, viewerId: string, status = "accepted") =>
  prisma.leaderboardConsent.create({
    data: {
      ownerId,
      viewerId,
      status,
      scope: status === "pending" ? undefined : (SCOPE as never),
      decidedAt: status === "pending" ? null : new Date(),
    },
  });
const rowsFor = async (viewerId: string) =>
  (await readLeaderboard(viewerId, { year: null })).rows.filter((r) => r.person.kind !== "self");

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

it("one-sided accepted consent shows no figures", async () => {
  const [owner, viewer] = [await user(), await user()];
  await grant(owner.id, viewer.id);
  expect(await rowsFor(viewer.id)).toEqual([]);
});

it("the side that has not answered sees it as a request", async () => {
  const [owner, viewer] = [await user(), await user()];
  await grant(owner.id, viewer.id);
  const { requests } = await listPeople(viewer.id);
  expect(requests).toEqual([
    expect.objectContaining({ person: expect.objectContaining({ key: `local:${owner.id}` }) }),
  ]);
  // And answering it (the ordinary accept) makes the pair mutual.
  const { acceptConsent } = await import("../consents");
  await acceptConsent(viewer.id, requests[0].consentId, SCOPE);
  expect((await rowsFor(viewer.id)).map((r) => r.person.key)).toEqual([`local:${owner.id}`]);
  expect((await listPeople(viewer.id)).requests).toEqual([]);
});

it("a viewer who declined stays hidden and is not asked again", async () => {
  const [owner, viewer] = [await user(), await user()];
  await grant(owner.id, viewer.id);
  await grant(viewer.id, owner.id, "declined");
  expect(await rowsFor(viewer.id)).toEqual([]);
  expect((await listPeople(viewer.id)).requests).toEqual([]);
});

it("both accepted shows figures", async () => {
  const [owner, viewer] = [await user(), await user()];
  await grant(owner.id, viewer.id);
  await grant(viewer.id, owner.id);
  const rows = await rowsFor(viewer.id);
  expect(rows.map((r) => [r.person.key, r.status])).toEqual([[`local:${owner.id}`, "ok"]]);
});
