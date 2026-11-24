import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import jwt from "jsonwebtoken";
import { prisma } from "../../../db";
import { JWT_SECRET } from "../../../utils/jwtSecret";
import travplanRouter from "../../../routes/travplan";
import { errorHandler } from "../../../middleware/errorHandler";
import { makeUser } from "../../travtrack/__tests__/fixtures";
import { makePlanTrip } from "./planActualFixtures";

jest.mock("../availability", () => ({
  travPlanOffered: async () => true,
  assertTravPlanOffered: async () => undefined,
  travPlanUserEnabled: async () => true,
  assertTravPlanForUser: async () => undefined,
}));

/**
 * UAT rc.45: every trip page asked GET /trips/:id/plan and got a 404 for the
 * ordinary case of a trip without a plan. `?ifExists=1` answers 200 null.
 */
const app = express();
app.use(express.json());
app.use(cookieParser());
app.use("/api/v1", travplanRouter);
app.use(errorHandler);

const PREFIX = "plan-if-exists-";
let owner: string;
let stranger: string;
const cookie = (userId: string) => "auth_token=" + jwt.sign({ userId, epoch: 0 }, JWT_SECRET);
const get = (tripId: string, as: string, query = "?ifExists=1") =>
  request(app).get(`/api/v1/trips/${tripId}/plan${query}`).set("Cookie", cookie(as));

beforeAll(async () => {
  owner = await makeUser(`${PREFIX}owner`);
  stranger = await makeUser(`${PREFIX}stranger`);
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

describe("GET /trips/:tripId/plan?ifExists=1", () => {
  it("answers 200 null for a trip without a plan", async () => {
    const trip = await prisma.trip.create({ data: { userId: owner, name: "No plan" } });
    const res = await get(trip.id, owner);
    expect(res.status).toBe(200);
    expect(res.body).toBeNull();
    // The plain read still says 404 for clients that rely on it.
    expect((await get(trip.id, owner, "")).status).toBe(404);
  });

  it("answers the plan when there is one, and null to a stranger", async () => {
    const { tripId } = await makePlanTrip(owner);
    const mine = await get(tripId, owner);
    expect(mine.status).toBe(200);
    expect(mine.body.tripId).toBe(tripId);
    const theirs = await get(tripId, stranger);
    expect(theirs.status).toBe(200);
    expect(theirs.body).toBeNull();
  });
});
