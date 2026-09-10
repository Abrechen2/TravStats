import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * The same payload must produce the same row through either door.
 *
 * The single-flight POST wrote ten columns the batch import did not, and the
 * batch answered 201 while quietly storing nulls: seat class, aircraft
 * registration, Mode-S address, and the whole special-flight group. A flight
 * imported as First Class carried a first-class CO2 figure against a blank
 * cabin. Neither did the batch take an FX snapshot, so a foreign-currency
 * import had no converted amount at all — and by AUD-023, an unconvertible
 * booking then drags every cost-per-hour average down (audit finding AUD-022).
 *
 * The assertion is a field-by-field comparison of the two stored rows rather
 * than a list of expected values: a list would have to be extended by hand
 * every time a column is added, which is exactly how the two paths drifted.
 */
const USERNAME = `batch-parity-${Date.now()}`;

/** Columns that legitimately differ between the two paths. */
const EXPECTED_DIFFERENCES = new Set([
  "id",
  "externalRef",
  "importBatchId",
  "flightNumber",
  "dataSource",
  "createdAt",
  "updatedAt",
  "nextApiCheckAt",
]);

describe("single create and batch import agree", () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(userId)}`;
  });

  afterAll(async () => {
    await prisma.user.delete({ where: { id: userId } }).catch(() => {});
    await prisma.$disconnect();
  });

  const payload = (flightNumber: string) => ({
    flightNumber,
    airline: "Lufthansa",
    departure: { iata: "FRA", name: "Frankfurt", lat: 50.03, lon: 8.57 },
    arrival: { iata: "JFK", name: "New York", lat: 40.64, lon: -73.78 },
    departureLocal: "2026-06-01T10:00",
    depTimezone: "Europe/Berlin",
    arrivalLocal: "2026-06-01T13:00",
    arrTimezone: "America/New_York",
    status: "scheduled",
    seatClass: "first",
    aircraft: "A380",
    aircraftRegistration: "D-AUDT",
    aircraftModeS: "123abc",
    specialType: "training",
    patternLat: 48.1,
    patternLon: 11.6,
    price: 123,
    currency: "EUR",
  });

  it("stores the same columns for the same input", async () => {
    const single = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", cookie)
      .send(payload("LH1001"));
    expect(single.status).toBe(201);

    const batch = await request(app)
      .post("/api/v1/flights/batch")
      .set("Cookie", cookie)
      .send([payload("LH1002")]);
    expect(batch.status).toBe(201);

    const [a, b] = await Promise.all([
      prisma.flight.findFirstOrThrow({ where: { userId, flightNumber: "LH1001" } }),
      prisma.flight.findFirstOrThrow({ where: { userId, flightNumber: "LH1002" } }),
    ]);

    const differing = (Object.keys(a) as Array<keyof typeof a>).filter(
      (key) =>
        !EXPECTED_DIFFERENCES.has(key as string) &&
        JSON.stringify(a[key]) !== JSON.stringify(b[key]),
    );

    expect(differing).toEqual([]);
  });

  it("names the fields the batch used to drop", async () => {
    // Spelled out as well as compared, so a future reader can see WHICH
    // columns the finding was about without running a diff.
    const batch = await request(app)
      .post("/api/v1/flights/batch")
      .set("Cookie", cookie)
      .send([payload("LH1003")]);
    expect(batch.status).toBe(201);

    const stored = await prisma.flight.findFirstOrThrow({
      where: { userId, flightNumber: "LH1003" },
    });

    expect(stored.seatClass).toBe("first");
    expect(stored.aircraftRegistration).toBe("D-AUDT");
    expect(stored.aircraftModeS).toBe("123abc");
    expect(stored.specialType).toBe("training");
    expect(stored.patternLat).toBe(48.1);
    // The FX snapshot: an amount already in the base currency converts at 1,
    // which is a snapshot, not the absence of one.
    expect(stored.priceBase).toBe(123);
    expect(stored.fxRate).toBe(1);
    expect(stored.fxBaseCurrency).toBe("EUR");
  });
});
