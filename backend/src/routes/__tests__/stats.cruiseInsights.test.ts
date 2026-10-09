import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { resolveMetricEvidence } from "../../services/evidence/metricEvidence";
import { checkAndUpdateAchievements } from "../../utils/achievements";
import { ensureAchievements } from "../../data/achievements";
import {
  getInstanceSettings,
  updateInstanceSettings,
} from "../../services/instanceSettingsService";

/**
 * forgejo#257, end to end: new ports and ports seen again, time in port from
 * minute-precise calls only, a shore excursion from a note and from a day tour
 * linked by day and place — and that tour vanishing, not turning into zero,
 * while the reader does not see tours. The endpoint, the evidence resolvers
 * and the badge fold must agree.
 */

/**
 * The badges' progress after the REAL check — the path every save takes, which
 * hands its own rows to the insight measures instead of loading them again.
 */
async function badgeProgress(userId: string, codes: string[]): Promise<Record<string, number>> {
  await ensureAchievements();
  await checkAndUpdateAchievements(userId);
  const rows = await prisma.userAchievement.findMany({
    where: { userId, achievement: { code: { in: codes } } },
    select: { progress: true, achievement: { select: { code: true } } },
  });
  return Object.fromEntries(rows.map((r) => [r.achievement.code, r.progress]));
}

