import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import {
  assertDistinctInvariant,
  assertSumInvariant,
} from "../../services/evidence/__tests__/invariants";

/**
 * The places tab's rhythm, quality and fun-fact cards open their visits
 * (forgejo#259). Each literal below is what the client fold
 * (`lib/stats/poiStatsDetail.ts`) shows for the same fixture — the frontend
 * test `poiStatsDetail.test.ts` pins the fold to the same tie rules
 * (`shared/placeRhythm.ts`).
 *
 * Fixture (all user A's):
 *   - Café Nord (food, lat 60): visits 2024-03-04 (Mon), 2024-03-05 (Tue) on a
 *     trip, rated 5; 2024-03-06 (Wed); and one UNDATED visit.
 *   - Museum Süd (museum, lat 40): visits 2024-03-05 rated 3, 2024-07-07 (Sun).
 *   - Strand (beach, lat 10): visit 2025-03-04 rated 4.
 *   - Wunschort (park, lat 80): wishlist, never counted — not even northernmost.
 */
describe("GET /api/v1/evidence/metric/... — places rhythm, quality, fun facts", () => {
  let cookie: string;
  let userId: string;
  let tripId: string;
  const day = (iso: string): Date => new Date(`${iso}T10:00:00Z`);

  interface Body {
    measure: { value: number | null; aggregation: string };
    entries: Array<{ id: string; title: { text: string }; credits?: string[] }>;
  }

  const get = async (key: string, query = ""): Promise<Body> => {
    const res = await request(app)
      .get(`/api/v1/evidence/metric/${key}${query}`)
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    if (res.body.measure.aggregation === "sum") assertSumInvariant(res.body, Math.round);
    else assertDistinctInvariant(res.body);
    return res.body as Body;
  };
  const names = (body: Body): string[] => body.entries.map((e) => e.title.text).sort();

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "evidenceplacedetail" } });
    const user = await prisma.user.create({
      data: { username: "evidenceplacedetail", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    tripId = (await prisma.trip.create({ data: { userId, name: "Nordreise" } })).id;

    const place = (name: string, category: string, lat: number, visited = true) =>
      prisma.place.create({
        data: { userId, name, category, lat, lon: 10, visited },
      });
    const nord = await place("Café Nord", "food", 60);
    const sued = await place("Museum Süd", "museum", 40);
    const strand = await place("Strand", "beach", 10);
    await place("Wunschort", "park", 80, false);

    const visit = (placeId: string, at: Date | null, extra: object = {}) =>
      prisma.placeVisit.create({ data: { userId, placeId, visitedAt: at, ...extra } });
    await visit(nord.id, day("2024-03-04"));
    await visit(nord.id, day("2024-03-05"), { tripId, rating: 5 });
    await visit(nord.id, day("2024-03-06"));
    await visit(nord.id, null);
    await visit(sued.id, day("2024-03-05"), { rating: 3 });
    await visit(sued.id, day("2024-07-07"));
    await visit(strand.id, day("2025-03-04"), { rating: 4 });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("lists the visits of the busiest month and weekday", async () => {
    // March: 4 visits in 2024 + 1 in 2025; Tuesday: 2024-03-05 twice.
    expect((await get("placeBusiestMonthVisits")).measure.value).toBe(5);
    expect((await get("placeBusiestMonthVisits", "?period=year&year=2024")).measure.value).toBe(4);
    // Tuesday: 2024-03-05 twice and 2025-03-04.
    const weekday = await get("placeBusiestWeekdayVisits");
    expect(weekday.measure.value).toBe(3);
    expect(names(weekday)).toEqual(["Café Nord", "Museum Süd", "Strand"]);
    // In 2024 Tuesday (2) ties nothing; Sunday, Monday, Wednesday hold one each.
    expect((await get("placeBusiestWeekdayVisits", "?period=year&year=2024")).measure.value).toBe(
      2
    );
  });

  it("names the places of the busiest day and the days of the longest run", async () => {
    const busiest = await get("placeBusiestDayPlaces");
    expect(busiest.measure.value).toBe(2);
    expect(names(busiest)).toEqual(["Café Nord", "Museum Süd"]);
    const streak = await get("placeLongestStreakDays");
    // 4th, 5th and 6th of March 2024; the 5th carries two visits and counts once.
    expect(streak.measure.value).toBe(3);
    expect(streak.entries).toHaveLength(4);
  });

  it("lists rated visits only — an unrated visit is not a zero", async () => {
    expect((await get("placeRatedVisitCount")).measure.value).toBe(3);
    expect((await get("placeRatedVisitCount", "?period=year&year=2025")).measure.value).toBe(1);
  });

  it("opens the first visit, the favourite's visits and the visits on a trip", async () => {
    expect(names(await get("placeFirstVisit"))).toEqual(["Café Nord"]);
    // The undated visit is one of the favourite's four.
    expect((await get("placeFavouriteVisits")).measure.value).toBe(4);
    expect((await get("placeVisitsOnTripsCount")).measure.value).toBe(1);
  });

  it("counts categories used and names the extreme places among the visited ones", async () => {
    expect((await get("placeCategoriesUsedCount")).measure.value).toBe(3);
    expect((await get("placeCategoriesUsedCount", "?period=year&year=2025")).measure.value).toBe(1);
    // The wishlist place at 80° is not visited, so it is not northernmost.
    expect(names(await get("placeNorthernmost"))).toEqual(["Café Nord"]);
    expect(names(await get("placeSouthernmost"))).toEqual(["Strand"]);
  });

  it("opens the most varied trip's visits, one credit per category", async () => {
    const variety = await get("placeVarietyTripCategories");
    expect(variety.measure.value).toBe(1);
    expect(variety.entries.map((e) => e.credits)).toEqual([["food"]]);
  });

  it("refuses a rolling window the period strip never offers", async () => {
    const res = await request(app)
      .get("/api/v1/evidence/metric/placeBusiestDayPlaces?period=rolling12m")
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
  });
});
