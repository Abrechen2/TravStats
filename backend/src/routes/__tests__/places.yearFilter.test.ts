import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `GET /places?year=` keeps the places with a visit that HAPPENED in that year, on the place's own
 * calendar. The list page cut by year in the browser before, so the picker had nothing to ask.
 */
const USER = "placesyearfilter";

describe("GET /places?year=", () => {
  let cookie: string;
  const ids: Record<string, string> = {};

  const cleanup = async (): Promise<void> => {
    await prisma.placeVisit.deleteMany({ where: { user: { username: USER } } });
    await prisma.place.deleteMany({ where: { user: { username: USER } } });
    await prisma.user.deleteMany({ where: { username: USER } });
  };

  const place = async (
    name: string,
    visits: Array<{ at: string; zone?: string; future?: boolean }>
  ): Promise<void> => {
    const row = await prisma.place.create({
      data: { userId: userId(), name, category: "landmark", lat: 1, lon: 1, visited: true },
    });
    ids[name] = row.id;
    for (const v of visits) {
      await prisma.placeVisit.create({
        data: {
          placeId: row.id,
          userId: userId(),
          visitedAt: new Date(v.at),
          visitedAtUtc: new Date(v.at),
          visitedZone: v.zone ?? "UTC",
        },
      });
    }
  };
  let uid = "";
  const userId = (): string => uid;

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    uid = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    await place("Visited 2023", [{ at: "2023-06-01T10:00:00.000Z" }]);
    await place("Visited both", [
      { at: "2023-06-01T10:00:00.000Z" },
      { at: "2024-06-01T10:00:00.000Z" },
    ]);
    // 23:30 UTC on New Year's Eve is already 2024 in Rome — the place's calendar decides.
    await place("Rome new year", [{ at: "2023-12-31T23:30:00.000Z", zone: "Europe/Rome" }]);
    await place("Only planned", [{ at: "2199-01-01T10:00:00.000Z" }]);
    await place("No visits", []);
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  const names = async (query: string): Promise<{ names: string[]; total: number }> => {
    const res = await request(app).get(`/api/v1/places?${query}`).set("Cookie", cookie);
    expect(res.status).toBe(200);
    return {
      names: res.body.data.map((p: { name: string }) => p.name).sort(),
      total: res.body.meta.total,
    };
  };

  it("lists only places visited in that year, filed on the place's calendar", async () => {
    expect(await names("year=2023")).toEqual({ names: ["Visited 2023", "Visited both"], total: 2 });
    expect(await names("year=2024")).toEqual({ names: ["Rome new year", "Visited both"], total: 2 });
  });

  it("a future visit and a place without visits belong to no year", async () => {
    expect((await names("year=2199")).names).toEqual([]);
    expect((await names("year=2023")).names).not.toContain("No visits");
  });

  it("paginates after the year cut, with the total of the cut", async () => {
    const res = await request(app)
      .get("/api/v1/places?year=2023&limit=1&offset=1&sortBy=name")
      .set("Cookie", cookie);
    expect(res.body.meta).toMatchObject({ total: 2, limit: 1, offset: 1 });
    expect(res.body.data).toHaveLength(1);
  });

  it("without year nothing is cut", async () => {
    expect((await names("")).total).toBe(5);
  });

  it("rejects a year that is not a number", async () => {
    const res = await request(app).get("/api/v1/places?year=abc").set("Cookie", cookie);
    expect(res.status).toBe(400);
  });
});
