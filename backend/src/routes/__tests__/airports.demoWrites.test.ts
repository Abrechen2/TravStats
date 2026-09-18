import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { clearAirportCache } from "../../services/airportCache";

/**
 * Finding 7 of the cold security audit of 2026-09-19: `GET /airports/:code` was
 * unauthenticated AND writes. On a miss `findOrCreateAirport` calls an external
 * provider and inserts a row into the global catalogue that every account
 * reads — so any stranger could make this instance spend a lookup and then
 * store whatever came back, permanently, because `wipeDemoUser` never touches
 * a catalogue.
 *
 * `/search` beside it stays public on purpose: it only reads, and the
 * signup-flow autocomplete runs before anyone has credentials. The comment
 * above it in `routes/airports.ts` says so.
 *
 * Two different guards, in two different places, and the split is the finding:
 *
 *   `authenticate` closes the UNAUTHENTICATED write. Anyone at all could
 *   previously drive the lookup.
 *
 *   The branch INSIDE the handler closes the SHARED DEMO's write. The
 *   middleware could not: `rejectDemoWrites` keys on the HTTP method and this
 *   is a mutating GET (the audit's own finding 8, arrived in the present), and
 *   refusing the route outright would take a legitimate read away — the demo's
 *   own flight form resolves known codes through here. So a known code reads
 *   normally and an unknown one answers 404 without ever reaching the provider,
 *   which is byte-identical to the 404 an unknown code already got when the
 *   external lookup found nothing.
 *
 * `rejectDemoWrites` stays mounted so a POST or DELETE added to this path later
 * is covered by construction.
 *
 * The external lookup is `fetch` inside `fetchFromExternalAPI`, so that is what
 * this file watches. A test that only read the status code would pass while the
 * instance was still spending an outbound request per attempt.
 */

/** What airport-data.com answers for a code it knows. */
const EXTERNAL_HIT = {
  iata: "QQZ",
  name: "Audit Created Field",
  location: "Auditville",
  country: "Testland",
  latitude: 1.5,
  longitude: 2.5,
};

describe("GET /api/v1/airports/:code — authentication and the demo write path", () => {
  let demoCookie: string;
  let userCookie: string;
  const ids: string[] = [];
  let fetchSpy: jest.SpyInstance;

  /** In the catalogue already. */
  const KNOWN = "QQQ";
  /** Never in the catalogue — what the demo must not be able to create. */
  const UNKNOWN_FOR_DEMO = "QQY";
  /** Never in the catalogue — what a normal account still creates. */
  const UNKNOWN_FOR_USER = "QQZ";

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["demo", "airportCodeUser"] } } });
    const demo = await prisma.user.create({
      data: { username: "demo", passwordHash: await hashPassword("demo123"), isDemo: true },
    });
    const user = await prisma.user.create({
      data: { username: "airportCodeUser", passwordHash: await hashPassword("password123") },
    });
    ids.push(demo.id, user.id);
    demoCookie = `auth_token=${generateToken(demo.id)}`;
    userCookie = `auth_token=${generateToken(user.id)}`;

    await prisma.airport.deleteMany({
      where: { iata: { in: [KNOWN, UNKNOWN_FOR_DEMO, UNKNOWN_FOR_USER] } },
    });
    await prisma.airport.create({
      data: { iata: KNOWN, name: "Audit Test Field", lat: 0, lon: 0 },
    });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.airport.deleteMany({
      where: { iata: { in: [KNOWN, UNKNOWN_FOR_DEMO, UNKNOWN_FOR_USER] } },
    });
    clearAirportCache();
  });

  beforeEach(() => {
    // The catalogue read is cached; a case must not inherit another's lookup.
    clearAirportCache();
    fetchSpy = jest.spyOn(globalThis, "fetch");
  });

  afterEach(() => {
    fetchSpy.mockRestore();
  });

  it("answers 401 to an unauthenticated caller — this route writes on a miss", async () => {
    const res = await request(app).get(`/api/v1/airports/${KNOWN}`);
    expect(res.status).toBe(401);
  });

  it("keeps /search public, because it only reads", async () => {
    const res = await request(app).get("/api/v1/airports/search").query({ q: KNOWN });
    expect(res.status).toBe(200);
  });

  it("serves an existing code to a normal account", async () => {
    const res = await request(app).get(`/api/v1/airports/${KNOWN}`).set("Cookie", userCookie);
    expect(res.status).toBe(200);
    expect(res.body.iata).toBe(KNOWN);
  });

  it("serves an existing code to the shared demo account — reading is not the finding", async () => {
    const res = await request(app).get(`/api/v1/airports/${KNOWN}`).set("Cookie", demoCookie);
    expect(res.status).toBe(200);
    expect(res.body.iata).toBe(KNOWN);
    // A hit is a database read either way, so nothing goes out.
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("answers 404 for an unknown code to the shared demo account, without a lookup and without a row", async () => {
    // The provider WOULD answer, so a leak could not hide behind an empty
    // upstream: if the handler reached `findOrCreateAirport` this code would be
    // created.
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => ({ ...EXTERNAL_HIT, iata: UNKNOWN_FOR_DEMO }),
    } as unknown as Response);

    const before = await prisma.airport.count();
    const res = await request(app)
      .get(`/api/v1/airports/${UNKNOWN_FOR_DEMO}`)
      .set("Cookie", demoCookie);

    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await prisma.airport.count()).toBe(before);
    expect(await prisma.airport.findFirst({ where: { iata: UNKNOWN_FOR_DEMO } })).toBeNull();
  });

  it("still creates on a miss for a normal account — the catalogue is not frozen, only the demo is", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      json: async () => EXTERNAL_HIT,
    } as unknown as Response);

    const res = await request(app)
      .get(`/api/v1/airports/${UNKNOWN_FOR_USER}`)
      .set("Cookie", userCookie);

    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalled();
    const created = await prisma.airport.findFirst({ where: { iata: UNKNOWN_FOR_USER } });
    expect(created).not.toBeNull();
    expect(created?.name).toBe("Audit Created Field");
  });
});
