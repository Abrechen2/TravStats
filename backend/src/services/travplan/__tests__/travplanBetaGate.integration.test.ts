import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma } from "../../../db";
import { JWT_SECRET } from "../../../utils/jwtSecret";
import travplanRouter from "../../../routes/travplan";
import { errorHandler } from "../../../middleware/errorHandler";

// The beta switch is a global row other suites flip in parallel, so it is mocked here rather
// than written; what is under test is that the router asks it on every plan path.
const mockBeta = jest.fn<boolean, []>();
jest.mock("../../instanceSettingsService", () => ({
  ...jest.requireActual("../../instanceSettingsService"),
  getInstanceSettings: async () => ({ betaFeaturesEnabled: mockBeta() }),
}));

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/v1", travplanRouter);
app.use(errorHandler);

let admin: string;
let tripId: string;
const cookie = () => "auth_token=" + jwt.sign({ userId: admin, epoch: 0 }, JWT_SECRET);
const get = (url: string) =>
  request(app)
    .get("/api/v1" + url)
    .set("Cookie", cookie());
const post = (url: string, body: object) =>
  request(app)
    .post("/api/v1" + url)
    .set("Cookie", cookie())
    .send(body);

beforeAll(async () => {
  admin = (
    await prisma.user.create({
      data: {
        username: "plan-gate-" + randomUUID(),
        passwordHash: "not-a-login-password",
        isAdmin: true,
      },
    })
  ).id;
  // The account's own switch (owner, 2026-10-27) — on, so the instance switch is what is tested.
  await prisma.userSettings.create({ data: { userId: admin, data: {}, travPlanEnabled: true } });
  await prisma.travelPlanConfig.upsert({
    where: { id: "default" },
    create: { enabled: true },
    update: { enabled: true },
  });
  mockBeta.mockReturnValue(true);
  const created = await post("/travplan/plans", {
    name: "Gate test",
    clientRef: randomUUID(),
    settings: {},
  });
  expect(created.status).toBe(201);
  tripId = created.body.tripId;
});
afterAll(async () => {
  await prisma.userSettings.deleteMany({ where: { userId: admin } });
  await prisma.trip.deleteMany({ where: { userId: admin } });
  await prisma.user.delete({ where: { id: admin } });
  await prisma.$disconnect();
});

const planPaths = () =>
  [
    ["GET", "/travplan/plans", undefined],
    ["GET", "/travplan/config", undefined],
    ["GET", "/travplan/locations?q=L", undefined],
    ["GET", "/trips/" + tripId + "/plan", undefined],
    ["GET", "/trips/" + tripId + "/plan/proposals", undefined],
    ["GET", "/trips/" + tripId + "/plan/packing-suggestions", undefined],
    ["POST", "/trips/" + tripId + "/plan/mutations", {}],
    // The v2 route-plan endpoints, merged without a screen.
    ["POST", "/trips/" + tripId + "/plan/placeholder-matches", {}],
    [
      "POST",
      "/trips/" + tripId + "/plan/stages/" + randomUUID() + "/route",
      { clientRef: randomUUID(), baseRevision: 1 },
    ],
  ] as const;

