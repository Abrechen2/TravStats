import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { yearCountsSchema } from "../../schemas/statsYears";

/**
 * The year picker of the lodging and places lists reads its captions from
 * `/stats/years/counts`, which knew only the distance domains: both lists showed plain years.
 * Stays count by `lodgingCounting` (once the check-out is past, filed by check-in), visits by
 * `placeCounting` (once they happened); neither moves `total`, the cards' figure.
 */
describe("GET /stats/years/counts — stays and place visits", () => {
  const stamp = Date.now();
  const ids: string[] = [];
  let userId: string;
  let offId: string;
  const cookieOf = (id: string): string => `auth_token=${generateToken(id)}`;
  const counts = (id: string) =>
    request(app).get("/api/v1/stats/years/counts").set("Cookie", cookieOf(id));

  const make = async (name: string, enabledDomains: string[]): Promise<string> => {
    const u = await prisma.user.create({
      data: { username: `${name}-${stamp}`, passwordHash: await hashPassword("pw123456") },
    });
    ids.push(u.id);
    await prisma.userSettings.create({ data: { userId: u.id, enabledDomains, data: {} } });
    return u.id;
  };

  const seed = async (id: string) => {
    const lodging = await prisma.lodging.create({
      data: { userId: id, name: "Hotel", type: "hotel" },
    });
    const stay = (checkIn: string, checkOut: string, status = "completed") =>
      prisma.lodgingStay.create({
        data: {
          userId: id,
          lodgingId: lodging.id,
          status,
          checkIn: new Date(checkIn),
          checkOut: new Date(checkOut),
        },
      });
    // Over New Year: filed by its check-in, 2023.
    await stay("2023-12-30T00:00:00Z", "2024-01-02T00:00:00Z");
    await stay("2024-05-01T00:00:00Z", "2024-05-03T00:00:00Z");
    await stay("2024-07-01T00:00:00Z", "2024-07-03T00:00:00Z", "cancelled");
    await stay("2099-01-01T00:00:00Z", "2099-01-03T00:00:00Z", "scheduled");
    const place = await prisma.place.create({
      data: { userId: id, name: "Museum", lat: 48.1, lon: 11.6 },
    });
    const visit = (visitedAt: Date | null) =>
      prisma.placeVisit.create({ data: { userId: id, placeId: place.id, visitedAt } });
    await visit(new Date("2022-06-01T10:00:00Z"));
    await visit(new Date("2099-06-01T10:00:00Z")); // planned: no year yet
    await visit(null); // undated: happened, but claims no year
  };

  beforeAll(async () => {
    userId = await make("yc-lodging", ["lodging", "poi"]);
    offId = await make("yc-off", ["flight"]);
    await seed(userId);
    await seed(offId);
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
  });

  it("counts stays that are over by check-in year and visits that happened, outside total", async () => {
    const res = await counts(userId);
    expect(res.status).toBe(200);
    expect(yearCountsSchema.safeParse(res.body).success).toBe(true);
    expect(res.body.years).toEqual([
      { year: 2024, total: 0, byDomain: { lodging: 1 } },
      { year: 2023, total: 0, byDomain: { lodging: 1 } },
      { year: 2022, total: 0, byDomain: { poi: 1 } },
    ]);
  });

  it("leaves both out for an account that switched the domains off", async () => {
    expect((await counts(offId)).body).toEqual({ years: [] });
  });
});