describe("GET /stats/cruise-insights", () => {
  let userId: string;
  let cookie: string;
  let betaBefore: boolean;
  const portIds: number[] = [];
  const cruiseIds: Record<string, string> = {};
  const page = { offset: 0, limit: 50 };
  const day = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

  async function port(name: string, lat: number, lon: number): Promise<number> {
    const row = await prisma.port.create({
      data: {
        name: `${name} (insights test)`,
        lat,
        lon,
        timezone: "Europe/Oslo",
        isUserAdded: true,
      },
    });
    portIds.push(row.id);
    return row.id;
  }

  beforeAll(async () => {
    betaBefore = (await getInstanceSettings()).betaFeaturesEnabled;
    await updateInstanceSettings({ betaFeaturesEnabled: true });
    const user = await prisma.user.create({
      data: { username: `cruise-insights-${Date.now()}`, passwordHash: "x" },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
    await prisma.userSettings.create({
      // No "roadtrip" domain on purpose: tours follow the web's
      // `useToursVisible` — the beta switch alone (ruling 2026-10-09).
      data: { userId, enabledDomains: ["flight", "cruise"], data: {} },
    });

    const kiel = await port("Kiel", 54.32, 10.14);
    const oslo = await port("Oslo", 59.9, 10.73);
    const bergen = await port("Bergen", 60.39, 5.32);

    for (const [key, start, end] of [
      ["first", "2019-06-01", "2019-06-04"],
      ["second", "2024-06-01", "2024-06-04"],
    ] as const) {
      const cruise = await prisma.cruise.create({
        data: {
          userId,
          status: "flown",
          routeName: `Norway ${key}`,
          startDate: day(start),
          endDate: day(end),
          departurePortId: kiel,
          arrivalPortId: kiel,
        },
      });
      cruiseIds[key] = cruise.id;
      const y = start.slice(0, 4);
      await prisma.cruiseStop.createMany({
        data: [
          {
            cruiseId: cruise.id,
            dayNumber: 2,
            portId: oslo,
            stopDate: day(`${y}-06-02`),
            stopZone: "Europe/Oslo",
            arrivalUtc: new Date(`${y}-06-02T06:00:00Z`),
            departureUtc: new Date(`${y}-06-02T15:30:00Z`),
            timePrecision: "minute",
            excursionNote: key === "second" ? "Holmenkollen" : null,
          },
          { cruiseId: cruise.id, dayNumber: 3, isAtSea: true },
          { cruiseId: cruise.id, dayNumber: 4, portId: bergen, stopDate: day(`${y}-06-04`) },
        ],
      });
    }

    // A hike in Bergen on the second cruise's Bergen day: a shore excursion.
    const tour = await prisma.tripRoute.create({
      data: {
        userId,
        name: "Fløyen",
        mode: "foot",
        kind: "tour",
        activity: "hike",
        tourDate: day("2024-06-04"),
      },
    });
    await prisma.tripStop.create({
      data: { routeId: tour.id, routeOrderIdx: 0, title: "Start", lat: 60.395, lon: 5.33 },
    });
    // A recorded walk in Oslo on the FIRST cruise's Oslo day, with no station:
    // its position comes from the first point of its recording alone.
    const walk = await prisma.tripRoute.create({
      data: {
        userId,
        name: "Vigeland",
        mode: "foot",
        kind: "tour",
        activity: "walk",
        tourDate: day("2019-06-02"),
      },
    });
    await prisma.tripRouteTrack.create({
      data: {
        routeId: walk.id,
        source: "gpx",
        startedAt: new Date("2019-06-02T08:00:00Z"),
        endedAt: new Date("2019-06-02T10:00:00Z"),
        geometry: [
          [10.7, 59.927],
          [10.71, 59.93],
        ],
        pointCount: 2,
        distanceKm: 4.2,
      },
    });
  });

  afterAll(async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: betaBefore });
    await prisma.userAchievement.deleteMany({ where: { userId } });
    await prisma.tripRoute.deleteMany({ where: { userId } });
    await prisma.cruise.deleteMany({ where: { userId } });
    await prisma.userSettings.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.port.deleteMany({ where: { id: { in: portIds } } });
  });

  it("answers ports, stays, excursions and day patterns", async () => {
    const res = await request(app).get("/api/v1/stats/cruise-insights").set("Cookie", cookie);
    expect(res.status).toBe(200);
    const body = res.body;

    expect(body.cruises).toBe(2);
    expect(
      body.ports.years.map((y: { year: number; newPorts: unknown[]; revisitedPorts: number }) => [
        y.year,
        y.newPorts.length,
        y.revisitedPorts,
      ])
    ).toEqual([
      [2019, 3, 0],
      [2024, 0, 3],
    ]);
    expect(body.ports.repeatPorts[0].cruises).toHaveLength(2);
    expect(body.repeatedItineraries).toHaveLength(1);

    // Oslo is measured twice (9 h 30), Bergen never: no times, out of the average.
    expect(body.portStays).toMatchObject({
      calls: 4,
      measured: 2,
      missingTime: 2,
      totalMinutes: 1140,
      averageMinutes: 570,
    });

    const second = body.excursions.perCruise.find(
      (c: { cruise: { id: string } }) => c.cruise.id === cruiseIds.second
    );
    expect(second).toMatchObject({ notedCalls: 1, documentedCalls: 2, activities: { hike: 1 } });
    expect(second.tours[0]).toMatchObject({ name: "Fløyen", portName: "Bergen (insights test)" });
    const first = body.excursions.perCruise.find(
      (c: { cruise: { id: string } }) => c.cruise.id === cruiseIds.first
    );
    expect(first).toMatchObject({ documentedCalls: 1, onFootRecordedKm: 4.2, plannedKm: null });
    expect(first.tours.map((t: { name: string }) => t.name)).toEqual(["Vigeland"]);

    expect(body.dayPattern.perCruise[0]).toMatchObject({
      seaDays: 1,
      portDays: 2,
      unlistedDays: 1,
      type: "balanced",
    });
    expect(body.events.birthdayKnown).toBe(false);
  });

  it("cuts the per-cruise lists to a year but judges 'new' against every cruise", async () => {
    const res = await request(app)
      .get("/api/v1/stats/cruise-insights?year=2024")
      .set("Cookie", cookie);
    expect(res.body.ports.perCruise).toEqual([
      expect.objectContaining({ newPorts: 0, revisitedPorts: 3 }),
    ]);
  });

  it("lists behind each count exactly the cruises the section counted", async () => {
    const year2024 = { period: { kind: "year" as const, year: 2024 } };
    const all = { period: { kind: "allTime" as const } };
    const newPorts = await resolveMetricEvidence(userId, "cruiseNewPortsCount", all, page);
    expect(newPorts!.measure.value).toBe(3);
    expect(newPorts!.entries.map((e) => e.id)).toEqual([cruiseIds.first]);

    const excursions = await resolveMetricEvidence(
      userId,
      "cruiseDocumentedExcursionCount",
      year2024,
      page
    );
    expect(excursions!.measure.value).toBe(2);
    expect(excursions!.entries.map((e) => [e.id, e.contribution])).toEqual([[cruiseIds.second, 2]]);

    const stays = await resolveMetricEvidence(userId, "cruiseMeasuredPortStayCount", all, page);
    expect(stays!.measure.value).toBe(2);
  });

  it("feeds the badges from the same fold", async () => {
    expect(
      await badgeProgress(userId, ["PORT_REUNION_3", "SAME_ITINERARY_2", "SHORE_EXCURSIONS_5"])
    ).toEqual({
      // Oslo and Bergen are calls on both cruises; Kiel (embark/disembark) is not counted.
      PORT_REUNION_3: 2,
      SAME_ITINERARY_2: 2,
      // Oslo by its note, Bergen by the linked hike — the domain toggle is off.
      SHORE_EXCURSIONS_5: 2,
    });
  });

  it("drops the tours, and only the tours, while the reader does not see them", async () => {
    await updateInstanceSettings({ betaFeaturesEnabled: false });
    try {
      const res = await request(app).get("/api/v1/stats/cruise-insights").set("Cookie", cookie);
      expect(res.body.excursions.toursVisible).toBe(false);
      const second = res.body.excursions.perCruise.find(
        (c: { cruise: { id: string } }) => c.cruise.id === cruiseIds.second
      );
      expect(second).toMatchObject({ documentedCalls: 1, tours: null, activities: null });
      expect((await badgeProgress(userId, ["SHORE_EXCURSIONS_5"])).SHORE_EXCURSIONS_5).toBe(1);
    } finally {
      await updateInstanceSettings({ betaFeaturesEnabled: true });
    }
  });
});
