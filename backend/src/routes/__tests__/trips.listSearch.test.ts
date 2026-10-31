import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { TRIPS_LIST_CAP } from "../../services/trip/tripsListInclude";

/**
 * GET /trips stopped at 500 rows and the page searched only those, so a trip
 * past the cap could never be found. The server now searches, filters and
 * pages; a caller with no params still gets exactly the old list.
 */
describe("GET /api/v1/trips search and paging", () => {
  let cookie: string;
  let userId: string;
  const TOTAL = TRIPS_LIST_CAP + 20;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tripslistsearch" } });
    const user = await prisma.user.create({
      data: { username: "tripslistsearch", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    const base = Date.UTC(2020, 0, 1);
    // Oldest row (past the 500 cap in createdAt-desc order) is the needle.
    await prisma.trip.createMany({
      data: Array.from({ length: TOTAL }, (_, i) => ({
        // Fixed ids: the needle (undated, lowest id) is the very last row of the order.
        id: `00000000-0000-4000-8000-${i.toString(16).padStart(12, "0")}`,
        userId,
        name: i === 0 ? "Lissabon Needle" : `Trip ${i}`,
        notes: i === 1 ? "found via the notes" : null,
        status: i % 2 === 0 ? "completed" : "planned",
        category: i === 0 ? "business" : null,
        companions: i === 2 ? ["Alice Smith"] : [],
        countries: i === 3 ? ["PT"] : [],
        createdAt: new Date(base + i * 1000),
        // Every third trip undated; the rest spread over days, with ties.
        startDay: i % 3 === 0 ? null : new Date(Date.UTC(2021, 0, 1 + (i % 40))),
      })),
    });
  }, 60_000);

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: "tripslistsearch" } });
  });

  const get = (qs: string) =>
    request(app).get(`/api/v1/trips${qs}`).set("Cookie", cookie).expect(200);

  it("without params answers exactly as before: 500 rows, truncated, no facets", async () => {
    const res = await get("");
    expect(res.body.trips).toHaveLength(TRIPS_LIST_CAP);
    expect(res.body.total).toBe(TOTAL);
    expect(res.body.truncated).toBe(true);
    expect(res.body.facets).toBeUndefined();
    expect(res.body.trips.some((t: { name: string }) => t.name === "Lissabon Needle")).toBe(false);
  });

  it("finds a trip past the 500 cap by search, case-insensitively", async () => {
    const res = await get("?q=lissabon");
    expect(res.body.trips.map((t: { name: string }) => t.name)).toEqual(["Lissabon Needle"]);
    expect(res.body.total).toBe(1);
    expect(res.body.truncated).toBe(false);
  });

  it("searches the notes too", async () => {
    const res = await get("?q=VIA%20THE%20NOTES");
    expect(res.body.trips).toHaveLength(1);
  });

  it("matches companions and countries as case-insensitive substrings, as the page always did", async () => {
    expect((await get("?q=alice")).body.trips).toHaveLength(1);
    expect((await get("?q=pt")).body.total).toBe(1);
  });

  it("pages past the cap with offset and repeats no row", async () => {
    const first = await get("?limit=300&offset=0");
    const second = await get("?limit=300&offset=300");
    expect(first.body.truncated).toBe(true);
    expect(second.body.trips).toHaveLength(TOTAL - 300);
    expect(second.body.truncated).toBe(false);
    const ids = [...first.body.trips, ...second.body.trips].map((t: { id: string }) => t.id);
    expect(new Set(ids).size).toBe(TOTAL);
    expect(second.body.trips.some((t: { name: string }) => t.name === "Lissabon Needle")).toBe(
      true
    );
  });

  it("orders by start day, newest first, undated last, so page 2 sorts entirely after page 1", async () => {
    const first = await get("?limit=200&offset=0");
    const second = await get("?limit=200&offset=200");
    type Row = { id: string; startDay: string | null };
    const key = (t: Row) => t.startDay ?? "";
    const all: Row[] = [...first.body.trips, ...second.body.trips];
    for (let i = 1; i < all.length; i++) {
      expect(key(all[i - 1]) >= key(all[i])).toBe(true);
    }
    const lastOfFirst = first.body.trips[first.body.trips.length - 1] as Row;
    expect(second.body.trips.every((t: Row) => key(t) <= key(lastOfFirst))).toBe(true);
    expect(new Set(all.map((t) => t.id)).size).toBe(400);
    // Guard against a vacuous pass: the day must really be in the payload.
    expect(all.some((t) => t.startDay !== null)).toBe(true);
  });

  it("filters by status and category on the server and counts the pills under the search", async () => {
    const byCategory = await get("?category=business");
    expect(byCategory.body.trips).toHaveLength(1);
    const planned = await get("?status=planned&limit=5");
    expect(planned.body.total).toBe(TOTAL / 2);
    expect(planned.body.trips.every((t: { status: string }) => t.status === "planned")).toBe(true);
    expect(planned.body.facets.status.completed).toBe(TOTAL / 2);
    expect(planned.body.facets.category.business).toBe(1);
  });

  it("rejects a malformed page param instead of silently defaulting", async () => {
    await request(app).get("/api/v1/trips?limit=abc").set("Cookie", cookie).expect(400);
    await request(app).get("/api/v1/trips?limit=501").set("Cookie", cookie).expect(400);
    await request(app).get("/api/v1/trips?status=nope").set("Cookie", cookie).expect(400);
  });
});
