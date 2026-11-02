/**
 * `/api/v1/remote-plans` (spec 2026-11-02 §4) on one server: enveloped answers, everything absent
 * while cross-server sharing is off, the refusal codes the member's client branches on, and the
 * inbox badge counting the plan invitations. The two-server behaviour is
 * `twoServersRemotePlans.test.ts`.
 */
import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { prisma } from "../../db";
import { errorHandler } from "../../middleware/errorHandler";
import { setTripFlags } from "../../services/sharing/federation/__tests__/instanceFlags";
import { withTripFederation } from "../../services/sharing/federation/__tests__/federationEnv";
import remotePlans from "../remotePlans";
import sharing from "../sharing";

jest.mock("../../middleware/auth", () => ({
  ...jest.requireActual("../../middleware/auth"),
  authenticate: (
    req: express.Request & { userId?: string },
    _res: express.Response,
    next: express.NextFunction
  ) => {
    req.userId = req.header("x-test-user");
    next();
  },
}));

const ME = "https://me.remote-plans-route.test";
const FAR = "https://far.remote-plans-route.test";
const app = express();
app.use(express.json());
app.use("/api/v1/remote-plans", remotePlans);
app.use("/api/v1/sharing", sharing);
app.use(errorHandler);
const users: string[] = [];
let restoreEnv: () => Promise<void>;
let anna: string;
const as = (userId: string) => ({ "x-test-user": userId });
const SWITCHES = {
  plans: true,
  stats: "off",
  achievements: false,
  leaderboard: false,
  tripOffers: false,
};

async function seed(state: "invited" | "active", options: { plansOn?: boolean } = {}) {
  const on = options.plansOn ?? true;
  const connection = await prisma.remoteShareAccount.create({
    data: {
      userId: anna,
      origin: FAR,
      channel: randomUUID(),
      localChannel: randomUUID(),
      username: `ben-${randomUUID().slice(0, 6)}`,
      displayName: "Ben",
      state: "active",
      sharePlans: on,
      remoteSwitches: { ...SWITCHES, plans: on },
    },
  });
  const membership = await prisma.remotePlanMembership.create({
    data: {
      userId: anna,
      connectionId: connection.id,
      planId: randomUUID(),
      tripId: randomUUID(),
      title: "Madeira",
      ownerDisplayName: "Ben",
      state,
    },
  });
  return { connection, membership };
}

beforeAll(async () => {
  restoreEnv = await withTripFederation(ME);
  anna = (
    await prisma.user.create({
      data: { username: `rp-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
    })
  ).id;
  users.push(anna);
});
beforeEach(async () => {
  await prisma.remoteShareAccount.deleteMany({ where: { userId: anna } });
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await restoreEnv();
  await prisma.$disconnect();
});

it("lists invitations and plans enveloped, and counts the invitations in the inbox badge", async () => {
  const { membership } = await seed("invited");
  await seed("active");
  const list = await request(app).get("/api/v1/remote-plans").set(as(anna));
  expect(list.status).toBe(200);
  expect(list.body.success).toBe(true);
  expect(list.body.data.map((p: { state: string }) => p.state).sort()).toEqual([
    "active",
    "invited",
  ]);
  expect(
    list.body.data.find((p: { planId: string }) => p.planId === membership.planId)
  ).toMatchObject({
    origin: FAR,
    title: "Madeira",
    ownerDisplayName: "Ben",
    role: "editor",
  });
  const count = await request(app).get("/api/v1/sharing/inbox/count").set(as(anna));
  expect(count.body.data.planInvites).toBe(1);
  expect(count.body.data.count).toBeGreaterThanOrEqual(1);
});

it("answers the 404 of a plan the caller has no membership on, for another person's plan alike", async () => {
  const { connection, membership } = await seed("active");
  const stranger = (
    await prisma.user.create({
      data: { username: `rp-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
    })
  ).id;
  users.push(stranger);
  for (const [who, planId] of [
    [anna, randomUUID()],
    [stranger, membership.planId],
  ] as const) {
    const res = await request(app)
      .get(`/api/v1/remote-plans/${connection.id}/${planId}`)
      .set(as(who));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("REMOTE_PLAN_NOT_FOUND");
  }
});

it("refuses with REMOTE_PLAN_NOT_SHARED when the person switched plans off, without asking the host", async () => {
  const { connection, membership } = await seed("active", { plansOn: false });
  const res = await request(app)
    .get(`/api/v1/remote-plans/${connection.id}/${membership.planId}`)
    .set(as(anna));
  expect(res.status).toBe(403);
  expect(res.body.code).toBe("REMOTE_PLAN_NOT_SHARED");
});

it("answers 503 REMOTE_PLAN_UNREACHABLE when the host cannot be reached, and keeps the invitation to try again", async () => {
  const { connection, membership } = await seed("invited");
  const res = await request(app)
    .post(`/api/v1/remote-plans/${connection.id}/${membership.planId}/accept`)
    .set(as(anna));
  expect(res.status).toBe(503);
  expect(res.body.code).toBe("REMOTE_PLAN_UNREACHABLE");
  expect(
    (await prisma.remotePlanMembership.findUniqueOrThrow({ where: { id: membership.id } })).state
  ).toBe("invited");
});

it("rejects a write body that is not an object, and a malformed id, before any peer call", async () => {
  const { connection, membership } = await seed("active");
  const body = await request(app)
    .post(`/api/v1/remote-plans/${connection.id}/${membership.planId}/mutations`)
    .set(as(anna))
    .send([1, 2]);
  expect(body.status).toBe(400);
  const id = await request(app)
    .get(`/api/v1/remote-plans/not-an-id/${membership.planId}`)
    .set(as(anna));
  expect(id.status).toBe(400);
});

describe("while cross-server sharing is off", () => {
  let before: Awaited<ReturnType<typeof setTripFlags>>;
  beforeEach(async () => {
    before = await setTripFlags({ tripFederationEnabled: false });
  });
  afterEach(async () => {
    await setTripFlags(before);
  });
  const id = "00000000-0000-4000-8000-000000000000";
  it.each([
    ["get", ""],
    ["get", `/${id}/${id}`],
    ["post", `/${id}/${id}/mutations`],
    ["post", `/${id}/${id}/accept`],
    ["post", `/${id}/${id}/leave`],
  ] as const)("refuses %s %s with SHARE_REMOTE_DISABLED", async (method, path) => {
    const res = await request(app)[method](`/api/v1/remote-plans${path}`).set(as(anna)).send({});
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SHARE_REMOTE_DISABLED");
  });

  it("counts no invitations in the badge", async () => {
    await seed("invited");
    const res = await request(app).get("/api/v1/sharing/inbox/count").set(as(anna));
    expect(res.body.data.planInvites).toBe(0);
  });
});

it("answers REMOTE_PLAN_ROUTE_REFUSED, not a bare 404, on forecast, climate, packing suggestions and proposals", async () => {
  const { connection, membership } = await seed("active");
  const base = `/api/v1/remote-plans/${connection.id}/${membership.planId}`;
  const calls = [
    request(app).post(`${base}/forecast`).send({}),
    request(app).post(`${base}/stations/${randomUUID()}/climate`).send({}),
    request(app).get(`${base}/packing-suggestions`),
    request(app).get(`${base}/proposals`),
    request(app).post(`${base}/proposals`).send({}),
  ];
  for (const call of calls) {
    const res = await call.set(as(anna));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("REMOTE_PLAN_ROUTE_REFUSED");
  }
});
