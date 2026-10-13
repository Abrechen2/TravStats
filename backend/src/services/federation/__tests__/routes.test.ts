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
