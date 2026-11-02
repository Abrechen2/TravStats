/**
 * `/api/v1/sharing/connections` (spec 2026-11-02 §5): enveloped answers, everything absent while
 * cross-server sharing is off, bodies strict, each refusal reaching the client as a code, and the
 * inbox badge counting the requests waiting.
 */
import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { prisma } from "../../db";
import logger from "../../utils/logger";
import { errorHandler } from "../../middleware/errorHandler";
import { setTripFlags } from "../../services/sharing/federation/__tests__/instanceFlags";
import { withTripFederation } from "../../services/sharing/federation/__tests__/federationEnv";
import sharingConnections from "../sharingConnections";
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

const ME = "https://me.sharing-connections-route.test";
const FAR = "https://far.sharing-connections-route.test";
const app = express();
app.use(express.json());
app.use("/api/v1/sharing/connections", sharingConnections);
app.use("/api/v1/sharing", sharing);
app.use(errorHandler);
const users: string[] = [];
let restoreEnv: () => Promise<void>;
let anna: string;
let info: jest.SpyInstance;
const as = (userId: string) => ({ "x-test-user": userId });
const SWITCHES = {
  plans: true,
  stats: "overview",
  achievements: false,
  leaderboard: false,
  tripOffers: true,
};

const seed = (state: string, extra: object = {}) =>
  prisma.remoteShareAccount.create({
    data: {
      userId: anna,
      origin: FAR,
      channel: randomUUID(),
      localChannel: randomUUID(),
      username: `ben-${randomUUID().slice(0, 6)}`,
      displayName: "Ben",
      state,
      ...extra,
    },
  });

beforeAll(async () => {
  restoreEnv = await withTripFederation(ME);
  anna = (
    await prisma.user.create({
      data: { username: `cr-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
    })
  ).id;
  users.push(anna);
});
beforeEach(async () => {
  info = jest.spyOn(logger, "info").mockImplementation(() => undefined as never);
  await prisma.remoteShareAccount.deleteMany({ where: { userId: anna } });
});
afterEach(() => info.mockRestore());
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await restoreEnv();
  await prisma.$disconnect();
});

it("lists connections enveloped, with the asker's choice on a waiting request", async () => {
  await seed("pending_in", { remoteSwitches: SWITCHES, requestedAt: new Date() });
  const res = await request(app).get("/api/v1/sharing/connections").set(as(anna));
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.data).toHaveLength(1);
  expect(res.body.data[0]).toMatchObject({
    origin: FAR,
    state: "pending_in",
    theirs: SWITCHES,
    mine: {
      plans: false,
      stats: "off",
      achievements: false,
      leaderboard: false,
      tripOffers: false,
    },
    confirmedAt: null,
  });
});

it("counts waiting requests and pairings to confirm in the inbox badge, inside the total", async () => {
  await seed("pending_in");
  await seed("reconfirm");
  await seed("active");
  const res = await request(app).get("/api/v1/sharing/inbox/count").set(as(anna));
  expect(res.body.data).toMatchObject({ connectionRequests: 2 });
  expect(res.body.data.count).toBeGreaterThanOrEqual(2);
});

describe("asking", () => {
  it("names an unadmitted server in the refusal, and keeps no row", async () => {
    const res = await request(app)
      .post("/api/v1/sharing/connections")
      .set(as(anna))
      .send({ origin: FAR, username: "ben", switches: SWITCHES });
    expect(res.status).toBe(403);
    expect(res.body).toMatchObject({ code: "SHARE_REMOTE_PEER_NOT_ADMITTED", origin: FAR });
    expect(await prisma.remoteShareAccount.count({ where: { userId: anna } })).toBe(0);
  });

  it.each([
    ["an unknown field", { origin: FAR, username: "ben", switches: SWITCHES, userId: "victim" }],
    ["a missing switch", { origin: FAR, username: "ben", switches: { plans: true } }],
    [
      "a stats level that does not exist",
      { origin: FAR, username: "ben", switches: { ...SWITCHES, stats: "all" } },
    ],
    [
      "an origin that is not a server",
      { origin: "not a url", username: "ben", switches: SWITCHES },
    ],
    ["an empty name", { origin: FAR, username: "  ", switches: SWITCHES }],
  ])("refuses %s at the boundary", async (_name, body) => {
    const res = await request(app).post("/api/v1/sharing/connections").set(as(anna)).send(body);
    expect(res.status).toBe(400);
  });
});

describe("answering and changing", () => {
  it("accept, decline, switches and end of someone else's or a missing connection are 404", async () => {
    const missing = randomUUID();
    for (const [method, path, body] of [
      ["post", `/${missing}/accept`, { switches: SWITCHES }],
      ["post", `/${missing}/decline`, undefined],
      ["put", `/${missing}/switches`, { switches: SWITCHES }],
      ["delete", `/${missing}`, undefined],
    ] as const) {
      const res = await request(app)
        [method](`/api/v1/sharing/connections${path}`)
        .set(as(anna))
        .send(body);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("SHARE_REMOTE_PERSON_NOT_FOUND");
    }
  });

  it("refuses an action the state does not allow, with its own code", async () => {
    const waiting = await seed("pending_out");
    const active = await seed("revoked");
    for (const [method, path, body] of [
      ["post", `/${waiting.id}/accept`, { switches: SWITCHES }],
      ["post", `/${waiting.id}/decline`, undefined],
      ["put", `/${waiting.id}/switches`, { switches: SWITCHES }],
      ["delete", `/${active.id}`, undefined],
    ] as const) {
      const res = await request(app)
        [method](`/api/v1/sharing/connections${path}`)
        .set(as(anna))
        .send(body);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("SHARE_REMOTE_CONNECTION_STATE");
    }
  });

  it("takes back a request even when the other server cannot be told", async () => {
    const waiting = await seed("pending_out", { sharePlans: true });
    const res = await request(app)
      .delete(`/api/v1/sharing/connections/${waiting.id}`)
      .set(as(anna));
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ state: "revoked", mine: { plans: false } });
  });
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
    ["post", ""],
    ["post", `/${id}/accept`],
    ["post", `/${id}/decline`],
    ["put", `/${id}/switches`],
    ["delete", `/${id}`],
  ] as const)("refuses %s %s with SHARE_REMOTE_DISABLED", async (method, path) => {
    const res = await request(app)[method](`/api/v1/sharing/connections${path}`).set(as(anna));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SHARE_REMOTE_DISABLED");
  });

  it("counts no requests in the badge", async () => {
    await seed("pending_in");
    const res = await request(app).get("/api/v1/sharing/inbox/count").set(as(anna));
    expect(res.body.data.connectionRequests).toBe(0);
  });
});
