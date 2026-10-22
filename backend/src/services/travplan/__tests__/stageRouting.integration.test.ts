import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import jwt from "jsonwebtoken";
import { randomUUID } from "node:crypto";
import { prisma } from "../../../db";
import { JWT_SECRET } from "../../../utils/jwtSecret";
import travplanRouter from "../../../routes/travplan";
import { errorHandler } from "../../../middleware/errorHandler";

// The instance beta switch is a global row other suites flip; the gate itself is tested in
// travplanBetaGate.integration.test.ts.
jest.mock("../availability", () => ({
  travPlanOffered: async () => true,
  assertTravPlanOffered: async () => undefined,
}));
import type { RouteProvider, RouteResult } from "../../tour/routing/types";

const mockResolve = jest.fn<Promise<RouteProvider | null>, [string?]>();
const mockGate = jest.fn<boolean, []>();
jest.mock("../../tour/routing/resolveProvider", () => ({
  resolveRouteProvider: (userId?: string) => mockResolve(userId),
}));
jest.mock("../../tour/routing/providerBudget", () => ({
  providerCallGate: () => () => mockGate(),
}));

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/v1", travplanRouter);
app.use(errorHandler);

const A = { lat: 48.0, lon: 11.0 };
const B = { lat: 48.5, lon: 11.5 };
let owner: string;
const cookie = () => "auth_token=" + jwt.sign({ userId: owner, epoch: 0 }, JWT_SECRET);
const post = (url: string, body: object) =>
  request(app)
    .post("/api/v1" + url)
    .set("Cookie", cookie())
    .send(body);

const providerAnswering = (result: RouteResult | null): RouteProvider =>
  ({ id: "stub", route: async () => result }) as unknown as RouteProvider;
const road = (): RouteResult => ({
  waypoints: [
    [A.lon, A.lat],
    [B.lon, B.lat],
  ],
  distanceKm: 71.26,
  drivingMinutes: 62.4,
});

beforeAll(async () => {
  owner = (
    await prisma.user.create({
      data: { username: "plan-route-" + randomUUID(), passwordHash: "not-a-login-password" },
    })
  ).id;
  await prisma.travelPlanConfig.upsert({
    where: { id: "default" },
    create: { enabled: true },
    update: { enabled: true },
  });
});
beforeEach(() => {
  mockResolve.mockReset();
  mockGate.mockReset().mockReturnValue(true);
});
afterAll(async () => {
  await prisma.$disconnect();
});

const place = (name: string, c: { lat: number; lon: number }) => ({
  name,
  ...c,
  country: null,
  zone: null,
  ref: null,
});

async function routePlan(stageExtra: Record<string, unknown> = {}) {
  const created = (
    await post("/travplan/plans", { name: "Route test", clientRef: randomUUID(), settings: {} })
  ).body;
  let revision: number = created.revision;
  const send = async (operation: object) => {
    const r = await post("/trips/" + created.tripId + "/plan/mutations", {
      clientRef: randomUUID(),
      baseRevision: revision,
      operation,
    });
    expect(r.status).toBe(200);
    revision = r.body.revision;
  };
  const from = randomUUID(),
    to = randomUUID(),
    stageId = randomUUID();
  await send({ type: "route_settings", shape: "route" });
  for (const [id, name, c] of [
    [from, "A", A],
    [to, "B", B],
  ] as const)
    await send({
      type: "upsert",
      collection: "stations",
      value: {
        id,
        title: name,
        place: place(name, c),
        nights: 0,
        pinnedDay: null,
        night: { kind: "spontaneous" },
        note: "",
      },
    });
  await send({
    type: "upsert",
    collection: "stages",
    value: {
      id: stageId,
      fromStationId: from,
      toStationId: to,
      mode: "drive",
      departDay: null,
      departTime: null,
      durationMinutes: 90,
      distanceKm: 80,
      metricsSource: "user",
      fallbackReason: null,
      bookingId: null,
      overnight: false,
      note: "",
      ...stageExtra,
    },
  });
  const route = () =>
    post("/trips/" + created.tripId + "/plan/stages/" + stageId + "/route", {
      clientRef: randomUUID(),
      baseRevision: revision,
    });
  const stage = (body: { state: { stages: Record<string, unknown>[] } }) => body.state.stages[0];
  return { created, route, stage, stageId, revision: () => revision };
}

