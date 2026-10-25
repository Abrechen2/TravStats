import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import jwt from "jsonwebtoken";
import { prisma } from "../../../db";
import { JWT_SECRET } from "../../../utils/jwtSecret";
import travplanRouter from "../../../routes/travplan";
import { errorHandler } from "../../../middleware/errorHandler";
import { makeUser } from "../../travtrack/__tests__/fixtures";
import { hash } from "../store";
import {
  MUNICH,
  SALZBURG,
  VIENNA,
  driveBetween,
  driveNear,
  makePlanTrip,
  noon,
  ownRecording,
} from "./planActualFixtures";

// The instance beta switch is a global row other suites flip in parallel; what is under test
// is that this path asks it (travplanBetaGate.integration.test.ts covers the others).
const mockOffered = jest.fn<boolean, []>();
jest.mock("../availability", () => {
  const { AppError } = jest.requireActual("../../../middleware/errorHandler");
  return {
    travPlanOffered: async () => mockOffered(),
    assertTravPlanOffered: async () => {
      if (!mockOffered()) throw new AppError("off", 403, "PLAN_DISABLED");
    },
  };
});

/** `GET /trips/:tripId/plan/actual` (TravTrack plan L5). */

const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/v1", travplanRouter);
app.use(errorHandler);

const PREFIX = "plan-actual-route-api-";
let owner: string;
let stranger: string;
const cookie = (userId: string) => "auth_token=" + jwt.sign({ userId, epoch: 0 }, JWT_SECRET);
const getActual = (tripId: string, as = owner) =>
  request(app).get(`/api/v1/trips/${tripId}/plan/actual`).set("Cookie", cookie(as));

beforeAll(async () => {
  owner = await makeUser(`${PREFIX}owner`);
  stranger = await makeUser(`${PREFIX}stranger`);
});
beforeEach(() => mockOffered.mockReturnValue(true));
afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

describe("GET /trips/:tripId/plan/actual", () => {
  it("compares the seeded route with the recording", async () => {
    const { tripId, state } = await makePlanTrip(owner);
    await ownRecording(owner, tripId, [
      ...driveNear(MUNICH, noon(1)),
      // One continuous drive on the 4th; the stage is measured along it.
      ...driveBetween(MUNICH, SALZBURG, noon(4, -180)),
      ...driveNear(VIENNA, noon(5)),
    ]);
    const r = await getActual(tripId);
    expect(r.status).toBe(200);
    expect(r.body.plan).toEqual({ revision: 4 });
    expect(r.body.actual).toMatchObject({ origin: "travstats", coverage: "complete" });
    expect(r.body.actual.segments.length).toBeGreaterThan(0);
    const [m, s, v] = state.stations.map((st) =>
      r.body.stations.find((x: { stationId: string }) => x.stationId === st.id)
    );
    expect(m).toMatchObject({ status: "visited", deltaDays: 0 });
    expect(s).toMatchObject({ status: "visited", deltaDays: 1 });
    expect(v).toMatchObject({ status: "visited", deltaDays: 1 });
    expect(r.body.stages).toHaveLength(2);
    expect(r.body.stages[0]).toMatchObject({ plannedKm: 145 });
    expect(r.body.stages[0].actualKm).toBeGreaterThan(100);
    // Salzburg → Wien: the recording breaks between them (a night without fixes), so no figure.
    expect(r.body.stages[1].actualKm).toBeNull();
    // The comparison's server-side inputs never leave.
    expect(Object.keys(r.body.actual).sort()).toEqual(["coverage", "days", "origin", "segments"]);
    expect(JSON.stringify(r.body)).not.toMatch(/positions|circles|radiusM/);
  });

  it("the request leaves the plan's revision, state hash, mutations and proposals unchanged", async () => {
    const { tripId } = await makePlanTrip(owner);
    await ownRecording(owner, tripId, driveNear(MUNICH, noon(1)));
    const before = await prisma.travelPlan.findUniqueOrThrow({ where: { tripId } });
    expect((await getActual(tripId)).status).toBe(200);
    const after = await prisma.travelPlan.findUniqueOrThrow({ where: { tripId } });
    expect(after.revision).toBe(before.revision);
    expect(hash(after.state)).toBe(hash(before.state));
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(await prisma.travelPlanMutation.count({ where: { planId: before.id } })).toBe(0);
    expect(await prisma.travelPlanProposal.count({ where: { planId: before.id } })).toBe(0);
  });

  it("no track: actual is null and every station unknown", async () => {
    const { tripId } = await makePlanTrip(owner);
    const r = await getActual(tripId);
    expect(r.status).toBe(200);
    expect(r.body.actual).toBeNull();
    expect(r.body.stations.map((s: { status: string }) => s.status)).toEqual([
      "unknown",
      "unknown",
      "unknown",
    ]);
    expect(r.body.stages.map((s: { actualKm: number | null }) => s.actualKm)).toEqual([null, null]);
  });

  it("TravPlan off → 403 PLAN_DISABLED", async () => {
    const { tripId } = await makePlanTrip(owner);
    mockOffered.mockReturnValue(false);
    const r = await getActual(tripId);
    expect(r.status).toBe(403);
    expect(r.body.code).toBe("PLAN_DISABLED");
  });

  it("has its own per-account limit, answered as RATE_LIMITED", async () => {
    const busy = await makeUser(`${PREFIX}busy`);
    const { tripId } = await makePlanTrip(busy);
    const answers: number[] = [];
    for (let i = 0; i < 20; i++) answers.push((await getActual(tripId, busy)).status);
    expect(answers.every((s) => s === 200)).toBe(true);
    const refused = await getActual(tripId, busy);
    expect(refused.status).toBe(429);
    expect(refused.body.code).toBe("RATE_LIMITED");
    // Another account's bucket is its own.
    expect((await getActual((await makePlanTrip(owner)).tripId)).status).toBe(200);
  });

  it("another user's trip → 404", async () => {
    const { tripId } = await makePlanTrip(owner);
    await ownRecording(owner, tripId, driveNear(MUNICH, noon(1)));
    const r = await getActual(tripId, stranger);
    expect(r.status).toBe(404);
    expect(r.body.code).toBe("PLAN_NOT_FOUND");
  });
});
