import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { railCreationLimiter } from "../../middleware/rateLimit";
import { backfillInferredRailOperators } from "../../services/rail/inferredOperator";

const HANNOVER = { name: "Hannover Hbf", lat: 52.376, lon: 9.741, country: "DE" };
const MUNICH = { name: "München Hbf", lat: 48.1403, lon: 11.5583, country: "DE" };

describe("inferred rail operator (operator-logos)", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "railinferop" } });
    const user = await prisma.user.create({
      data: { username: "railinferop", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });

  afterAll(async () => {
    await railCreationLimiter.resetKey(`user:${userId}`);
    await prisma.user.deleteMany({ where: { username: "railinferop" } });
  });

  const post = (body: Record<string, unknown>) =>
    request(app)
      .post("/api/v1/rail")
      .set("Cookie", cookie)
      .send({
        departureStation: HANNOVER,
        arrivalStation: MUNICH,
        departureLocal: "2024-04-02T08:15",
        arrivalLocal: "2024-04-02T11:40",
        ...body,
      });

  it("fills an empty operator on create and marks it inferred", async () => {
    const res = await post({ trainCategory: "ICE", trainNumber: "633" });
    expect(res.status).toBe(201);
    expect(res.body.data.operator).toBe("DB Fernverkehr");
    expect(res.body.data.operatorSource).toBe("inferred");
  });

  it("never overwrites a typed operator, and leaves an ambiguous train blank", async () => {
    const typed = await post({ trainCategory: "ICE", trainNumber: "1", operator: "ÖBB" });
    expect(typed.body.data.operator).toBe("ÖBB");
    expect(typed.body.data.operatorSource).toBeNull();
    const regional = await post({ trainCategory: "RE", trainNumber: "5" });
    expect(regional.body.data.operator).toBeNull();
    expect(regional.body.data.operatorSource).toBeNull();
  });

  it("a typed operator on edit replaces the inferred one and clears the mark", async () => {
    const created = await post({ trainCategory: "IC", trainNumber: "2017" });
    expect(created.body.data.operatorSource).toBe("inferred");
    const edited = await request(app)
      .patch(`/api/v1/rail/${created.body.data.id}`)
      .set("Cookie", cookie)
      .send({ operator: "FlixTrain" });
    expect(edited.status).toBe(200);
    expect(edited.body.data.operator).toBe("FlixTrain");
    expect(edited.body.data.operatorSource).toBeNull();
  });

  it("the backfill names blank journeys and spares a typed operator", async () => {
    const base = {
      userId,
      depStationName: "Rosenheim",
      depLat: 47.85,
      depLon: 12.12,
      depCountry: "DE",
      arrStationName: "München Hbf",
      arrLat: 48.14,
      arrLon: 11.56,
      arrCountry: "DE",
      departureTime: new Date("2024-05-01T08:00:00Z"),
    };
    const blank = await prisma.railJourney.create({
      data: { ...base, trainCategory: "M", trainNumber: "79047" },
    });
    const typed = await prisma.railJourney.create({
      data: { ...base, trainCategory: "M", trainNumber: "79049", operator: "My own text" },
    });
    const noCategory = await prisma.railJourney.create({ data: base });
    const report = await backfillInferredRailOperators({ userId });
    expect(report.inferred).toBeGreaterThanOrEqual(1);
    const after = await prisma.railJourney.findMany({
      where: { id: { in: [blank.id, typed.id, noCategory.id] } },
    });
    const byId = new Map(after.map((j) => [j.id, j]));
    expect(byId.get(blank.id)).toMatchObject({ operator: "Meridian", operatorSource: "inferred" });
    expect(byId.get(typed.id)).toMatchObject({ operator: "My own text", operatorSource: null });
    expect(byId.get(noCategory.id)).toMatchObject({ operator: null, operatorSource: null });
    // Idempotent: a second run finds nothing new to name.
    expect((await backfillInferredRailOperators({ userId })).inferred).toBe(0);
  });
});
