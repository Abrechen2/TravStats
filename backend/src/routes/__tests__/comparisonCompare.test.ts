import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { prisma } from "../../db";
import { errorHandler } from "../../middleware/errorHandler";
import { getInstanceSettings } from "../../services/instanceSettingsService";
import { loadVisibleDomains } from "../../services/domainVisibility";
import comparison from "../comparison";

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
jest.mock("../../services/instanceSettingsService", () => ({ getInstanceSettings: jest.fn() }));
jest.mock("../../services/domainVisibility", () => ({
  ...jest.requireActual("../../services/domainVisibility"),
  loadVisibleDomains: jest.fn(),
}));

const app = express();
app.use(express.json());
app.use("/api/v1/comparison", comparison);
app.use(errorHandler);

const SCOPE = { groups: ["trips"], domains: ["ferry"], year: null };
const users: Array<{ id: string }> = [];
async function user() {
  const u = await prisma.user.create({
    data: { username: `lb-cmp-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
  });
  users.push(u);
  return u;
}
/** Both directions accepted: the mutual rule lets figures flow either way. */
async function befriend(a: string, b: string) {
  for (const [owner, viewer] of [
    [a, b],
    [b, a],
  ]) {
    await prisma.leaderboardConsent.create({
      data: {
        ownerId: owner,
        viewerId: viewer,
        status: "accepted",
        scope: SCOPE as never,
        decidedAt: new Date(),
      },
    });
  }
}

beforeEach(() => {
  jest.mocked(getInstanceSettings).mockResolvedValue({ betaFeaturesEnabled: true } as never);
  jest.mocked(loadVisibleDomains).mockResolvedValue(["ferry"]);
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  await prisma.$disconnect();
});

const get = (as: string, qs: string) =>
  request(app).get(`/api/v1/comparison/compare?${qs}`).set("x-test-user", as);

it("returns self plus the requested friends only", async () => {
  const [me, f1, f2] = [await user(), await user(), await user()];
  await befriend(me.id, f1.id);
  await befriend(me.id, f2.id);
  const res = await get(me.id, `friends=local:${f2.id}&year=all`);
  expect(res.status).toBe(200);
  expect(res.body.success).toBe(true);
  expect(res.body.data.self.person.key).toBe("self");
  expect(res.body.data.friends.map((r: { person: { key: string } }) => r.person.key)).toEqual([
    `local:${f2.id}`,
  ]);
});

it("keeps the requested order and omits a friend who no longer shares back", async () => {
  const [me, f1, f2] = [await user(), await user(), await user()];
  await befriend(me.id, f1.id);
  await befriend(me.id, f2.id);
  await prisma.leaderboardConsent.updateMany({
    where: { ownerId: me.id, viewerId: f1.id },
    data: { status: "withdrawn" },
  });
  const res = await get(me.id, `friends=local:${f1.id},local:${f2.id}`);
  expect(res.body.data.friends.map((r: { person: { key: string } }) => r.person.key)).toEqual([
    `local:${f2.id}`,
  ]);
});

it("refuses more than three", async () => {
  const me = await user();
  const keys = Array.from({ length: 4 }, () => `local:${randomUUID()}`).join(",");
  const res = await get(me.id, `friends=${keys}`);
  expect(res.status).toBe(400);
});

it("refuses a malformed or repeated key", async () => {
  const me = await user();
  expect((await get(me.id, "friends=nonsense")).status).toBe(400);
  const k = `local:${randomUUID()}`;
  expect((await get(me.id, `friends=${k},${k}`)).status).toBe(400);
});
