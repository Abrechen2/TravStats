import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";

/**
 * Importing the same logbook twice used to double every flight in it (#84).
 * The row now carries where it came from, and the second run recognises it.
 *
 * The interesting part is not that duplicates are dropped — it is WHICH rows
 * count as the same flight. A return leg shares its booking reference with the
 * outbound one, so a key built from the booking would refuse half of every
 * journey and call it a duplicate.
 */
describe("flight batch import — provenance", () => {
  let cookie: string[];

  const clean = async (): Promise<void> => {
    await prisma.flightCompanion.deleteMany();
    await prisma.flight.deleteMany();
    await prisma.importBatch.deleteMany();
    await prisma.user.deleteMany();
  };

  beforeEach(async () => {
    await clean();
    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send({ username: "batch-provenance", password: "password123" })
      .expect(201);
    cookie = registration.headers["set-cookie"];
  });

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  const outbound = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
    flightNumber: "LH400",
    departure: { iata: "FRA", lat: 50.0379, lon: 8.5622 },
    arrival: { iata: "JFK", lat: 40.6413, lon: -73.7781 },
    departureLocal: "2026-08-14T14:35",
    depTimezone: "Europe/Berlin",
    arrivalLocal: "2026-08-14T16:50",
    arrTimezone: "America/New_York",
    dataSource: "imported_fr24",
    ...overrides,
  });

  const inbound = (): Record<string, unknown> =>
    outbound({
      flightNumber: "LH401",
      departure: { iata: "JFK", lat: 40.6413, lon: -73.7781 },
      arrival: { iata: "FRA", lat: 50.0379, lon: 8.5622 },
      departureLocal: "2026-08-21T18:00",
      depTimezone: "America/New_York",
      arrivalLocal: "2026-08-22T07:30",
      arrTimezone: "Europe/Berlin",
    });

  const post = (body: unknown, batchId?: string) =>
    request(app)
      .post(`/api/v1/flights/batch${batchId ? `?batchId=${batchId}` : ""}`)
      .set("Cookie", cookie)
      .send(body);

  it("imports the same export twice without duplicating anything", async () => {
    const first = await post([outbound(), inbound()]).expect(201);
    expect(first.body.count).toBe(2);
    expect(first.body.skipped).toBe(0);

    const second = await post([outbound(), inbound()]).expect(201);
    expect(second.body.count).toBe(0);
    expect(second.body.skipped).toBe(2);

    expect(await prisma.flight.count()).toBe(2);
  });

  // The whole reason the key is not `booking:<PNR>`.
  it("keeps the return leg — it is not a duplicate of the outbound one", async () => {
    await post([outbound({ bookingReference: "ABC123" })]).expect(201);
    const back = await post([inbound()]).expect(201);
    expect(back.body.count).toBe(1);
    expect(await prisma.flight.count()).toBe(2);
  });

  // One export listing the same flight twice must not take its 19 innocent
  // neighbours down with it when the unique index fires.
  it("survives a file that repeats a flight inside one chunk", async () => {
    const res = await post([outbound(), outbound(), inbound()]).expect(201);
    expect(res.body.count).toBe(2);
    expect(res.body.skipped).toBe(1);
  });

  // A hand-typed flight has no source, so it records no provenance — and two
  // identical manual entries must stay possible.
  it("records no provenance for a manually entered flight", async () => {
    await post([outbound({ dataSource: "manual" })]).expect(201);
    await post([outbound({ dataSource: "manual" })]).expect(201);
    expect(await prisma.flight.count()).toBe(2);
    expect(await prisma.flight.count({ where: { externalRef: { not: null } } })).toBe(0);
  });

  it("stamps the batch on every row it creates", async () => {
    const user = await prisma.user.findFirstOrThrow();
    const batch = await prisma.importBatch.create({
      data: { userId: user.id, domain: "flight", source: "csv", fileName: "logbook.csv" },
    });

    await post([outbound(), inbound()], batch.id).expect(201);

    expect(await prisma.flight.count({ where: { importBatchId: batch.id } })).toBe(2);
  });

  // A batch id is client-supplied. Someone else's must not become a hook into
  // their undo history — and the import still has to go through, because the
  // rows the user asked for matter more than the bookkeeping.
  it("ignores a batch belonging to another user but still imports", async () => {
    const other = await prisma.user.create({
      data: { username: "someone-else", passwordHash: "x" },
    });
    const foreign = await prisma.importBatch.create({
      data: { userId: other.id, domain: "flight", source: "csv", fileName: "theirs.csv" },
    });

    const res = await post([outbound()], foreign.id).expect(201);

    expect(res.body.count).toBe(1);
    expect(await prisma.flight.count({ where: { importBatchId: foreign.id } })).toBe(0);
  });
});
