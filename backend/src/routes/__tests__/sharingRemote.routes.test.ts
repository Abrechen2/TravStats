/**
 * `/api/v1/sharing/remote/*` (spec 2026-10-20, phase F-S4b): enveloped answers, `/status`
 * answering while off, everything else absent while off, and each refusal reaching the client as
 * a code — with the origin of a server the admin has not admitted, so the screen can name it.
 */
import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { prisma } from "../../db";
import logger from "../../utils/logger";
import { errorHandler } from "../../middleware/errorHandler";
import { setTripFlags } from "../../services/sharing/federation/__tests__/instanceFlags";
import { withTripFederation } from "../../services/sharing/federation/__tests__/federationEnv";
import sharingRemote from "../sharingRemote";

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

const ME = "https://me.sharing-remote-route.test";
const app = express();
app.use(express.json());
app.use("/api/v1/sharing/remote", sharingRemote);
app.use(errorHandler);
const users: string[] = [];
let restoreEnv: () => Promise<void>;
let anna: string;
let info: jest.SpyInstance;
const as = (userId: string) => ({ "x-test-user": userId });

beforeAll(async () => {
  restoreEnv = await withTripFederation(ME);
  anna = (
    await prisma.user.create({
      data: { username: `rr-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
    })
  ).id;
  users.push(anna);
});
beforeEach(() => {
  info = jest.spyOn(logger, "info").mockImplementation(() => undefined as never);
});
afterEach(() => info.mockRestore());
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await restoreEnv();
  await prisma.$disconnect();
});

it("reports availability and this server's origin", async () => {
  const res = await request(app).get("/api/v1/sharing/remote/status").set(as(anna));
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ success: true, data: { available: true, reason: null, origin: ME } });
});

it("issues, lists and revokes a code, enveloped, never listing the code again", async () => {
  const created = await request(app).post("/api/v1/sharing/remote/invites").set(as(anna));
  expect(created.status).toBe(201);
  expect(created.body.data.code).toMatch(new RegExp(`^${ME}#trip:[a-f0-9]{64}$`));
  const listed = await request(app).get("/api/v1/sharing/remote/invites").set(as(anna));
  expect(listed.body).toEqual({
    success: true,
    data: [
      {
        id: created.body.data.id,
        createdAt: expect.any(String),
        expiresAt: created.body.data.expiresAt,
        tripId: null,
      },
    ],
  });
  expect(JSON.stringify(listed.body)).not.toContain(created.body.data.code.split("#trip:")[1]);
  const revoked = await request(app)
    .delete(`/api/v1/sharing/remote/invites/${created.body.data.id}`)
    .set(as(anna));
  expect(revoked.body).toEqual({ success: true, data: { revoked: true } });
  const again = await request(app)
    .delete(`/api/v1/sharing/remote/invites/${created.body.data.id}`)
    .set(as(anna));
  expect(again.status).toBe(404);
  expect(again.body.code).toBe("SHARE_REMOTE_INVITE_NOT_FOUND");
});

it("names an unadmitted server's origin in the refusal body", async () => {
  const origin = "https://never-pinned.sharing-remote-route.test";
  const res = await request(app)
    .post("/api/v1/sharing/remote/claim")
    .set(as(anna))
    .send({ code: `${origin}#trip:${"ef".repeat(32)}` });
  expect(res.status).toBe(403);
  expect(res.body).toMatchObject({ code: "SHARE_REMOTE_PEER_NOT_ADMITTED", origin });
});

it("tells a leaderboard code from a malformed one", async () => {
  const wrong = await request(app)
    .post("/api/v1/sharing/remote/claim")
    .set(as(anna))
    .send({ code: `${ME}#${"ef".repeat(32)}` });
  expect(wrong.body.code).toBe("SHARE_REMOTE_INVITE_WRONG_TAG");
  const junk = await request(app)
    .post("/api/v1/sharing/remote/claim")
    .set(as(anna))
    .send({ code: "hello" });
  expect(junk.body.code).toBe("SHARE_REMOTE_INVITE_INVALID");
  const extra = await request(app)
    .post("/api/v1/sharing/remote/claim")
    .set(as(anna))
    .send({ code: "x", userId: "victim" });
  expect(extra.status).toBe(400);
});

it("lists the caller's remote people with their server", async () => {
  const far = await prisma.remoteShareAccount.create({
    data: {
      userId: anna,
      origin: "https://far.sharing-remote-route.test",
      channel: randomUUID(),
      localChannel: randomUUID(),
      username: "ben",
      displayName: "Ben",
      consentsTargeted: { create: { requesterId: anna, status: "accepted" } },
    },
  });
  const res = await request(app).get("/api/v1/sharing/remote/people").set(as(anna));
  expect(res.body.data).toEqual([
    {
      id: far.id,
      origin: "https://far.sharing-remote-route.test",
      username: "ben",
      displayName: "Ben",
      consent: "accepted",
      createdAt: far.createdAt.toISOString(),
    },
  ]);
});

describe("while the feature is off", () => {
  let before: Awaited<ReturnType<typeof setTripFlags>>;
  beforeEach(async () => {
    before = await setTripFlags({ tripFederationEnabled: false });
  });
  afterEach(async () => {
    await setTripFlags(before);
  });

  it("still answers /status, with the reason", async () => {
    const res = await request(app).get("/api/v1/sharing/remote/status").set(as(anna));
    expect(res.body.data).toEqual({ available: false, reason: "switch-off", origin: null });
  });

  it.each([
    ["get", "/invites"],
    ["post", "/invites"],
    ["get", "/people"],
    ["delete", "/invites/00000000-0000-4000-8000-000000000000"],
  ] as const)("refuses %s %s with SHARE_REMOTE_DISABLED", async (method, path) => {
    const res = await request(app)[method](`/api/v1/sharing/remote${path}`).set(as(anna));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SHARE_REMOTE_DISABLED");
  });
  // beta.22 UAT: claiming a code while the feature is off answered
  // SHARE_REMOTE_INVITE_INVALID (or a validation error) — the code was judged
  // before the switch was asked. Off means off, whatever the body says.
  it.each([
    ["post", "/claim", { code: "not-a-code" }],
    ["post", "/claim", { code: "" }],
    ["delete", "/invites/not-a-uuid", undefined],
  ] as const)(
    "refuses %s %s with an invalid body as SHARE_REMOTE_DISABLED",
    async (method, path, body) => {
      const call = request(app)[method](`/api/v1/sharing/remote${path}`).set(as(anna));
      const res = body ? await call.send(body) : await call;
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("SHARE_REMOTE_DISABLED");
    }
  );
});
