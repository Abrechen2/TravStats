import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { LIST_SORT_KEYS } from "../../schemas/placeList";

/**
 * The list page as a table (owner 2026-11-26): server-side sort with a total ordering, paging,
 * the visit columns, the source, search and the purpose filter.
 */
const USERS = ["listmembers", "listmembersother"];

describe("GET /place-lists/:id/members", () => {
  let cookie: string;
  let otherCookie: string;
  let userId: string;
  let listId: string;
  const ids: Record<string, string> = {};

  const cleanup = async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
  };

  const get = (query: string, c = cookie) =>
    request(app).get(`/api/v1/place-lists/${listId}/members?${query}`).set("Cookie", c);
  const names = (res: request.Response) =>
    (res.body.data.rows as { name: string }[]).map((r) => r.name);

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USERS[0], passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    const o = await prisma.user.create({
      data: { username: USERS[1], passwordHash: await hashPassword("password123") },
    });
    otherCookie = `auth_token=${generateToken(o.id)}`;
    await prisma.userSettings.create({
      data: { userId, data: {}, homePlace: { name: "Home", lat: 52.52, lon: 13.405 } },
    });

    listId = (await prisma.placeList.create({ data: { userId, name: "Maccis" } })).id;
    // name, country, city, coords, visit days, entry createdBy, place createdBy, sortIdx
    const spec: [
      string,
      string,
      string,
      number,
      number,
      string[],
      string | null,
      string | null,
      number,
    ][] = [
      [
        "Berlin Mitte",
        "Deutschland",
        "Berlin",
        52.52,
        13.41,
        ["2024-01-05", "2025-03-01"],
        null,
        null,
        2,
      ],
      ["Rom Trevi", "Italien", "Rom", 41.9, 12.48, ["2023-06-01"], "brandRule", null, 0],
      ["Aachen", "Deutschland", "Aachen", 50.77, 6.08, [], null, "import", 1],
      // Same last visit as Berlin Mitte: the tie-breaker (name) decides.
      ["Bonn", "Deutschland", "Bonn", 50.73, 7.1, ["2025-03-01"], null, null, 3],
    ];
    for (const [
      i,
      [name, country, city, lat, lon, days, entryBy, placeBy, sortIdx],
    ] of spec.entries()) {
      const place = await prisma.place.create({
        data: { userId, name, country, city, lat, lon, category: "restaurant", createdBy: placeBy },
      });
      ids[name] = place.id;
      await prisma.placeListEntry.create({
        data: {
          listId,
          placeId: place.id,
          sortIdx,
          createdBy: entryBy,
          createdAt: new Date(Date.UTC(2026, 0, 1 + i)),
        },
      });
      for (const day of days)
        await prisma.placeVisit.create({
          data: {
            userId,
            placeId: place.id,
            visitedAt: new Date(`${day}T12:00:00Z`),
            purpose: name === "Rom Trevi" ? "business" : "private",
          },
        });
    }
    // A planned visit is not counted.
    await prisma.placeVisit.create({
      data: { userId, placeId: ids["Aachen"], visitedAt: new Date("2099-01-01T12:00:00Z") },
    });
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("answers every sort key, ascending and descending, ending in name as tie-breaker", async () => {
    const expected: Record<string, string[]> = {
      "lastVisit:desc": ["Berlin Mitte", "Bonn", "Rom Trevi", "Aachen"],
      "lastVisit:asc": ["Rom Trevi", "Berlin Mitte", "Bonn", "Aachen"],
      "firstVisit:asc": ["Rom Trevi", "Berlin Mitte", "Bonn", "Aachen"],
      "name:asc": ["Aachen", "Berlin Mitte", "Bonn", "Rom Trevi"],
      "name:desc": ["Rom Trevi", "Bonn", "Berlin Mitte", "Aachen"],
      "country:asc": ["Aachen", "Berlin Mitte", "Bonn", "Rom Trevi"],
      "visitCount:desc": ["Berlin Mitte", "Bonn", "Rom Trevi", "Aachen"],
      "addedAt:desc": ["Bonn", "Aachen", "Rom Trevi", "Berlin Mitte"],
      "distance:asc": ["Berlin Mitte", "Bonn", "Aachen", "Rom Trevi"],
      "custom:asc": ["Rom Trevi", "Aachen", "Berlin Mitte", "Bonn"],
    };
    for (const [key, order] of Object.entries(expected)) {
      const [sort, dir] = key.split(":");
      const res = await get(`sort=${sort}&order=${dir}`);
      expect(res.status).toBe(200);
      expect([key, names(res)]).toEqual([key, order]);
    }
    const covered = new Set(Object.keys(expected).map((k) => k.split(":")[0]));
    expect(LIST_SORT_KEYS.filter((k) => !covered.has(k))).toEqual([]);
  });

  it("counts past visits only and gives first, last and the dates", async () => {
    const res = await get("sort=name&order=asc");
    const rows = res.body.data.rows as Record<string, unknown>[];
    const berlin = rows.find((r) => r.name === "Berlin Mitte")!;
    expect(berlin).toMatchObject({
      visitCount: 2,
      firstVisit: "2024-01-05",
      lastVisit: "2025-03-01",
      source: "manual",
    });
    expect((berlin.visits as { date: string }[]).map((v) => v.date)).toEqual([
      "2025-03-01",
      "2024-01-05",
    ]);
    expect(rows.find((r) => r.name === "Aachen")).toMatchObject({
      visitCount: 0,
      lastVisit: null,
      source: "import",
    });
    expect(rows.find((r) => r.name === "Rom Trevi")).toMatchObject({ source: "rule" });
    expect(res.body.data.hasHome).toBe(true);
    expect((rows.find((r) => r.name === "Berlin Mitte")!.distanceKm as number) < 1).toBe(true);
  });

  it("pages after the total ordering without skipping or repeating", async () => {
    const p1 = await get("sort=lastVisit&order=desc&pageSize=3&page=1");
    const p2 = await get("sort=lastVisit&order=desc&pageSize=3&page=2");
    expect(p1.body.data.total).toBe(4);
    expect([...names(p1), ...names(p2)]).toEqual(["Berlin Mitte", "Bonn", "Rom Trevi", "Aachen"]);
  });

  it("searches name, town and country", async () => {
    expect(names(await get("q=ital&sort=name&order=asc"))).toEqual(["Rom Trevi"]);
    expect(names(await get("q=bonn"))).toEqual(["Bonn"]);
  });

  it("narrows to a purpose: places with a visit of it, counting only those visits", async () => {
    const res = await get("sort=name&order=asc&purposeFilter=business");
    expect(names(res)).toEqual(["Rom Trevi"]);
    expect(res.body.data.rows[0].visitCount).toBe(1);
  });

  it("refuses a bad sort and someone else's list", async () => {
    expect((await get("sort=nope")).status).toBe(400);
    expect((await get("sort=name", otherCookie)).status).toBe(404);
  });
});
