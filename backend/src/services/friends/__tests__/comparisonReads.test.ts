import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { readLeaderboard } from "../../comparison/leaderboard";
import { listPeople } from "../../comparison/consents";
import { DEFAULT_ON, acceptLocal, findLocal, requestLocal, revokeLocal } from "../localConnections";

jest.setTimeout(30_000);
const created: string[] = [];
async function user() {
  const u = await prisma.user.create({
    data: { username: `fr-cr-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
  });
  created.push(u.id);
  return u.id;
}
const keys = async (viewer: string) =>
  (await readLeaderboard(viewer, { year: null })).rows.map((r) => r.person.key);

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

it("a friend's figures reach the viewer only while the CONNECTION says so, even if a stored consent drifted", async () => {
  const [a, b] = [await user(), await user()];
  await requestLocal(a, b, DEFAULT_ON);
  await acceptLocal(b, a, DEFAULT_ON);
  expect(await keys(b)).toEqual(["self", `local:${a}`]);
  expect(await keys(a)).toEqual(["self", `local:${b}`]);

  // b switches the leaderboard off in the connection, but a's stored consent (and b's) is forced
  // back to "accepted" as a stale row would be: the connection still wins.
  const row = (await findLocal(prisma, a, b))!;
  const bIsLow = row.userLowId === b;
  await prisma.localConnection.update({
    where: { id: row.id },
    data: { [bIsLow ? "lowSwitches" : "highSwitches"]: { ...DEFAULT_ON, leaderboard: false } },
  });
  await prisma.leaderboardConsent.updateMany({
    where: { ownerId: { in: [a, b] }, viewerId: { in: [a, b] } },
    data: { status: "accepted" },
  });
  expect(await keys(a)).toEqual(["self"]); // b no longer shares back... and gives nothing
  expect(await keys(b)).toEqual(["self"]); // a shares, but b no longer shares back
});

it("a revoked friend is not on the board and is not asked a question by the mutual rule", async () => {
  const [a, b] = [await user(), await user()];
  await requestLocal(a, b, DEFAULT_ON);
  await acceptLocal(b, a, { ...DEFAULT_ON, leaderboard: false });
  await revokeLocal(a, b);
  expect(await keys(a)).toEqual(["self"]);
  expect(await keys(b)).toEqual(["self"]);
  // Even a leftover accepted consent from a to b (before the revoke) opens nothing.
  await prisma.leaderboardConsent.updateMany({
    where: { ownerId: a, viewerId: b },
    data: { status: "accepted" },
  });
  await prisma.leaderboardConsent.upsert({
    where: { ownerId_viewerId: { ownerId: b, viewerId: a } },
    create: {
      ownerId: b,
      viewerId: a,
      status: "accepted",
      scope: { groups: ["distance"], domains: ["flight"], year: null },
    },
    update: { status: "accepted" },
  });
  expect(await keys(a)).toEqual(["self"]);
  const people = await listPeople(a);
  expect(people.requests.map((r) => r.person.key)).not.toContain(`local:${b}`);
});