describe("TravPlan behind the instance beta switch", () => {
  describe("switch off", () => {
    beforeEach(() => mockBeta.mockReturnValue(false));

    it("still answers capabilities, saying planning is off", async () => {
      const r = await get("/travplan/capabilities");
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ version: 1, enabled: false });
    });

    it.each(planPaths().map(([m, p, b]) => [m + " " + p.replace(tripId, ":tripId"), m, p, b]))(
      "refuses %s with PLAN_DISABLED",
      async (_name, method, path, body) => {
        const r = method === "GET" ? await get(path) : await post(path, body ?? {});
        expect(r.status).toBe(403);
        expect(r.body.code).toBe("PLAN_DISABLED");
      }
    );

    it("refuses a planning import that names a trip", async () => {
      const r = await request(app)
        .post("/api/v1/parse-email")
        .set("Cookie", cookie())
        .set("X-TravPlan-Trip", tripId)
        .send({ text: "x" });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe("PLAN_DISABLED");
    });

    it("leaves paths that only start alike alone", async () => {
      // `/trips/:id/planned` is not a plan path; with no route here it falls through to 404.
      const r = await get("/trips/" + tripId + "/planned");
      expect(r.status).toBe(404);
    });
  });

  describe("switch on", () => {
    beforeEach(() => mockBeta.mockReturnValue(true));

    it("reports planning as enabled, for the instance and the account", async () => {
      const r = await get("/travplan/capabilities");
      expect(r.body).toMatchObject({ enabled: true, instanceEnabled: true, userEnabled: true });
    });

    it.each(planPaths().map(([m, p, b]) => [m + " " + p.replace(tripId, ":tripId"), m, p, b]))(
      "lets %s through to its handler",
      async (_name, method, path, body) => {
        const r = method === "GET" ? await get(path) : await post(path, body ?? {});
        expect(r.body?.code).not.toBe("PLAN_DISABLED");
      }
    );

    it("serves the plan itself", async () => {
      const r = await get("/trips/" + tripId + "/plan");
      expect(r.status).toBe(200);
      expect(r.body.tripId).toBe(tripId);
    });
  });
});

// Owner, 2026-10-27: TravPlan is switched on and off per account, like a domain.
describe("TravPlan behind the account's own switch", () => {
  const setUserSwitch = (travPlanEnabled: boolean) =>
    prisma.userSettings.update({ where: { userId: admin }, data: { travPlanEnabled } });
  beforeEach(() => mockBeta.mockReturnValue(true));
  afterAll(() => setUserSwitch(true));

  describe("switched off by the account", () => {
    beforeEach(() => setUserSwitch(false));

    it("answers capabilities with enabled false, and says which half is off", async () => {
      const r = await get("/travplan/capabilities");
      expect(r.status).toBe(200);
      expect(r.body).toMatchObject({ enabled: false, instanceEnabled: true, userEnabled: false });
    });

    it.each(
      planPaths()
        .filter(([, p]) => p !== "/travplan/config")
        .map(([m, p, b]) => [m + " " + p.replace(tripId, ":tripId"), m, p, b])
    )("refuses %s with PLAN_USER_DISABLED", async (_name, method, path, body) => {
      const r = method === "GET" ? await get(path) : await post(path, body ?? {});
      expect(r.status).toBe(403);
      expect(r.body.code).toBe("PLAN_USER_DISABLED");
    });

    it("refuses creating a plan", async () => {
      const r = await post("/travplan/plans", { name: "x", clientRef: randomUUID(), settings: {} });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe("PLAN_USER_DISABLED");
    });

    it("refuses a planning import that names a trip", async () => {
      const r = await request(app)
        .post("/api/v1/parse-email")
        .set("Cookie", cookie())
        .set("X-TravPlan-Trip", tripId)
        .send({ text: "x" });
      expect(r.status).toBe(403);
      expect(r.body.code).toBe("PLAN_USER_DISABLED");
    });

    it("leaves the admin's instance configuration reachable", async () => {
      const r = await get("/travplan/config");
      expect(r.status).toBe(200);
    });

    it("keeps the plan, which is served again once switched back on", async () => {
      expect(await prisma.travelPlan.count({ where: { tripId } })).toBe(1);
      await setUserSwitch(true);
      const r = await get("/trips/" + tripId + "/plan");
      expect(r.status).toBe(200);
      expect(r.body.tripId).toBe(tripId);
    });
  });

  it("counts an account without a settings row as switched off", async () => {
    await prisma.userSettings.delete({ where: { userId: admin } });
    try {
      const r = await get("/travplan/capabilities");
      expect(r.body).toMatchObject({ enabled: false, userEnabled: false });
      expect((await get("/travplan/plans")).body.code).toBe("PLAN_USER_DISABLED");
    } finally {
      await prisma.userSettings.create({
        data: { userId: admin, data: {}, travPlanEnabled: true },
      });
    }
  });
});
