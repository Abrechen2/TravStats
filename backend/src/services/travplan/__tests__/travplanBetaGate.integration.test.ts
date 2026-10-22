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

    it("reports planning as enabled", async () => {
      const r = await get("/travplan/capabilities");
      expect(r.body.enabled).toBe(true);
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
