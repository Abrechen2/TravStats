import { prisma } from "../../../db";
import { loadCrossDomainPopulation } from "../crossDomainPopulations";
import { DOMAIN_AGGREGATES } from "../../comparison/domainAggregates";

/**
 * Day tours in the cross-domain overview (tours-own-domain T3): one event on the tour's day,
 * the country of its first point, a planned or undated tour counting nowhere — and a tour
 * inside a trip counted once, under `tour`, never again as a roadtrip.
 */
const USER = "crossdomaintour";
const day = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("cross-domain population — tours", () => {
  let userId: string;
  let tripId: string;

  async function tour(name: string, tourDate: Date | null, inTrip: boolean) {
    const route = await prisma.tripRoute.create({
      data: {
        userId,
        name,
        mode: "foot",
        kind: "tour",
        tourDate,
        ...(inTrip ? { tripId } : {}),
      },
    });
    // Hirtshals: a shore point, so the country comes from the boundary set.
    await prisma.tripStop.create({
      data: { title: "Start", lat: 53.55, lon: 9.99, routeId: route.id, routeOrderIdx: 0 },
    });
    return route.id;
  }

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    userId = (await prisma.user.create({ data: { username: USER, passwordHash: "x" } })).id;
    tripId = (await prisma.trip.create({ data: { userId, name: "Hamburg" } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    await prisma.$disconnect();
  });

  it("files a past tour inside a trip once, under tour", async () => {
    const inside = await tour("Elbwanderung", day("2024-07-12"), true);
    await tour("Nächstes Jahr", day("2099-06-01"), true);
    await tour("Skizze", null, false);
    const standalone = await tour("Alsterrunde", day("2025-03-02"), false);

    const population = await loadCrossDomainPopulation(userId, ["tour", "roadtrip"]);
    expect(population.events.map((e) => e.domain)).toEqual(["tour", "tour"]);
    const byId = new Map(population.events.map((e) => [e.entry.id, e]));
    expect(byId.get(inside)).toMatchObject({ year: 2024, dayKeys: ["2024-07-12"] });
    expect(byId.get(inside)?.entry).toMatchObject({ domain: "tour", href: `/tours/${inside}` });
    expect(byId.get(standalone)).toMatchObject({ year: 2025 });
    // A day tour proves no country in the passport, so it offers no country row.
    expect(population.countryRows).toEqual([]);
  });

  it("counts the tour once in the comparison totals, whether or not it sits in a trip", async () => {
    const all = await DOMAIN_AGGREGATES.tour(userId, null);
    expect(all.values).toEqual({ tours: 2, tourKm: null });
    expect(await DOMAIN_AGGREGATES.roadtrip(userId, null)).toEqual({ values: {}, partial: [] });
  });
});
