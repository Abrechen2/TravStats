import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma } from "../../../db";
import { JWT_SECRET } from "../../../utils/jwtSecret";
import friendsRouter from "../../../routes/friends";
import { errorHandler } from "../../../middleware/errorHandler";
import { friendsListSchema, friendSchema } from "../../../schemas/friends";
import { setLeaderboardConsent } from "../../federation/leaderboardBridge";
import type { LeaderboardScope } from "../../../schemas/comparison";
import { DEFAULT_ON } from "../localConnections";

jest.setTimeout(30_000);
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/v1/friends", friendsRouter);
app.use(errorHandler);
const cookie = (id: string) => "auth_token=" + jwt.sign({ userId: id, epoch: 0 }, JWT_SECRET);
const api = (
  method: "get" | "post" | "put" | "delete",
  url: string,
  who: string,
  body?: object
) => {
  const r = request(app)
    [method]("/api/v1/friends" + url)
    .set("Cookie", cookie(who));
  return body ? r.send(body) : r;
};
const created: string[] = [];
async function user() {
  const u = await prisma.user.create({
    data: { username: `fr-rt-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
  });
  created.push(u.id);
  return u;
}
const SCOPE: LeaderboardScope = { groups: ["distance"], domains: ["flight"], year: 2024 };

afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: created } } });
  await prisma.$disconnect();
});

it("asks a local person, never saying whether a name exists, and the other side answers", async () => {
  const [a, b] = [await user(), await user()];
  const real = await api("post", "", a.id, {
    username: b.username,
    origin: null,
    switches: DEFAULT_ON,
  });
  const ghost = await api("post", "", a.id, {
    username: "nobody-" + randomUUID(),
    origin: null,
    switches: DEFAULT_ON,
  });
  expect([real.status, real.body]).toEqual([201, { success: true, data: { requested: true } }]);
  expect([ghost.status, ghost.body]).toEqual([real.status, real.body]);

  const forB = friendsListSchema.parse((await api("get", "", b.id)).body.data);
  expect(forB.friends).toEqual([]);
  expect(forB.requests).toHaveLength(1);
  expect(forB.requests[0]).toMatchObject({
    key: `local:${a.id}`,
    state: "pending_in",
    theirs: DEFAULT_ON,
  });
  const forA = friendsListSchema.parse((await api("get", "", a.id)).body.data);
  expect(forA.friends[0]).toMatchObject({ key: `local:${b.id}`, state: "pending_out" });

  const accepted = await api("post", `/local:${a.id}/accept`, b.id, { switches: DEFAULT_ON });
  expect(accepted.status).toBe(200);
  expect(friendSchema.parse(accepted.body.data)).toMatchObject({
    state: "active",
    mine: DEFAULT_ON,
  });
  // A stale second accept is the named 409.
  const stale = await api("post", `/local:${a.id}/accept`, b.id, { switches: DEFAULT_ON });
  expect([stale.status, stale.body.code]).toEqual([409, "FRIENDS_CONNECTION_STATE"]);
});

it("keeps the scope across switches, and a switch update through the API does not widen it", async () => {
  const [a, b] = [await user(), await user()];
  await api("post", "", a.id, { username: b.username, origin: null, switches: DEFAULT_ON });
  await api("post", `/local:${a.id}/accept`, b.id, { switches: DEFAULT_ON });
  const put = await api("put", `/local:${b.id}/scope`, a.id, { scope: SCOPE });
  expect(put.body.data.scope).toEqual(SCOPE);
  await api("put", `/local:${b.id}/switches`, a.id, {
    switches: { ...DEFAULT_ON, leaderboard: false },
  });
  const on = await api("put", `/local:${b.id}/switches`, a.id, { switches: DEFAULT_ON });
  expect(on.body.data.scope).toEqual(SCOPE);
  // An invalid scope is refused before anything is stored.
  const bad = await api("put", `/local:${b.id}/scope`, a.id, {
    scope: { groups: [], domains: [], year: null },
  });
  expect(bad.status).toBe(400);
});

it("a remote leaderboard switch off and on restores the stored scope instead of resetting it (bridge)", async () => {
  const a = await user();
  const lb = await prisma.leaderboardRemote.create({
    data: {
      userId: a.id,
      origin: "https://peer.test",
      channel: randomUUID(),
      username: "x",
      displayName: "X",
    },
  });
  await prisma.leaderboardConsent.create({
    data: {
      ownerId: a.id,
      remoteId: lb.id,
      status: "accepted",
      scope: SCOPE as never,
      decidedAt: new Date(),
    },
  });
  await setLeaderboardConsent(a.id, lb.id, false);
  await setLeaderboardConsent(a.id, lb.id, true);
  const row = await prisma.leaderboardConsent.findUniqueOrThrow({
    where: { ownerId_remoteId: { ownerId: a.id, remoteId: lb.id } },
  });
  expect(row).toMatchObject({ status: "accepted", scope: SCOPE });
});

it("a missing or damaged stored scope fails closed: the friend is not on the board", async () => {
  const [a, b] = [await user(), await user()];
  await api("post", "", a.id, { username: b.username, origin: null, switches: DEFAULT_ON });
  await api("post", `/local:${a.id}/accept`, b.id, { switches: DEFAULT_ON });
  await prisma.leaderboardConsent.updateMany({
    where: { ownerId: a.id, viewerId: b.id },
    data: { scope: { groups: ["nope"] } as never },
  });
  const { readLeaderboard } = await import("../../comparison/leaderboard");
  const row = (await readLeaderboard(b.id, { year: null })).rows.find(
    (r) => r.person.key === `local:${a.id}`
  );
  expect(row?.status).toBe("notShared");
});

it("lists a remote connection and a comparison-only pairing, resolving both of a connection's ids", async () => {
  const a = await user();
  const lb = await prisma.leaderboardRemote.create({
    data: {
      userId: a.id,
      origin: "https://old.test",
      channel: randomUUID(),
      username: "olga",
      displayName: "Olga",
      theirStatus: "ok",
    },
  });
  await prisma.leaderboardConsent.create({
    data: {
      ownerId: a.id,
      remoteId: lb.id,
      status: "accepted",
      scope: SCOPE as never,
      decidedAt: new Date(),
    },
  });
  const lb2 = await prisma.leaderboardRemote.create({
    data: {
      userId: a.id,
      origin: "https://new.test",
      channel: randomUUID(),
      username: "nia",
      displayName: "Nia",
    },
  });
  const conn = await prisma.remoteShareAccount.create({
    data: {
      userId: a.id,
      origin: "https://new.test",
      channel: randomUUID(),
      localChannel: randomUUID(),
      username: "nia",
      displayName: "Nia",
      leaderboardRemoteId: lb2.id,
      state: "active",
    },
  });
  const list = friendsListSchema.parse((await api("get", "", a.id)).body.data);
  expect(list.friends.find((f) => f.username === "olga")).toMatchObject({
    key: `remote:${lb.id}`,
    comparisonOnly: true,
    state: "active",
    connectionId: null,
    mine: { leaderboard: true },
    theirs: { leaderboard: true },
    scope: SCOPE,
  });
  expect(list.friends.find((f) => f.username === "nia")).toMatchObject({
    key: `remote:${lb2.id}`,
    comparisonOnly: false,
    connectionId: conn.id,
  });
  // The connection's own id and its pairing's id name the same person.
  for (const id of [conn.id, lb2.id]) {
    const scope = await api("put", `/remote:${id}/scope`, a.id, { scope: SCOPE });
    expect(scope.status).toBe(200);
    expect(scope.body.data.key).toBe(`remote:${lb2.id}`);
  }
  // Someone else's key is a 404, not a different answer.
  const stranger = await user();
  expect((await api("get", `/remote:${lb.id}/trips`, stranger.id)).status).toBe(404);
  // A comparison-only pairing has no switches to change.
  const sw = await api("put", `/remote:${lb.id}/switches`, a.id, { switches: DEFAULT_ON });
  expect([sw.status, sw.body.code]).toEqual([409, "FRIENDS_CONNECTION_STATE"]);
});

it("lists shared trips and plans of a local friend in both directions", async () => {
  const [a, b] = [await user(), await user()];
  await api("post", "", a.id, { username: b.username, origin: null, switches: DEFAULT_ON });
  await api("post", `/local:${a.id}/accept`, b.id, { switches: DEFAULT_ON });
  const { shareTripWithUser } = await import("../../sharing/shareTrip");
  const trip = await prisma.trip.create({ data: { userId: a.id, name: "Madeira" } });
  await shareTripWithUser(a.id, trip.id, b.id);
  const mine = await api("get", `/local:${b.id}/trips`, a.id);
  expect(mine.body.data.trips).toEqual([
    expect.objectContaining({ name: "Madeira", direction: "mine", linkedCopy: "delivered" }),
  ]);
  const theirs = await api("get", `/local:${a.id}/trips`, b.id);
  expect(theirs.body.data.trips).toEqual([
    expect.objectContaining({ name: "Madeira", direction: "theirs" }),
  ]);
  expect((await api("get", `/local:${b.id}/plans`, a.id)).body.data.plans).toEqual([]);
});
