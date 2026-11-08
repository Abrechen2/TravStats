import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import type { LeaderboardScope } from "../../../schemas/comparison";
import type { ConnectionSwitches } from "../../../schemas/tripSharePeer";
import { ALL_OFF } from "../../sharing/federation/connections/switches";
import {
  DECLINE_BLOCK_MS,
  DEFAULT_ON,
  acceptLocal,
  declineLocal,
  findLocal,
  orderPair,
  requestLocal,
  revokeLocal,
  setLocalSwitches,
  sidesOf,
} from "../localConnections";
import { storeScope } from "../scopeStore";

const users: string[] = [];
async function user() {
  const u = await prisma.user.create({
    data: { username: `fr-lc-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
  });
  users.push(u.id);
  return u.id;
}
const rowsOf = async (a: string, b: string) => {
  const { low, high } = orderPair(a, b);
  return prisma.localConnection.findMany({ where: { userLowId: low, userHighId: high } });
};
const lb = (ownerId: string, viewerId: string) =>
  prisma.leaderboardConsent.findUnique({ where: { ownerId_viewerId: { ownerId, viewerId } } });
const SCOPE: LeaderboardScope = { groups: ["distance"], domains: ["flight"], year: 2024 };
const SW = (over: Partial<ConnectionSwitches> = {}): ConnectionSwitches => ({
  ...DEFAULT_ON,
  ...over,
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

it("keeps one row per unordered pair whoever asks, with the low id first", async () => {
  const [a, b] = [await user(), await user()];
  expect(await requestLocal(a, b, SW())).toBe("pending");
  const rows = await rowsOf(a, b);
  expect(rows).toHaveLength(1);
  expect(rows[0].userLowId < rows[0].userHighId).toBe(true);
  expect(rows[0]).toMatchObject({ state: "pending", requestedBy: a });
  const row = (await findLocal(prisma, b, a))!;
  expect(sidesOf(row, a)).toEqual({ mine: SW(), theirs: ALL_OFF });
});

it("a crossed request (both ask) is ONE active connection, no duplicate", async () => {
  const [a, b] = [await user(), await user()];
  await requestLocal(a, b, SW({ plans: false }));
  expect(await requestLocal(b, a, SW({ tripOffers: false }))).toBe("active");
  const rows = await rowsOf(a, b);
  expect(rows).toHaveLength(1);
  expect(rows[0].state).toBe("active");
  expect(sidesOf(rows[0], a)).toEqual({
    mine: SW({ plans: false }),
    theirs: SW({ tripOffers: false }),
  });
  // Asking again on a live connection is a named conflict, not a second row.
  await expect(requestLocal(a, b, SW())).rejects.toMatchObject({
    code: "FRIENDS_CONNECTION_EXISTS",
  });
  await expect(requestLocal(a, b, SW())).rejects.toMatchObject({ statusCode: 409 });
  expect(await rowsOf(a, b)).toHaveLength(1);
});

it("accepting activates it: the asker's choice stays, the answerer's switches are stored, linked copies may flow", async () => {
  const [a, b] = [await user(), await user()];
  await requestLocal(a, b, SW({ stats: "overview" }));
  const active = await acceptLocal(b, a, SW({ achievements: false }));
  expect(active.state).toBe("active");
  expect(sidesOf(active, a)).toEqual({
    mine: SW({ stats: "overview" }),
    theirs: SW({ achievements: false }),
  });
  const consents = await prisma.shareConsent.findMany({
    where: { requesterId: { in: [a, b] }, targetId: { in: [a, b] } },
  });
  expect(consents.map((c) => c.status)).toEqual(["accepted", "accepted"]);
  // Defaults on: both leaderboard switches stored a consent with the default scope.
  expect(await lb(a, b)).toMatchObject({ status: "accepted", scope: { year: null } });
  expect(await lb(b, a)).toMatchObject({ status: "accepted" });
});

it("a stale accept (after a revoke, a second accept, or by the asker) is FRIENDS_CONNECTION_STATE", async () => {
  const [a, b] = [await user(), await user()];
  await requestLocal(a, b, SW());
  // The asker cannot answer their own request.
  await expect(acceptLocal(a, b, SW())).rejects.toMatchObject({ code: "FRIENDS_CONNECTION_STATE" });
  await revokeLocal(a, b); // taken back
  await expect(acceptLocal(b, a, SW())).rejects.toMatchObject({
    code: "FRIENDS_CONNECTION_STATE",
    statusCode: 409,
  });
  await requestLocal(a, b, SW());
  await acceptLocal(b, a, SW());
  await expect(acceptLocal(b, a, SW())).rejects.toMatchObject({ code: "FRIENDS_CONNECTION_STATE" });
  await revokeLocal(b, a);
  await expect(acceptLocal(b, a, SW())).rejects.toMatchObject({ code: "FRIENDS_CONNECTION_STATE" });
  await expect(acceptLocal(b, await user(), SW())).rejects.toMatchObject({
    code: "FRIENDS_NOT_FOUND",
  });
});

it("declining ends the request and silently drops the same asker for 30 days, then reopens", async () => {
  const [a, b] = [await user(), await user()];
  await requestLocal(a, b, SW());
  expect((await declineLocal(b, a)).state).toBe("declined");
  await expect(declineLocal(b, a)).rejects.toMatchObject({ code: "FRIENDS_CONNECTION_STATE" });
  expect(await requestLocal(a, b, SW())).toBe("dropped");
  expect((await findLocal(prisma, a, b))!.state).toBe("declined");
  await prisma.localConnection.updateMany({
    where: { id: (await findLocal(prisma, a, b))!.id },
    data: { endedAt: new Date(Date.now() - DECLINE_BLOCK_MS - 1000) },
  });
  expect(await requestLocal(a, b, SW())).toBe("pending");
  // The decliner may always ask the declined one.
  await declineLocal(b, a);
  expect(await requestLocal(b, a, SW())).toBe("pending");
});

it("a revoked friend can be asked again; the revoke turned every switch and consent off", async () => {
  const [a, b] = [await user(), await user()];
  await requestLocal(a, b, SW());
  await acceptLocal(b, a, SW());
  const revoked = await revokeLocal(a, b);
  expect(revoked).toMatchObject({ state: "revoked", endedBy: a });
  expect(sidesOf(revoked, a)).toEqual({ mine: ALL_OFF, theirs: ALL_OFF });
  const consents = await prisma.shareConsent.findMany({
    where: { requesterId: { in: [a, b] }, targetId: { in: [a, b] } },
  });
  expect(consents.map((c) => c.status)).toEqual(["withdrawn", "withdrawn"]);
  expect((await lb(a, b))!.status).toBe("withdrawn");
  expect(await requestLocal(b, a, SW())).toBe("pending");
  expect((await rowsOf(a, b))[0]).toMatchObject({ state: "pending", requestedBy: b });
});

it("a switch update changes only the caller's side", async () => {
  const [a, b] = [await user(), await user()];
  await requestLocal(a, b, SW());
  await acceptLocal(b, a, SW());
  await setLocalSwitches(a, b, SW({ plans: false, tripOffers: false }));
  const row = (await findLocal(prisma, a, b))!;
  expect(sidesOf(row, a)).toEqual({ mine: SW({ plans: false, tripOffers: false }), theirs: SW() });
  // Not active: nothing to change.
  await revokeLocal(a, b);
  await expect(setLocalSwitches(a, b, SW())).rejects.toMatchObject({
    code: "FRIENDS_CONNECTION_STATE",
  });
});

it("switching the leaderboard off and on again restores the stored scope, never everything", async () => {
  const [a, b] = [await user(), await user()];
  await requestLocal(a, b, SW());
  await acceptLocal(b, a, SW());
  await prisma.$transaction((tx) => storeScope(tx, a, { viewerId: b }, SCOPE, true));
  await setLocalSwitches(a, b, SW({ leaderboard: false }));
  expect(await lb(a, b)).toMatchObject({ status: "withdrawn", scope: SCOPE });
  await setLocalSwitches(a, b, SW({ leaderboard: true }));
  expect(await lb(a, b)).toMatchObject({ status: "accepted", scope: SCOPE });
  // The same across a revoke and a new connection.
  await revokeLocal(a, b);
  await requestLocal(b, a, SW());
  await acceptLocal(a, b, SW());
  expect(await lb(a, b)).toMatchObject({ status: "accepted", scope: SCOPE });
});

it("leaves the other side's switch set untouched when one side revokes and re-accepts with fewer", async () => {
  const [a, b] = [await user(), await user()];
  await requestLocal(a, b, SW());
  await acceptLocal(b, a, SW());
  await setLocalSwitches(b, a, SW({ achievements: false }));
  expect(sidesOf((await findLocal(prisma, a, b))!, a).mine).toEqual(SW());
});
