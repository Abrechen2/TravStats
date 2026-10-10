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
 * The roadtrip tab's four list tiles open their roadtrips (forgejo#260). The
 * tiles fold `GET /roadtrips` in the browser by `shared/tour/roadtripListScope`;
 * the literals here are what that fold shows for the fixture:
 *
 *   - "Dänemark" started 2024-05-01: Berlin → Roskilde, 300 km road + 50 km
 *     ferry, two free nights in Roskilde.
 *   - "Harz" started 2025-08-01: two stations in Germany, 120 km, no night.
 *   - "Zukunft" starts in 2099: planned, counted nowhere — not even lifetime.
 */
describe("GET /api/v1/evidence/metric/... — the roadtrip list tiles", () => {
  let cookie: string;
  let userId: string;
  const d = (iso: string): Date => new Date(`${iso}T00:00:00Z`);

  interface Body {
    measure: { value: number | null; aggregation: string };
    entries: Array<{ title: { text: string }; href: string; subtitle: unknown }>;
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

  async function roadtrip(
    name: string,
    vehicle: string | null,
    stations: Array<{ lat: number; lon: number; start: string; end?: string; overnight?: boolean }>,
    legs: Array<{ km: number; mode: string }>
  ): Promise<void> {
    const route = await prisma.tripRoute.create({
      data: { userId, name, mode: "road", kind: "roadtrip", vehicle },
    });
    const ids: string[] = [];
    for (const [i, s] of stations.entries()) {
      const stop = await prisma.tripStop.create({
        data: {
          routeId: route.id,
          routeOrderIdx: i,
          title: `${name} ${i}`,
          lat: s.lat,
          lon: s.lon,
          startDate: d(s.start),
          endDate: s.end ? d(s.end) : null,
          overnight: s.overnight ?? false,
        },
      });
      ids.push(stop.id);
    }
    for (const [i, l] of legs.entries()) {
      await prisma.tripRouteLeg.create({
        data: {
          routeId: route.id,
          fromStopId: ids[i],
          toStopId: ids[i + 1],
          distanceKm: l.km,
          source: "routed",
          mode: l.mode,
        },
      });
    }
  }

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: "evidenceroadtriplist" } });
    const user = await prisma.user.create({
      data: { username: "evidenceroadtriplist", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    await roadtrip(
      "Dänemark",
      "campervan",
      [
        { lat: 52.52, lon: 13.4, start: "2024-05-01" },
        { lat: 54.5, lon: 11.2, start: "2024-05-01" },
        { lat: 55.64, lon: 12.08, start: "2024-05-02", end: "2024-05-04", overnight: true },
      ],
      [
        { km: 300, mode: "road" },
        { km: 50, mode: "ferry" },
      ]
    );
    await roadtrip(
      "Harz",
      null,
      [
        { lat: 51.8, lon: 10.6, start: "2025-08-01" },
        { lat: 51.75, lon: 10.9, start: "2025-08-01" },
      ],
      [{ km: 120, mode: "road" }]
    );
    await roadtrip(
      "Zukunft",
      "car",
      [
        { lat: 48.1, lon: 11.5, start: "2099-01-01" },
        { lat: 47.3, lon: 11.4, start: "2099-01-02", overnight: true },
      ],
      [{ km: 160, mode: "road" }]
    );
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("lists the roadtrips that have started, each with its vehicle", async () => {
    const all = await get("roadtripCount");
    expect(all.measure.value).toBe(2);
    expect(all.entries.map((e) => e.title.text).sort()).toEqual(["Dänemark", "Harz"]);
    expect(all.entries.find((e) => e.title.text === "Harz")?.subtitle).toEqual({
      key: "evidence.subtitle.vehicle.unknown",
    });
    expect((await get("roadtripCount", "?period=year&year=2025")).measure.value).toBe(1);
    expect((await get("roadtripCount", "?period=year&year=2023")).measure.value).toBe(0);
  });

  it("sums the whole route of every mode, and the nights by the one night rule", async () => {
    expect((await get("roadtripRouteKm")).measure.value).toBe(470);
    expect((await get("roadtripRouteKm", "?period=year&year=2024")).measure.value).toBe(350);
    const nights = await get("roadtripNightsTotal");
    expect(nights.measure.value).toBe(2);
    expect(nights.entries.map((e) => e.title.text)).toEqual(["Dänemark"]);
  });

  it("counts the countries of the stations of the counted roadtrips", async () => {
    // Germany and Denmark; the planned Austria is not reached.
    expect((await get("roadtripCountriesCount")).measure.value).toBe(2);
    expect((await get("roadtripCountriesCount", "?period=year&year=2025")).measure.value).toBe(1);
  });
});
