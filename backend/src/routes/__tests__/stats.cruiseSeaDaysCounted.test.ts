import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * "Seetage zählen" end to end (forgejo#321): the cruise tab's day total and
 * its evidence panel answer with the account's choice, and the tab learns
 * which rule the number follows (`seaDaysCounted`).
 */
describe("GET /stats/cruise — sea days counted or not", () => {
  const username = `sea-days-${Date.now()}`;
  let cookie: string;
  let userId: string;

  const day = (iso: string): Date => new Date(`${iso}T00:00:00Z`);
  const tab = async () => {
    const res = await request(app).get("/api/v1/stats/cruise").set("Cookie", cookie);
    expect(res.status).toBe(200);
    return res.body as { totalCruiseDays: number; seaDays: number; seaDaysCounted: boolean };
  };
  const evidenceValue = async (): Promise<number | null> => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/cruiseTotalDays")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    return res.body.measure.value as number | null;
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
    const user = await prisma.user.create({
      data: { username, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    const created = await prisma.cruise.create({
      data: {
        userId,
        status: "flown",
        routeName: "Nordland",
        startDate: day("2024-05-01"),
        endDate: day("2024-05-08"),
      },
    });
    await prisma.cruiseStop.createMany({
      data: [2, 3, 4].map((dayNumber) => ({ cruiseId: created.id, dayNumber, isAtSea: true })),
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  });

  it("counts the sea days in the total by default", async () => {
    expect(await tab()).toMatchObject({ totalCruiseDays: 8, seaDays: 3, seaDaysCounted: true });
    expect(await evidenceValue()).toBe(8);
  });

  it("leaves them out of the total, and the evidence, when the account says so", async () => {
    await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ cruiseSeaDays: { counted: false } })
      .expect(200);
    expect(await tab()).toMatchObject({ totalCruiseDays: 5, seaDays: 3, seaDaysCounted: false });
    expect(await evidenceValue()).toBe(5);
  });
});
