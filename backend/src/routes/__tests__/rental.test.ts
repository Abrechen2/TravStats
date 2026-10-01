const searchPlacesDetailed = jest.fn();
jest.mock("../../services/geo/photon", () => ({
  ...jest.requireActual("../../services/geo/photon"),
  searchPlacesDetailed: (...args: unknown[]) => searchPlacesDetailed(...args),
}));

import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { rentalCreationLimiter } from "../../middleware/rateLimit";

/**
 * Car rentals (spec docs/superpowers/specs/2026-10-01-rental-domain-design.md),
 * package R1 — manual entry. The rules worth the most are the ones a client
 * cannot see: where a station is, whose clock a time is read on, and whose row
 * a request may touch. Every value here is invented.
 */

const FRA = { iata: "FRA", name: "Frankfurt Flughafen" };
const MUC = { iata: "MUC", name: "München Flughafen" };
const LAX = { iata: "LAX", name: "Los Angeles Airport" };
const JFK = { iata: "JFK", name: "New York JFK" };
const CXI = { iata: "CXI", name: "Kiritimati Airport" };
const PPG = { iata: "PPG", name: "Pago Pago Airport" };

describe("Rentals API (R1)", () => {
  let cookie: string;
  let userId: string;
  let otherCookie: string;
  let otherUserId: string;

  const create = (body: Record<string, unknown>, as = cookie) =>
    request(app).post("/api/v1/rentals").set("Cookie", as).send(body);

  const base = {
    provider: "Testcar",
    confirmationNumber: "1234567890",
    pickupStation: FRA,
    pickupLocal: "2026-07-01T10:00",
    returnLocal: "2026-07-05T09:30",
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: ["rentaltest", "rentalother"] } } });
    const user = await prisma.user.create({
      data: { username: "rentaltest", passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
    const other = await prisma.user.create({
      data: { username: "rentalother", passwordHash: await hashPassword("password123") },
    });
    otherUserId = other.id;
    otherCookie = `auth_token=${generateToken(other.id)}`;
  });

  beforeEach(() => {
    searchPlacesDetailed.mockReset();
  });

  afterEach(async () => {
    await prisma.rentalBooking.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.tripRoute.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await rentalCreationLimiter.resetKey(`user:${userId}`);
    await rentalCreationLimiter.resetKey(`user:${otherUserId}`);
  });

  afterAll(async () => {
    await prisma.trip.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.companion.deleteMany({ where: { userId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await prisma.$disconnect();
  });

  it("requires authentication", async () => {
    expect((await request(app).get("/api/v1/rentals")).status).toBe(401);
  });

  describe("stations and times", () => {
    it("places an airport station by its IATA code and reads the clock there", async () => {
      const res = await create(base);
      expect(res.status).toBe(201);
      const row = res.body.data;
      // 10:00 in Frankfurt (CEST, UTC+2) is 08:00 UTC.
      expect(row.pickupTime).toBe("2026-07-01T08:00:00.000Z");
      expect(row.pickupTimezone).toBe("Europe/Berlin");
      expect(row.pickupCountry).toBe("DE");
      expect(row.pickupIata).toBe("FRA");
      expect(row.times.pickup).toMatchObject({
        local: "2026-07-01T10:00:00",
        zone: "Europe/Berlin",
        offset: "+02:00",
        precision: "minute",
      });
    });

    it("returns the car where it was picked up when no return station is sent", async () => {
      const row = (await create(base)).body.data;
      expect(row.returnStationName).toBe(FRA.name);
      expect(row.returnAirportId).toBe(row.pickupAirportId);
      expect(row.oneWay).toBe(false);
      expect(row.rentalDays).toBe(4);
    });

    it("reads a one-way return on the RETURN station's clock", async () => {
      const res = await create({
        ...base,
        pickupStation: LAX,
        returnStation: JFK,
        pickupLocal: "2026-07-01T10:00",
        returnLocal: "2026-07-08T18:00",
      });
      expect(res.status).toBe(201);
      expect(res.body.data.pickupTime).toBe("2026-07-01T17:00:00.000Z");
      expect(res.body.data.returnTime).toBe("2026-07-08T22:00:00.000Z");
      expect(res.body.data.oneWay).toBe(true);
    });

    it("compares instants, not wall clocks: an early-looking return across zones is valid", async () => {
      // JFK 12:00 (UTC−4) → LAX 10:00 (UTC−7) the same day is a five-hour rental.
      const ok = await create({
        ...base,
        pickupStation: JFK,
        returnStation: LAX,
        pickupLocal: "2026-07-01T12:00",
        returnLocal: "2026-07-01T10:00",
      });
      expect(ok.status).toBe(201);
    });

    it("refuses a return before the pickup, naming the field", async () => {
      const res = await create({ ...base, returnLocal: "2026-06-30T09:00" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("RENTAL_RETURN_BEFORE_PICKUP");
      expect(res.body.field).toBe("returnLocal");
      expect(await prisma.rentalBooking.count({ where: { userId } })).toBe(0);
    });

    it("refuses a pickup in the spring-forward gap instead of shifting it", async () => {
      const res = await create({
        ...base,
        pickupLocal: "2026-03-29T02:30",
        returnLocal: "2026-04-02T10:00",
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe("LOCAL_TIME_NONEXISTENT");
      expect(res.body.field).toBe("pickupLocal");
    });

    it("keeps far-off positive and negative offsets apart (UTC+14 and UTC−11)", async () => {
      const east = await create({
        ...base,
        pickupStation: CXI,
        pickupLocal: "2026-07-01T09:00",
        returnLocal: "2026-07-03T09:00",
      });
      expect(east.status).toBe(201);
      expect(east.body.data.pickupTime).toBe("2026-06-30T19:00:00.000Z");
      expect(east.body.data.times.pickup.offset).toBe("+14:00");

      const west = await create({
        ...base,
        confirmationNumber: "2",
        pickupStation: PPG,
        pickupLocal: "2026-07-01T09:00",
        returnLocal: "2026-07-03T09:00",
      });
      expect(west.status).toBe(201);
      expect(west.body.data.pickupTime).toBe("2026-07-01T20:00:00.000Z");
      expect(west.body.data.times.pickup.offset).toBe("-11:00");
    });

    it("stores a bare day with precision day, at the station's midnight", async () => {
      const res = await create({ ...base, pickupLocal: "2026-07-01", returnLocal: "2026-07-04" });
      expect(res.status).toBe(201);
      expect(res.body.data.pickupPrecision).toBe("day");
      expect(res.body.data.pickupTime).toBe("2026-06-30T22:00:00.000Z");
      expect(res.body.data.times.pickup.precision).toBe("day");
    });

    it("places a station by the position the client sends, deriving zone and country", async () => {
      const res = await create({
        ...base,
        pickupStation: { name: "Stadtbüro", lat: 48.137, lon: 11.575 },
      });
      expect(res.status).toBe(201);
      expect(res.body.data.pickupTimezone).toBe("Europe/Berlin");
      expect(res.body.data.pickupCountry).toBe("DE");
      expect(res.body.data.pickupAirportId).toBeNull();
    });

    // Silent-failure class 2: a station that cannot be placed is refused —
    // never stored at UTC, the user's home or the trip's first airport.
    it("refuses a station that names no airport, position or address", async () => {
      const res = await create({ ...base, pickupStation: { name: "Somewhere" } });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe("RENTAL_STATION_UNRESOLVED");
      expect(res.body.field).toBe("pickupStation");
      expect(await prisma.rentalBooking.count({ where: { userId } })).toBe(0);
    });

    it("refuses an IATA code the catalogue does not know", async () => {
      const res = await create({ ...base, pickupStation: { iata: "QQQ", name: "Nowhere" } });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe("RENTAL_STATION_UNRESOLVED");
    });

    it("geocodes an address and stores the hit", async () => {
      searchPlacesDetailed.mockResolvedValue({
        degraded: false,
        results: [{ name: "x", lat: 52.52, lon: 13.405, countryCode: "de" }],
      });
      const res = await create({
        ...base,
        pickupStation: { name: "City office", address: "Musterstraße 1, Berlin" },
      });
      expect(res.status).toBe(201);
      expect(res.body.data.pickupLat).toBe(52.52);
      expect(res.body.data.pickupCountry).toBe("DE");
    });

    // Silent-failure class 3: a geocoder that cannot answer is not "no such place".
    it("surfaces a geocoder that is down as itself, and stores nothing", async () => {
      searchPlacesDetailed.mockResolvedValue({ degraded: true, results: [] });
      const res = await create({
        ...base,
        pickupStation: { name: "City office", address: "Musterstraße 1, Berlin" },
      });
      expect(res.status).toBe(503);
      expect(res.body.code).toBe("RENTAL_GEOCODER_UNAVAILABLE");
      expect(await prisma.rentalBooking.count({ where: { userId } })).toBe(0);
    });

    it("tells an address nobody can find from a geocoder that is down", async () => {
      searchPlacesDetailed.mockResolvedValue({ degraded: false, results: [] });
      const res = await create({
        ...base,
        pickupStation: { name: "City office", address: "Nowhere Lane 0" },
      });
      expect(res.status).toBe(422);
      expect(res.body.code).toBe("RENTAL_STATION_UNRESOLVED");
    });

    it("refuses a misspelt fold key instead of dropping it", async () => {
      const res = await create({ ...base, pickupFolds: "later" });
      expect(res.status).toBe(400);
      expect(res.body.field).toBe("pickupFolds");
    });
  });

  describe("values", () => {
    it("keeps an unknown price null and a package price null — never 0", async () => {
      const res = await create({ ...base, paymentTiming: "package" });
      expect(res.body.data.price).toBeNull();
      expect(res.body.data.cost).toBeNull();
      expect(res.body.data.distanceKm).toBeNull();
    });

    it("derives the ACRISS traits on read and refuses a code that is not one", async () => {
      const ok = await create({ ...base, acrissCode: "cdmr" });
      expect(ok.body.data.acrissCode).toBe("CDMR");
      expect(ok.body.data.vehicleTraits).toEqual({ transmission: "manual", airConditioning: true });
      const bad = await create({ ...base, confirmationNumber: "9", acrissCode: "CARS" });
      expect(bad.status).toBe(400);
      expect(bad.body.field).toBe("acrissCode");
    });

    it("labels a typed km figure and final amount as corrections", async () => {
      const res = await create({
        ...base,
        distanceKm: 812,
        finalAmount: 310.5,
        finalCurrency: "EUR",
      });
      expect(res.body.data.distanceSource).toBe("user");
      expect(res.body.data.finalAmountSource).toBe("user");
      expect(res.body.data.cost).toEqual({ amount: 310.5, currency: "EUR", source: "final" });
    });

    it("lets a client cancel but never claim completion", async () => {
      const done = await create({ ...base, status: "completed" });
      expect(done.status).toBe(400);
      const cancelled = await create({ ...base, status: "cancelled" });
      expect(cancelled.body.data.status).toBe("cancelled");
    });

    it("derives the status from the clock", async () => {
      const past = await create({
        ...base,
        pickupLocal: "2020-07-01T10:00",
        returnLocal: "2020-07-05T10:00",
      });
      expect(past.body.data.status).toBe("completed");
    });
  });

  describe("updates", () => {
    it("keeps everything a one-field PATCH does not send, and records the edit", async () => {
      const row = (await create({ ...base, price: 200, currency: "EUR" })).body.data;
      const res = await request(app)
        .patch(`/api/v1/rentals/${row.id}`)
        .set("Cookie", cookie)
        .send({ notes: "Winter tyres" });
      expect(res.status).toBe(200);
      expect(res.body.data.pickupTime).toBe(row.pickupTime);
      expect(res.body.data.price).toBe(200);
      expect(res.body.data.userEditedFields).toEqual(expect.arrayContaining(["notes", "price"]));
    });

    it("refuses a return moved before an untouched pickup", async () => {
      const row = (await create(base)).body.data;
      const res = await request(app)
        .patch(`/api/v1/rentals/${row.id}`)
        .set("Cookie", cookie)
        .send({ returnLocal: "2026-06-01T10:00" });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("RENTAL_RETURN_BEFORE_PICKUP");
    });

    it("keeps the booking's wall clock when a station moves into another zone", async () => {
      const row = (await create(base)).body.data;
      const res = await request(app)
        .patch(`/api/v1/rentals/${row.id}`)
        .set("Cookie", cookie)
        .send({ pickupStation: LAX, returnStation: null });
      expect(res.status).toBe(200);
      expect(res.body.data.times.pickup.local).toBe("2026-07-01T10:00:00");
      expect(res.body.data.pickupTimezone).toBe("America/Los_Angeles");
      expect(res.body.data.returnStationName).toBe(LAX.name);
    });

    it("clears a km correction with null", async () => {
      const row = (await create({ ...base, distanceKm: 100 })).body.data;
      const res = await request(app)
        .patch(`/api/v1/rentals/${row.id}`)
        .set("Cookie", cookie)
        .send({ distanceKm: null });
      expect(res.body.data.distanceKm).toBeNull();
      expect(res.body.data.distanceSource).toBeNull();
    });
  });

  describe("ownership", () => {
    it("hides another account's rental", async () => {
      const row = (await create(base, otherCookie)).body.data;
      expect(
        (await request(app).get(`/api/v1/rentals/${row.id}`).set("Cookie", cookie)).status
      ).toBe(404);
      const patch = await request(app)
        .patch(`/api/v1/rentals/${row.id}`)
        .set("Cookie", cookie)
        .send({ notes: "x" });
      expect(patch.status).toBe(404);
      expect(
        (await request(app).delete(`/api/v1/rentals/${row.id}`).set("Cookie", cookie)).status
      ).toBe(404);
    });

    it("refuses another account's trip and roadtrip", async () => {
      const trip = await prisma.trip.create({ data: { userId: otherUserId, name: "Theirs" } });
      expect((await create({ ...base, tripId: trip.id })).status).toBe(404);
      const route = await prisma.tripRoute.create({
        data: { userId: otherUserId, kind: "roadtrip", mode: "car", name: "Their drive" },
      });
      const res = await create({ ...base, routeId: route.id });
      expect(res.status).toBe(404);
      expect(res.body.code).toBe("RENTAL_ROADTRIP_NOT_FOUND");
    });

    it("links the caller's own roadtrip", async () => {
      const route = await prisma.tripRoute.create({
        data: { userId, kind: "roadtrip", mode: "car", name: "Mine" },
      });
      const res = await create({ ...base, routeId: route.id });
      expect(res.status).toBe(201);
      expect(res.body.data.route).toEqual({ id: route.id, name: "Mine" });
    });
  });

  describe("list", () => {
    it("files a rental under its pickup station's year, not UTC's", async () => {
      // 00:30 on 1 January in Frankfurt is still 31 December in UTC.
      await create({ ...base, pickupLocal: "2027-01-01T00:30", returnLocal: "2027-01-03T10:00" });
      const in2027 = await request(app).get("/api/v1/rentals?year=2027").set("Cookie", cookie);
      expect(in2027.body.meta.total).toBe(1);
      const in2026 = await request(app).get("/api/v1/rentals?year=2026").set("Cookie", cookie);
      expect(in2026.body.meta.total).toBe(0);
    });

    it("pages with a stable order and searches the provider", async () => {
      await create(base);
      await create({ ...base, provider: "Othercar", confirmationNumber: "2" });
      const res = await request(app).get("/api/v1/rentals?q=other").set("Cookie", cookie);
      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].provider).toBe("Othercar");
    });
  });

  describe("stations search", () => {
    it("offers every matching airport and the user's earlier stations", async () => {
      await create({
        ...base,
        pickupStation: { name: "Testcar Stadtmitte", lat: 50.11, lon: 8.68 },
      });
      const res = await request(app)
        .get("/api/v1/rentals/stations?q=Testcar")
        .set("Cookie", cookie);
      expect(res.status).toBe(200);
      expect(res.body.data[0]).toMatchObject({ kind: "earlier", name: "Testcar Stadtmitte" });
      const airports = await request(app)
        .get("/api/v1/rentals/stations?q=FRA")
        .set("Cookie", cookie);
      expect(airports.body.data[0]).toMatchObject({ kind: "airport", iata: "FRA" });
    });

    it("never offers another account's stations", async () => {
      await create(
        { ...base, pickupStation: { name: "Private Counter", lat: 50.11, lon: 8.68 } },
        otherCookie
      );
      const res = await request(app)
        .get("/api/v1/rentals/stations?q=Private Counter")
        .set("Cookie", cookie);
      expect(res.body.data.filter((h: { kind: string }) => h.kind === "earlier")).toEqual([]);
    });
  });

  it("lists a rental's documents under its own path", async () => {
    const row = (await create(base)).body.data;
    const res = await request(app).get(`/api/v1/rentals/${row.id}/documents`).set("Cookie", cookie);
    expect(res.status).toBe(200);
  });

  it("deletes a rental", async () => {
    const row = (await create(base)).body.data;
    expect(
      (await request(app).delete(`/api/v1/rentals/${row.id}`).set("Cookie", cookie)).status
    ).toBe(204);
    expect(await prisma.rentalBooking.count({ where: { id: row.id } })).toBe(0);
  });
});
