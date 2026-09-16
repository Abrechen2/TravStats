import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";

/**
 * `GET /airports/search` and the closed-airport contract (#287).
 *
 * A closed airport has always been findable by its exact code and deliberately
 * NOT by name — fuzzy-matching them buried real airports under closed heliports
 * (UAT finding C13). But an import of old bookings has only the name: a 2004
 * confirmation says "Berlin", never "TXL", so Berlin-Tegel could not be
 * attached at all. `includeClosed=true` is the caller asking for them.
 *
 * The fixtures are created and removed here rather than relying on the seeded
 * catalogue — a test that passes only on a seeded database is a test that
 * reports the seed, not the route.
 */

const CLOSED_CODE = "ZTS";
const OPEN_CODE = "ZTO";

describe("GET /api/v1/airports/search — closed airports", () => {
  beforeAll(async () => {
    await prisma.airport.deleteMany({ where: { iata: { in: [CLOSED_CODE, OPEN_CODE] } } });
    await prisma.airport.createMany({
      data: [
        {
          iata: CLOSED_CODE,
          icao: "ZZTS",
          name: "Testhausen Old Airport",
          city: "Testhausen",
          country: "DE",
          lat: 52.5,
          lon: 13.3,
          isClosed: true,
        },
        {
          iata: OPEN_CODE,
          icao: "ZZTO",
          name: "Testhausen Central Airport",
          city: "Testhausen",
          country: "DE",
          lat: 52.4,
          lon: 13.4,
          isClosed: false,
        },
      ],
    });
  });

  afterAll(async () => {
    await prisma.airport.deleteMany({ where: { iata: { in: [CLOSED_CODE, OPEN_CODE] } } });
  });

  it("finds a closed airport by its exact code without any opt-in", async () => {
    const res = await request(app).get(`/api/v1/airports/search?q=${CLOSED_CODE}`);
    expect(res.status).toBe(200);
    expect(res.body.map((a: { iata: string }) => a.iata)).toContain(CLOSED_CODE);
  });

  it("hides a closed airport from a name search by default", async () => {
    const res = await request(app).get("/api/v1/airports/search?q=Testhausen");
    const codes = res.body.map((a: { iata: string }) => a.iata);
    expect(codes).toContain(OPEN_CODE);
    expect(codes).not.toContain(CLOSED_CODE);
  });

  it("returns it for a name search when the caller opts in", async () => {
    const res = await request(app).get(
      "/api/v1/airports/search?q=Testhausen&includeClosed=true",
    );
    const codes = res.body.map((a: { iata: string }) => a.iata);
    expect(codes).toContain(CLOSED_CODE);
    expect(codes).toContain(OPEN_CODE);
  });

  it("still lists the open airport first when closed ones are included", async () => {
    const res = await request(app).get(
      "/api/v1/airports/search?q=Testhausen&includeClosed=true",
    );
    const codes = res.body.map((a: { iata: string }) => a.iata);
    expect(codes.indexOf(OPEN_CODE)).toBeLessThan(codes.indexOf(CLOSED_CODE));
  });

  // The spec documented `limit` (1..50) for as long as the route has existed
  // while the handler hardcoded ten and ignored it — the reporter of #287
  // passed limit=3 and got ten rows back.
  it("honours the documented limit", async () => {
    const res = await request(app).get("/api/v1/airports/search?q=a&limit=3");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(3);
  });

  it("clamps a limit outside the documented range instead of trusting it", async () => {
    const res = await request(app).get("/api/v1/airports/search?q=a&limit=9999");
    expect(res.body.length).toBeLessThanOrEqual(50);
  });
});
