import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";

/**
 * The gap this closes: a booking mail with ONE flight comes through
 * `POST /flights`, not through the batch route — so the CSV path had
 * provenance while the mail path, which is how most bookings actually arrive,
 * had none. Reading the same confirmation twice made a second flight.
 *
 * A mail with SEVERAL flights does use the batch route, but arrives there with
 * no named source and is stored as `email_import`; the provenance check used
 * to look only for `imported_*` and let exactly those rows through.
 */
describe("flight import from a booking mail — provenance", () => {
  let cookie: string[];
  let userId: string;

  const clean = async (): Promise<void> => {
    await prisma.flightCompanion.deleteMany();
    await prisma.flight.deleteMany();
    await prisma.importBatch.deleteMany();
    await prisma.booking.deleteMany();
    await prisma.trip.deleteMany();
    await prisma.user.deleteMany();
  };

  beforeEach(async () => {
    await clean();
    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send({ username: "mail-provenance", password: "password123" })
      .expect(201);
    cookie = registration.headers["set-cookie"];
    userId = (await prisma.user.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  const flight = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    flightNumber: "LH400",
    departure: { iata: "FRA", lat: 50.0379, lon: 8.5622 },
    arrival: { iata: "JFK", lat: 40.6413, lon: -73.7781 },
    departureLocal: "2026-09-14T14:35",
    depTimezone: "Europe/Berlin",
    arrivalLocal: "2026-09-14T16:50",
    arrTimezone: "America/New_York",
    dataSource: "email_import",
    ...overrides,
  });

  const makeBatch = async (): Promise<string> =>
    (
      await prisma.importBatch.create({
        data: { userId, domain: "flight", source: "email", fileName: "LH-Bestätigung.eml" },
      })
    ).id;

  it("records provenance for a single flight read from a mail", async () => {
    const batchId = await makeBatch();

    await request(app)
      .post("/api/v1/flights")
      .set("Cookie", cookie)
      .send({ ...flight(), importBatchId: batchId })
      .expect(201);

    const created = await prisma.flight.findFirstOrThrow();
    expect(created.externalRef).toBe("import:LH400:2026-09-14:FRA-JFK");
    expect(created.importBatchId).toBe(batchId);
  });

  it("answers the same confirmation read twice with 409, not a second flight", async () => {
    const batchId = await makeBatch();
    await request(app)
      .post("/api/v1/flights")
      .set("Cookie", cookie)
      .send({ ...flight(), importBatchId: batchId })
      .expect(201);

    const again = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", cookie)
      .send({ ...flight(), importBatchId: batchId })
      .expect(409);

    expect(again.body.error).toBe("already_imported");
    expect(await prisma.flight.count()).toBe(1);
  });

  // The batch route defaults an unnamed source to `email_import`. Rows arriving
  // that way were slipping past the provenance check entirely.
  it("records provenance for a multi-flight mail, which names no source at all", async () => {
    const batchId = await makeBatch();

    const res = await request(app)
      .post(`/api/v1/flights/batch?batchId=${batchId}`)
      .set("Cookie", cookie)
      .send([
        { ...flight(), dataSource: undefined },
        {
          ...flight({
            flightNumber: "LH401",
            departure: { iata: "JFK", lat: 40.6413, lon: -73.7781 },
            arrival: { iata: "FRA", lat: 50.0379, lon: 8.5622 },
            departureLocal: "2026-09-21T18:00",
            depTimezone: "America/New_York",
            arrivalLocal: "2026-09-22T07:30",
            arrTimezone: "Europe/Berlin",
          }),
          dataSource: undefined,
        },
      ])
      .expect(201);

    expect(res.body.count).toBe(2);
    expect(await prisma.flight.count({ where: { externalRef: { not: null } } })).toBe(2);
    expect(await prisma.flight.count({ where: { importBatchId: batchId } })).toBe(2);

    // And the same mail forwarded a second time adds nothing.
    const again = await request(app)
      .post("/api/v1/flights/batch")
      .set("Cookie", cookie)
      .send([{ ...flight(), dataSource: undefined }])
      .expect(201);
    expect(again.body.skipped).toBe(1);
  });

  // A flight the user typed carries no source, so it records no provenance —
  // and two identical ones stay possible via the pre-existing `?force=true`
  // opt-out, which is the duplicate guard the FORM already had. Provenance
  // must not quietly become a second, unbypassable guard on manual entry.
  it("records nothing for a hand-entered flight, and can still be repeated", async () => {
    await request(app)
      .post("/api/v1/flights")
      .set("Cookie", cookie)
      .send(flight({ dataSource: "manual" }))
      .expect(201);
    await request(app)
      .post("/api/v1/flights?force=true")
      .set("Cookie", cookie)
      .send(flight({ dataSource: "manual" }))
      .expect(201);

    expect(await prisma.flight.count()).toBe(2);
    expect(await prisma.flight.count({ where: { externalRef: { not: null } } })).toBe(0);
  });

  // Looking a flight number up is a question the app asked, not a document it
  // was handed — giving it provenance would make two legitimate lookups clash.
  it("records nothing for a flight-number lookup", async () => {
    await request(app)
      .post("/api/v1/flights")
      .set("Cookie", cookie)
      .send(flight({ dataSource: "api_lookup" }))
      .expect(201);

    const created = await prisma.flight.findFirstOrThrow();
    expect(created.externalRef).toBeNull();
  });

  it("ignores a batch owned by another account but still creates the flight", async () => {
    const other = await prisma.user.create({ data: { username: "other", passwordHash: "x" } });
    const foreign = await prisma.importBatch.create({
      data: { userId: other.id, domain: "flight", source: "email" },
    });

    await request(app)
      .post("/api/v1/flights")
      .set("Cookie", cookie)
      .send({ ...flight(), importBatchId: foreign.id })
      .expect(201);

    const created = await prisma.flight.findFirstOrThrow({ where: { userId } });
    expect(created.importBatchId).toBeNull();
    // The provenance itself still applies — it describes the row, not the batch.
    expect(created.externalRef).not.toBeNull();
  });
});
