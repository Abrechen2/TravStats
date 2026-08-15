import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";

/**
 * One log for every import, and one way to take it back.
 *
 * The reversal differs per domain, and the difference is the point: deleting a
 * flight takes only that flight, while deleting a hotel would take every stay
 * hanging from it — including ones this import never created.
 */
describe("import batches — across domains", () => {
  let cookie: string[];
  let userId: string;

  const clean = async (): Promise<void> => {
    await prisma.flightCompanion.deleteMany();
    await prisma.flight.deleteMany();
    await prisma.lodgingStay.deleteMany();
    await prisma.lodging.deleteMany();
    await prisma.importBatch.deleteMany();
    await prisma.user.deleteMany();
  };

  beforeEach(async () => {
    await clean();
    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send({ username: "batch-log", password: "password123" })
      .expect(201);
    cookie = registration.headers["set-cookie"];
    userId = (await prisma.user.findFirstOrThrow()).id;
  });

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it("creates a batch and lists it with its counts", async () => {
    const created = await request(app)
      .post("/api/v1/import-batches")
      .set("Cookie", cookie)
      .send({ domain: "flight", source: "csv", fileName: "logbook.csv" })
      .expect(201);

    const batchId = created.body.data.id as string;
    await prisma.flight.create({
      data: {
        userId,
        importBatchId: batchId,
        flightNumber: "LH400",
        depIata: "FRA",
        arrIata: "JFK",
        depLat: 50.0379,
        depLon: 8.5622,
        arrLat: 40.6413,
        arrLon: -73.7781,
      },
    });

    const list = await request(app).get("/api/v1/import-batches").set("Cookie", cookie).expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({
      id: batchId,
      domain: "flight",
      source: "csv",
      fileName: "logbook.csv",
    });
    expect(list.body.data[0].counts.flights).toBe(1);
  });

  it("takes a flight import back", async () => {
    const created = await request(app)
      .post("/api/v1/import-batches")
      .set("Cookie", cookie)
      .send({ domain: "flight", source: "csv" })
      .expect(201);
    const batchId = created.body.data.id as string;

    await prisma.flight.create({
      data: {
        userId,
        importBatchId: batchId,
        flightNumber: "LH400",
        depIata: "FRA",
        arrIata: "JFK",
        depLat: 50.0379,
        depLon: 8.5622,
        arrLat: 40.6413,
        arrLon: -73.7781,
      },
    });
    // A flight the user entered by hand, in the same account, must survive.
    await prisma.flight.create({
      data: {
        userId,
        flightNumber: "LH999",
        depIata: "MUC",
        arrIata: "TXL",
        depLat: 48.3538,
        depLon: 11.7861,
        arrLat: 52.5597,
        arrLon: 13.2877,
      },
    });

    const revert = await request(app)
      .delete(`/api/v1/import-batches/${batchId}`)
      .set("Cookie", cookie)
      .expect(200);

    expect(revert.body.data).toMatchObject({ domain: "flight", deleted: 1 });
    const left = await prisma.flight.findMany({ select: { flightNumber: true } });
    expect(left.map((f) => f.flightNumber)).toEqual(["LH999"]);
    expect(await prisma.importBatch.count()).toBe(0);
  });

  // `batchId` comes from the client. Without the ownership check this is a
  // one-request way to delete somebody else's imported flights.
  it("refuses to revert a batch belonging to someone else", async () => {
    const other = await prisma.user.create({
      data: { username: "victim", passwordHash: "x" },
    });
    const theirBatch = await prisma.importBatch.create({
      data: { userId: other.id, domain: "flight", source: "csv" },
    });
    await prisma.flight.create({
      data: {
        userId: other.id,
        importBatchId: theirBatch.id,
        flightNumber: "OS123",
        depLat: 48.1103,
        depLon: 16.5697,
        arrLat: 50.0379,
        arrLon: 8.5622,
      },
    });

    await request(app)
      .delete(`/api/v1/import-batches/${theirBatch.id}`)
      .set("Cookie", cookie)
      .expect(404);

    expect(await prisma.flight.count({ where: { userId: other.id } })).toBe(1);
  });

  // The log is a per-account history, so it must never widen into a list of
  // everyone's imports — a leak that would be invisible on a single-user
  // instance and obvious on a shared one.
  it("lists only our own batches, never another account's", async () => {
    const mine = await request(app)
      .post("/api/v1/import-batches")
      .set("Cookie", cookie)
      .send({ domain: "flight", source: "csv", fileName: "mine.csv" })
      .expect(201);
    // Both batches need a row of their own: a batch that produced nothing is
    // not listed at all, which would make this pass for the wrong reason.
    await prisma.flight.create({
      data: {
        userId,
        importBatchId: mine.body.data.id as string,
        flightNumber: "LH400",
        depLat: 50.0379,
        depLon: 8.5622,
        arrLat: 40.6413,
        arrLon: -73.7781,
      },
    });

    const other = await prisma.user.create({
      data: { username: "stranger", passwordHash: "x" },
    });
    const theirs = await prisma.importBatch.create({
      data: { userId: other.id, domain: "lodging", source: "csv", fileName: "theirs.csv" },
    });
    await prisma.lodging.create({
      data: { userId: other.id, name: "Ihr Hotel", type: "hotel", batchId: theirs.id },
    });

    const list = await request(app).get("/api/v1/import-batches").set("Cookie", cookie).expect(200);

    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0].id).toBe(mine.body.data.id);
    expect(list.body.data.map((b: { fileName: string }) => b.fileName)).not.toContain("theirs.csv");
  });

  // A mail read a second time produces nothing, because every flight in it is
  // already here. Showing that as a run would invite the user to undo an
  // import that never happened.
  it("does not list a batch that produced nothing", async () => {
    await request(app)
      .post("/api/v1/import-batches")
      .set("Cookie", cookie)
      .send({ domain: "flight", source: "email", fileName: "schon-gelesen.eml" })
      .expect(201);

    const list = await request(app).get("/api/v1/import-batches").set("Cookie", cookie).expect(200);
    expect(list.body.data).toHaveLength(0);
  });

  it("rejects a domain it cannot revert", async () => {
    await request(app)
      .post("/api/v1/import-batches")
      .set("Cookie", cookie)
      .send({ domain: "trip", source: "csv" })
      .expect(400);
  });
});
