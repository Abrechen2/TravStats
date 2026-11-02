/**
 * Replacing this server's own federation key does locally what a peer's re-pin does on the other
 * side: every live connection goes to `reconfirm` and the plan memberships over them end, both as
 * host (member rows) and as member (remote_plan_memberships). Without it this side kept showing
 * `active` connections and plan members the peers had already ended.
 */
import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { errorHandler } from "../../../middleware/errorHandler";
import { ensureAdminSettingsRow } from "../../../services/adminSettingsRow";
import { resetIdentityCache } from "../../../services/federation/identity";
import federation from "../federation";

const app = express();
app.use(express.json());
app.use("/api/v1/admin/federation", federation);
app.use(errorHandler);
let rowId: number;
let userId: string;
const ORIGIN = "https://me.key-rotation.test";

beforeAll(async () => {
  rowId = await ensureAdminSettingsRow();
  userId = (
    await prisma.user.create({
      data: { username: `kr-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
    })
  ).id;
  await prisma.adminSettings.update({
    where: { id: rowId },
    data: { federationEnabled: true, federationOrigin: ORIGIN },
  });
  resetIdentityCache();
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.adminSettings.update({
    where: { id: rowId },
    data: { federationEnabled: false, federationOrigin: null, federationPrivateKey: null },
  });
  await prisma.$disconnect();
});

async function seed(state: string) {
  const connection = await prisma.remoteShareAccount.create({
    data: {
      userId,
      origin: `https://far-${randomUUID().slice(0, 6)}.key-rotation.test`,
      channel: randomUUID(),
      localChannel: randomUUID(),
      username: `p-${randomUUID().slice(0, 6)}`,
      displayName: "Peer",
      state,
      sharePlans: true,
      statsLevel: "full",
    },
  });
  const memberSide = await prisma.remotePlanMembership.create({
    data: {
      userId,
      connectionId: connection.id,
      planId: randomUUID(),
      tripId: randomUUID(),
      title: "Plan",
      ownerDisplayName: "Peer",
      state: "active",
    },
  });
  return { connection, memberSide };
}

it("rotating the own key sends live connections to reconfirm and ends plan memberships on both sides", async () => {
  const live = await seed("active");
  const ended = await seed("revoked");
  const trip = await prisma.trip.create({ data: { userId, name: "T" } });
  const plan = await prisma.travelPlan.create({
    data: { tripId: trip.id, createRef: randomUUID(), state: {} },
  });
  const member = await prisma.travelPlanMember.create({
    data: {
      planId: plan.id,
      kind: "remote",
      connectionId: live.connection.id,
      remoteOrigin: live.connection.origin,
      displayName: "Peer",
      status: "active",
    },
  });
  const res = await request(app).post("/api/v1/admin/federation/key").send({});
  expect(res.status).toBe(200);
  const conn = await prisma.remoteShareAccount.findUniqueOrThrow({
    where: { id: live.connection.id },
  });
  expect(conn.state).toBe("reconfirm");
  expect(conn.statsLevel).toBe("off");
  expect(conn.generation).toBeGreaterThan(live.connection.generation);
  expect(
    (await prisma.travelPlanMember.findUniqueOrThrow({ where: { id: member.id } })).status
  ).toBe("revoked");
  expect(
    (await prisma.remotePlanMembership.findUniqueOrThrow({ where: { id: live.memberSide.id } }))
      .state
  ).toBe("ended");
  // An ended connection stays ended.
  expect(
    (await prisma.remoteShareAccount.findUniqueOrThrow({ where: { id: ended.connection.id } }))
      .state
  ).toBe("revoked");
});

it("changing the own origin does the same, while re-saving the same origin touches nothing", async () => {
  const live = await seed("active");
  await request(app).put("/api/v1/admin/federation").send({ enabled: true, origin: ORIGIN });
  expect(
    (await prisma.remoteShareAccount.findUniqueOrThrow({ where: { id: live.connection.id } })).state
  ).toBe("active");
  const moved = await request(app)
    .put("/api/v1/admin/federation")
    .send({ enabled: true, origin: "https://moved.key-rotation.test" });
  expect(moved.status).toBe(200);
  expect(
    (await prisma.remoteShareAccount.findUniqueOrThrow({ where: { id: live.connection.id } })).state
  ).toBe("reconfirm");
});
