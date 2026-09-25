import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `GET /tags` — the caller's tag vocabulary for the tag input. Pinned: tags
 * are gathered from all three tagged tables, merged case-insensitively,
 * ranked by use then name, filtered by `q`, bounded by `limit`, and nothing
 * of another account's tags is ever offered.
 */
describe("GET /api/v1/tags", () => {
  let user: { id: string };
  let other: { id: string };
  let authCookie: string;

  const tags = (query: Record<string, string> = {}) =>
    request(app).get("/api/v1/tags").query(query).set("Cookie", authCookie);

  const flight = (userId: string, tagList: string[]) => ({
    userId,
    depIata: "MUC",
    depLat: 48.3538,
    depLon: 11.7861,
    arrIata: "CPH",
    arrLat: 55.6181,
    arrLon: 12.656,
    status: "flown",
    tags: tagList,
  });

  beforeAll(async () => {
    const timestamp = Date.now();
    const make = (name: string) =>
      hashPassword("test-password").then((passwordHash) =>
        prisma.user.create({
          data: { username: `${name}-${timestamp}`, passwordHash, isAdmin: false, isActive: true },
        })
      );
    user = await make("tags");
    other = await make("tags-other");
    authCookie = `auth_token=${generateToken(user.id)}`;

    await prisma.flight.createMany({
      data: [
        flight(user.id, ["Business", "beach"]),
        flight(user.id, ["business", " Family "]),
        flight(user.id, ["business", ""]),
        // A special flight is a flight row; its tags count like any other.
        { ...flight(user.id, ["Sightseeing"]), specialType: "sightseeing" },
        flight(other.id, ["secret-other", "business"]),
      ],
    });
    await prisma.trip.create({
      data: { userId: user.id, name: "Trip", tags: ["Beach", "Family"] },
    });
    await prisma.cruise.create({
      data: {
        userId: user.id,
        cruiseLine: "Tag Line",
        startDate: new Date("2024-06-01"),
        endDate: new Date("2024-06-08"),
        status: "flown",
        tags: ["beach", "Zeta"],
      },
    });
  });

  afterAll(async () => {
    const ids = { in: [user?.id, other?.id] };
    await prisma.flight.deleteMany({ where: { userId: ids } });
    await prisma.trip.deleteMany({ where: { userId: ids } });
    await prisma.cruise.deleteMany({ where: { userId: ids } });
    await prisma.user.deleteMany({ where: { id: ids } });
  });

  it("merges spellings across flights, trips and cruises, most used first", async () => {
    const res = await tags();
    expect(res.status).toBe(200);
    expect(res.body.tags).toEqual([
      // A tie on use is broken by name; within a tag the spelling used most wins
      // ("beach" 2x over "Beach"). The other user's "business" is not counted.
      { name: "beach", usageCount: 3 },
      { name: "business", usageCount: 3 },
      { name: "Family", usageCount: 2 },
      { name: "Sightseeing", usageCount: 1 },
      { name: "Zeta", usageCount: 1 },
    ]);
  });

  it("never offers another account's tags", async () => {
    const res = await tags({ q: "secret" });
    expect(res.status).toBe(200);
    expect(res.body.tags).toEqual([]);
  });

  it("filters by q case-insensitively and treats wildcards as text", async () => {
    expect((await tags({ q: "AM" })).body.tags).toEqual([{ name: "Family", usageCount: 2 }]);
    expect((await tags({ q: "%" })).body.tags).toEqual([]);
  });

  it("bounds the list by limit and rejects an out-of-range limit", async () => {
    const res = await tags({ limit: "2" });
    expect(res.body.tags.map((t: { name: string }) => t.name)).toEqual(["beach", "business"]);
    expect((await tags({ limit: "500" })).status).toBe(400);
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/api/v1/tags")).status).toBe(401);
  });
});
