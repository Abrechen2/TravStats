import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma } from "../../../db";
import { JWT_SECRET } from "../../../utils/jwtSecret";
import travplanRouter from "../../../routes/travplan";
import { errorHandler } from "../../../middleware/errorHandler";

jest.mock("../../instanceSettingsService", () => ({
  ...jest.requireActual("../../instanceSettingsService"),
  getInstanceSettings: async () => ({ betaFeaturesEnabled: true }),
}));
const seenPolicies: string[] = [];
jest.mock("../../llm/requestPolicy", () => ({
  ...jest.requireActual("../../llm/requestPolicy"),
  withLlmRequestPolicy: (policy: string, run: () => unknown) => {
    seenPolicies.push(policy);
    return run();
  },
}));

/**
 * Settings v3 `planai` / `planwx`: the account's own switches for AI proposals and
 * forecasts in plans. Default on; off refuses with its own code, and the
 * capabilities answer says so, so a client stops asking.
 */
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/v1", travplanRouter);
app.use(errorHandler);

let user: string;
let tripId: string;
const cookie = () => "auth_token=" + jwt.sign({ userId: user, epoch: 0 }, JWT_SECRET);
const post = (url: string, body: object, headers: Record<string, string> = {}) =>
  request(app)
    .post("/api/v1" + url)
    .set("Cookie", cookie())
    .set(headers)
    .send(body);
const setSwitches = (data: { travPlanAiEnabled?: boolean; travPlanWeatherEnabled?: boolean }) =>
  prisma.userSettings.update({ where: { userId: user }, data });

beforeAll(async () => {
  user = (
    await prisma.user.create({
      data: { username: "plan-switch-" + randomUUID(), passwordHash: "not-a-login-password" },
    })
  ).id;
  await prisma.userSettings.create({ data: { userId: user, data: {}, travPlanEnabled: true } });
  await prisma.travelPlanConfig.upsert({
    where: { id: "default" },
    create: { enabled: true },
    update: { enabled: true },
  });
  const created = await post("/travplan/plans", {
    name: "Switch test",
    clientRef: randomUUID(),
    settings: {},
  });
  expect(created.status).toBe(201);
  tripId = created.body.tripId;
});
afterEach(() => {
  seenPolicies.length = 0;
});
afterAll(async () => {
  await prisma.userSettings.deleteMany({ where: { userId: user } });
  await prisma.trip.deleteMany({ where: { userId: user } });
  await prisma.user.delete({ where: { id: user } });
  await prisma.$disconnect();
});

const proposal = () => post(`/trips/${tripId}/plan/proposals`, { request: "A quiet day" });
const forecast = () =>
  post(`/trips/${tripId}/plan/forecast`, { clientRef: randomUUID(), baseRevision: 1 });
const capabilities = () =>
  request(app).get("/api/v1/travplan/capabilities").set("Cookie", cookie());

describe("TravPlan AI and weather switches of the account", () => {
  it("are on by default: capabilities offer both and neither action is refused for them", async () => {
    await setSwitches({ travPlanAiEnabled: true, travPlanWeatherEnabled: true });
    expect((await capabilities()).body).toMatchObject({ ai: true, forecast: true });
    expect((await proposal()).body.code).not.toBe("PLAN_AI_USER_DISABLED");
    expect((await forecast()).body.code).not.toBe("PLAN_WEATHER_USER_DISABLED");
  });

  it("planai off: a new AI proposal is refused with PLAN_AI_USER_DISABLED and capabilities say ai:false", async () => {
    await setSwitches({ travPlanAiEnabled: false, travPlanWeatherEnabled: true });
    const res = await proposal();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PLAN_AI_USER_DISABLED");
    expect((await capabilities()).body).toMatchObject({ ai: false, forecast: true });
  });

  it("planwx off: a forecast refresh is refused with PLAN_WEATHER_USER_DISABLED and capabilities say forecast:false", async () => {
    await setSwitches({ travPlanAiEnabled: true, travPlanWeatherEnabled: false });
    const res = await forecast();
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("PLAN_WEATHER_USER_DISABLED");
    expect((await capabilities()).body).toMatchObject({ ai: true, forecast: false });
  });

  it("planai off: a plan import that asks for AI reads without it", async () => {
    await setSwitches({ travPlanAiEnabled: true });
    await post(
      "/parse-email",
      { text: "x" },
      { "X-TravPlan-Trip": tripId, "X-TravPlan-AI": "true" }
    );
    expect(seenPolicies).toEqual(["local_only"]);

    seenPolicies.length = 0;
    await setSwitches({ travPlanAiEnabled: false });
    await post(
      "/parse-email",
      { text: "x" },
      { "X-TravPlan-Trip": tripId, "X-TravPlan-AI": "true" }
    );
    expect(seenPolicies).toEqual(["disabled"]);
  });

  it("internet off: the forecast and the weather-location search are refused with PLAN_WEATHER_DISABLED, before any call", async () => {
    await setSwitches({ travPlanAiEnabled: true, travPlanWeatherEnabled: true });
    const row = await prisma.adminSettings.findFirstOrThrow({ orderBy: { id: "asc" } });
    await prisma.adminSettings.update({ where: { id: row.id }, data: { internetEnabled: false } });
    try {
      const fc = await forecast();
      expect([fc.status, fc.body.code]).toEqual([409, "PLAN_WEATHER_DISABLED"]);
      const search = await request(app)
        .get("/api/v1/travplan/locations?q=Lisbon")
        .set("Cookie", cookie());
      expect([search.status, search.body.code]).toEqual([409, "PLAN_WEATHER_DISABLED"]);
    } finally {
      await prisma.adminSettings.update({ where: { id: row.id }, data: { internetEnabled: true } });
    }
  });
});
