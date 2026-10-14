import express from "express";
import request from "supertest";
import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { getInstanceSettings } from "../../instanceSettingsService";
import { errorHandler } from "../../../middleware/errorHandler";
import comparison from "../../../routes/comparison";

jest.mock("../../../middleware/auth", () => ({
  ...jest.requireActual("../../../middleware/auth"),
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
jest.mock("../../instanceSettingsService", () => ({ getInstanceSettings: jest.fn() }));
const app = express();
app.use(express.json());
app.use("/api/v1/comparison", comparison);
app.use(errorHandler);
let userId: string;
beforeAll(async () => {
  const user = await prisma.user.create({
    data: { username: `comparison-route-${randomUUID()}`, passwordHash: "test-only" },
  });
  userId = user.id;
});
beforeEach(() => {
  jest.mocked(getInstanceSettings).mockResolvedValue({ betaFeaturesEnabled: true } as never);
});
afterAll(async () => {
  await prisma.user.delete({ where: { id: userId } });
  await prisma.$disconnect();
});
it("rejects PATs even when the browser feature is enabled", async () => {
  const response = await request(app)
    .get("/api/v1/comparison/links")
    .set("x-test-user", userId)
    .set("x-test-pat", "yes");
  expect(response.status).toBe(403);
});
it("fails closed while the instance beta switch is disabled", async () => {
  jest.mocked(getInstanceSettings).mockResolvedValue({ betaFeaturesEnabled: false } as never);
  expect(
    (await request(app).get("/api/v1/comparison/links").set("x-test-user", userId)).status
  ).toBe(403);
});
it("does not allow an ordinary account to admit peers", async () => {
  expect(
    (await request(app).get("/api/v1/comparison/peers").set("x-test-user", userId)).status
  ).toBe(403);
});
it("returns only this user's links and refuses oversized or unknown grant fields", async () => {
  const res = await request(app).get("/api/v1/comparison/links").set("x-test-user", userId);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ success: true, data: [] });
  const bad = await request(app)
    .post(`/api/v1/comparison/links/${randomUUID()}/grant`)
    .set("x-test-user", userId)
    .send({ audience: "", scope: { all: true } });
  expect(bad.status).toBe(400);
});

it("has no plaintext comparison fallback and applies the same cookie gate to encrypted routes", async () => {
  expect(
    (
      await request(app)
        .post(`/api/v1/comparison/links/${randomUUID()}/read`)
        .set("x-test-user", userId)
        .send({ year: null })
    ).status
  ).toBe(403);
  expect(
    (await request(app).post("/api/v1/comparison/circles/read").set("x-test-user", userId).send({}))
      .status
  ).toBe(403);
  expect(
    (
      await request(app)
        .get("/api/v1/comparison/sealed/devices")
        .set("x-test-user", userId)
        .set("x-test-pat", "yes")
    ).status
  ).toBe(403);
});

it("lists only the owner's publication metadata without ciphertext or sender keys", async () => {
  const other = await prisma.user.create({
    data: { username: `comparison-other-${randomUUID()}`, passwordHash: "test-only" },
  });
  const make = (owner: string) =>
    prisma.comparisonPublication.create({
      data: {
        id: randomUUID(),
        userId: owner,
        linkId: randomUUID(),
        audience: "",
        revision: 1,
        sender: "must-not-be-in-status",
        context: { private: "not-in-status" },
        expiresAt: new Date(Date.now() + 60000),
      },
    });
  const own = await make(userId);
  try {
    const foreign = await make(other.id);
    const response = await request(app)
      .get("/api/v1/comparison/sealed/publications")
      .set("x-test-user", userId);
    expect(response.status).toBe(200);
    expect(response.body.data.map((p: { id: string }) => p.id)).toEqual([own.id]);
    expect(JSON.stringify(response.body)).not.toMatch(
      new RegExp(`${foreign.id}|must-not-be-in-status|not-in-status`)
    );
    expect(response.body.data[0]).not.toHaveProperty("manifest");
    expect(
      (
        await request(app)
          .get("/api/v1/comparison/sealed/publications")
          .set("x-test-user", userId)
          .set("x-test-pat", "yes")
      ).status
    ).toBe(403);
  } finally {
    await prisma.comparisonPublication.delete({ where: { id: own.id } });
    await prisma.user.delete({ where: { id: other.id } });
  }
});