describe("stage routing", () => {
  it("a routed drive stores km and minutes", async () => {
    mockResolve.mockResolvedValue(providerAnswering(road()));
    const p = await routePlan();
    const r = await p.route();
    expect(r.status).toBe(200);
    expect(p.stage(r.body)).toMatchObject({
      distanceKm: 71.3,
      durationMinutes: 62,
      metricsSource: "routed",
      fallbackReason: null,
    });
  });

  it("no provider keeps stored metrics and records no_provider", async () => {
    mockResolve.mockResolvedValue(null);
    const p = await routePlan();
    const r = await p.route();
    expect(r.status).toBe(200);
    expect(p.stage(r.body)).toMatchObject({
      distanceKm: 80,
      durationMinutes: 90,
      metricsSource: "user",
      fallbackReason: "no_provider",
    });
  });

  it("rate limited keeps stored metrics", async () => {
    mockResolve.mockResolvedValue(providerAnswering(road()));
    mockGate.mockReturnValue(false);
    const p = await routePlan();
    const r = await p.route();
    expect(p.stage(r.body)).toMatchObject({
      distanceKm: 80,
      durationMinutes: 90,
      fallbackReason: "rate_limited",
    });
  });

  it("a failed router fills a stage without a distance with the straight chord", async () => {
    mockResolve.mockResolvedValue(providerAnswering(null));
    const p = await routePlan({ distanceKm: null, durationMinutes: null, metricsSource: null });
    const stage = p.stage((await p.route()).body);
    expect(stage.metricsSource).toBe("straight");
    expect(stage.durationMinutes).toBeNull();
    expect(stage.fallbackReason).toBe("provider_error");
    expect(stage.distanceKm).toBeGreaterThan(50);
  });

  it("a ferry gets the great-circle distance and is not routed", async () => {
    const p = await routePlan({ mode: "ferry", metricsSource: null });
    const stage = p.stage((await p.route()).body);
    expect(mockResolve).not.toHaveBeenCalled();
    expect(stage).toMatchObject({ metricsSource: "straight", durationMinutes: 90 });
    expect(stage.distanceKm).toBeCloseTo(66, -1);
  });

  it("rail is not routed and keeps its metrics", async () => {
    const p = await routePlan({ mode: "rail" });
    const stage = p.stage((await p.route()).body);
    expect(mockResolve).not.toHaveBeenCalled();
    expect(stage).toMatchObject({
      distanceKm: 80,
      durationMinutes: 90,
      fallbackReason: "unroutable_mode",
    });
  });

  it("stage moved meanwhile is refused with PLAN_STAGE_CHANGED", async () => {
    const p = await routePlan();
    const r = await post("/trips/" + p.created.tripId + "/plan/mutations", {
      clientRef: randomUUID(),
      baseRevision: p.revision(),
      operation: {
        type: "stage_metrics",
        stageId: p.stageId,
        mode: "drive",
        distanceKm: 10,
        durationMinutes: 10,
        metricsSource: "routed",
        fallbackReason: null,
        fromCoord: { lat: 1, lon: 1 },
        toCoord: B,
      },
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("PLAN_STAGE_CHANGED");
  });

  it("a stage that changed mode meanwhile is refused with PLAN_STAGE_CHANGED", async () => {
    const p = await routePlan();
    const r = await post("/trips/" + p.created.tripId + "/plan/mutations", {
      clientRef: randomUUID(),
      baseRevision: p.revision(),
      operation: {
        type: "stage_metrics",
        stageId: p.stageId,
        mode: "ferry",
        distanceKm: 10,
        durationMinutes: 10,
        metricsSource: "straight",
        fallbackReason: null,
        fromCoord: A,
        toCoord: B,
      },
    });
    expect(r.status).toBe(409);
    expect(r.body.code).toBe("PLAN_STAGE_CHANGED");
  });

  it("a routed answer without a drive time keeps the stored duration", async () => {
    mockResolve.mockResolvedValue(providerAnswering({ ...road(), drivingMinutes: null }));
    const p = await routePlan();
    expect(p.stage((await p.route()).body)).toMatchObject({
      distanceKm: 71.3,
      durationMinutes: 90,
      metricsSource: "routed",
    });
  });

  it("a ferry keeps a distance the user typed", async () => {
    const p = await routePlan({ mode: "ferry" });
    expect(p.stage((await p.route()).body)).toMatchObject({
      distanceKm: 80,
      metricsSource: "user",
    });
  });

  it("a retry with the same clientRef replays the first result without routing again", async () => {
    mockResolve.mockResolvedValue(providerAnswering(road()));
    const p = await routePlan();
    const clientRef = randomUUID();
    const url = "/trips/" + p.created.tripId + "/plan/stages/" + p.stageId + "/route";
    const first = await post(url, { clientRef, baseRevision: p.revision() });
    expect(first.status).toBe(200);
    mockResolve.mockClear();
    mockResolve.mockResolvedValue(null);
    const second = await post(url, { clientRef, baseRevision: p.revision() });
    expect(second.status).toBe(200);
    expect(second.body).toEqual(first.body);
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it("answers an unknown stage with 404", async () => {
    const p = await routePlan();
    const r = await post("/trips/" + p.created.tripId + "/plan/stages/" + randomUUID() + "/route", {
      clientRef: randomUUID(),
      baseRevision: p.revision(),
    });
    expect(r.status).toBe(404);
  });
});
