import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { prisma } from "../../db";
import { errorHandler } from "../../middleware/errorHandler";
import { getInstanceSettings } from "../../services/instanceSettingsService";
import { loadVisibleDomains } from "../../services/domainVisibility";
import { exchange } from "../../services/federation/security";
import comparison from "../comparison";

jest.mock("../../middleware/auth", () => ({
  ...jest.requireActual("../../middleware/auth"),
  authenticate: (
    req: express.Request & { userId?: string; apiToken?: unknown },
    _res: express.Response,
    next: express.NextFunction
  ) => {
    req.userId = req.header("x-test-user");
    if (req.header("x-test-pat")) req.apiToken = { id: "test", scope: "write" };
    next();
  },
}));
jest.mock("../../services/instanceSettingsService", () => ({ getInstanceSettings: jest.fn() }));
jest.mock("../../services/domainVisibility", () => ({
  ...jest.requireActual("../../services/domainVisibility"),
  loadVisibleDomains: jest.fn(),
}));
jest.mock("../../services/federation/security", () => ({
  ...jest.requireActual("../../services/federation/security"),
  exchange: jest.fn(),
}));

const app = express();
app.use(express.json());
app.use("/api/v1/comparison", comparison);
app.use(errorHandler);
const SCOPE = { groups: ["trips"], domains: ["ferry"], year: null };
const PEER = "https://peer.lb-route.test";
const users: Array<{ id: string; username: string }> = [];
async function user() {
  const u = await prisma.user.create({
    data: { username: `lb-route-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
  });
  users.push(u);
  return u;
}
/** A friend on another server whose consent (the caller's own) is accepted. */
async function remoteFriend(ownerId: string) {
  return prisma.leaderboardRemote.create({
    data: {
      userId: ownerId,
      origin: PEER,
      channel: randomUUID(),
      username: "far",
      displayName: "Far Away",
      consents: {
        create: { ownerId, status: "accepted", scope: SCOPE as never, decidedAt: new Date() },
      },
    },
    include: { consents: true },
  });
}

beforeEach(() => {
  jest.mocked(getInstanceSettings).mockResolvedValue({ betaFeaturesEnabled: true } as never);
  jest.mocked(loadVisibleDomains).mockResolvedValue(["ferry"]);
  jest.mocked(exchange).mockReset();
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  await prisma.$disconnect();
});

it("refuses tokens and a switched-off beta with named codes", async () => {
  const a = await user();
  const pat = await request(app)
    .get("/api/v1/comparison/people")
    .set("x-test-user", a.id)
    .set("x-test-pat", "1");
  expect(pat.status).toBe(403);
  expect(pat.body.code).toBe("COMPARISON_TOKEN_REFUSED");
  jest.mocked(getInstanceSettings).mockResolvedValue({ betaFeaturesEnabled: false } as never);
  const off = await request(app).get("/api/v1/comparison/people").set("x-test-user", a.id);
  expect(off.status).toBe(403);
  expect(off.body.code).toBe("COMPARISON_DISABLED");
});

it("runs the same-instance flow: ask, accept, rank, end", async () => {
  const [a, b] = [await user(), await user()];
  const asked = await request(app)
    .post("/api/v1/comparison/requests")
    .set("x-test-user", a.id)
    .send({ username: b.username, scope: SCOPE });
  expect(asked.status).toBe(201);
  // A request exposes nothing until it is accepted (owner ruling): the asker's yes is held back.
  expect(asked.body).toMatchObject({ success: true, data: { mine: { status: "pending" } } });

  const forB = await request(app).get("/api/v1/comparison/people").set("x-test-user", b.id);
  const consentId = forB.body.data.requests[0].consentId as string;
  const accepted = await request(app)
    .post(`/api/v1/comparison/consents/${consentId}/accept`)
    .set("x-test-user", b.id)
    .send({ scope: SCOPE });
  expect(accepted.status).toBe(200);

  const board = await request(app)
    .get("/api/v1/comparison/leaderboard?year=all")
    .set("x-test-user", a.id);
  expect(board.status).toBe(200);
  expect(board.body.data.rows.map((r: { person: { key: string } }) => r.person.key)).toEqual([
    "self",
    `local:${b.id}`,
  ]);

  const ended = await request(app)
    .delete(`/api/v1/comparison/people/${encodeURIComponent(`local:${b.id}`)}`)
    .set("x-test-user", a.id);
  expect(ended.body).toEqual({ success: true, data: { ended: true } });
});

it("validates path keys and bodies at the boundary", async () => {
  const a = await user();
  expect(
    (await request(app).delete("/api/v1/comparison/people/self").set("x-test-user", a.id)).status
  ).toBe(400);
  expect(
    (
      await request(app)
        .post("/api/v1/comparison/preview")
        .set("x-test-user", a.id)
        .send({ groups: [], domains: [], year: null })
    ).status
  ).toBe(400);
  const missing = await request(app)
    .post("/api/v1/comparison/requests")
    .set("x-test-user", a.id)
    .send({ username: "no-such-user-here", scope: SCOPE });
  expect(missing.status).toBe(404);
  expect(missing.body.code).toBe("COMPARISON_USER_NOT_FOUND");
});

it("refuses a claim with an invalid scope before any server is asked", async () => {
  const a = await user();
  const res = await request(app)
    .post("/api/v1/comparison/invites/claim")
    .set("x-test-user", a.id)
    .send({ code: `${PEER}#${"a".repeat(64)}`, scope: { groups: [], domains: [], year: null } });
  expect(res.status).toBe(400);
  expect(res.body.code).toBe("VALIDATION_FAILED");
  expect(exchange).not.toHaveBeenCalled();
});

it("answers 404, not 500, when a consent vanishes while its scope is being changed", async () => {
  const a = await user();
  const remote = await remoteFriend(a.id);
  const consentId = remote.consents[0].id;
  // The other server's lb-state lands between the read of the consent and the write.
  const findFirst = prisma.leaderboardConsent.findFirst.bind(prisma.leaderboardConsent);
  jest.spyOn(prisma.leaderboardConsent, "findFirst").mockImplementationOnce((async (
    args: Parameters<typeof findFirst>[0]
  ) => {
    const row = await findFirst(args);
    await prisma.leaderboardRemote.delete({ where: { id: remote.id } });
    return row;
  }) as never);
  const res = await request(app)
    .put(`/api/v1/comparison/consents/${consentId}`)
    .set("x-test-user", a.id)
    .send({ scope: SCOPE });
  expect(res.status).toBe(404);
  expect(res.body.code).toBe("COMPARISON_NOT_FOUND");
});

it("ends a remote friendship locally even when the other server does not answer", async () => {
  const a = await user();
  const remote = await remoteFriend(a.id);
  jest.mocked(exchange).mockRejectedValue(new Error("connect ECONNREFUSED"));
  const res = await request(app)
    .delete(`/api/v1/comparison/people/${encodeURIComponent(`remote:${remote.id}`)}`)
    .set("x-test-user", a.id);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ success: true, data: { ended: true } });
  expect(await prisma.leaderboardRemote.findUnique({ where: { id: remote.id } })).toBeNull();
});

it("throttles every route per user, including those without a write limit", async () => {
  const a = await user();
  const res = await request(app)
    .post(`/api/v1/comparison/consents/${randomUUID()}/decline`)
    .set("x-test-user", a.id);
  expect(res.status).toBe(404);
  expect(res.headers["ratelimit-limit"]).toBe("60");
  // The /api no-store default (index.ts) stays in charge: the router sets no cache header.
  expect(res.headers["cache-control"]).toBeUndefined();
});
