/**
 * "What did this import actually bring in?"
 *
 * The log could say "12 flights" and nothing more — the counts come from
 * `_count` aggregates, and no route ever listed the rows themselves. Reverting
 * an import was therefore a decision made blind: the only way to see what
 * would disappear was to undo it and look.
 *
 * The rows carry their batch under TWO different column names — `importBatchId`
 * on flights and cruises, `batchId` on lodgings and stays — so a route that
 * knows only one of them silently reports half an import as empty.
 */
import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

const OWNER = "importitemsowner";
const STRANGER = "importitemsstranger";

describe("GET /api/v1/import-batches/:id/items", () => {
  let ownerId: string;
  let ownerCookie: string;
  let strangerId: string;
  let strangerCookie: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: [OWNER, STRANGER] } } });
    const owner = await prisma.user.create({
      data: { username: OWNER, passwordHash: await hashPassword("password123") },
    });
    const stranger = await prisma.user.create({
      data: { username: STRANGER, passwordHash: await hashPassword("password123") },
    });
    ownerId = owner.id;
    strangerId = stranger.id;
    ownerCookie = `auth_token=${generateToken(owner.id)}`;
    strangerCookie = `auth_token=${generateToken(stranger.id)}`;
  });

  afterAll(async () => {
    await prisma.flight.deleteMany({ where: { userId: { in: [ownerId, strangerId] } } });
    await prisma.lodgingStay.deleteMany({ where: { userId: { in: [ownerId, strangerId] } } });
    await prisma.lodging.deleteMany({ where: { userId: { in: [ownerId, strangerId] } } });
    await prisma.importBatch.deleteMany({ where: { userId: { in: [ownerId, strangerId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, strangerId] } } });
  });

  beforeEach(async () => {
    await prisma.flight.deleteMany({ where: { userId: { in: [ownerId, strangerId] } } });
    await prisma.lodgingStay.deleteMany({ where: { userId: { in: [ownerId, strangerId] } } });
    await prisma.lodging.deleteMany({ where: { userId: { in: [ownerId, strangerId] } } });
    await prisma.importBatch.deleteMany({ where: { userId: { in: [ownerId, strangerId] } } });
  });

  async function makeBatch(userId: string, domain: string): Promise<string> {
    const b = await prisma.importBatch.create({
      data: { userId, domain, source: "csv", fileName: "list.csv" },
      select: { id: true },
    });
    return b.id;
  }

  async function addFlight(userId: string, batchId: string, number: string): Promise<void> {
    await prisma.flight.create({
      data: {
        userId,
        importBatchId: batchId,
        flightNumber: number,
        airline: "Lufthansa",
        depIata: "FRA",
        arrIata: "LHR",
        depLat: 50.0379,
        depLon: 8.5622,
        arrLat: 51.47,
        arrLon: -0.4543,
        departureTime: new Date("2024-05-01T08:00:00Z"),
        arrivalTime: new Date("2024-05-01T09:30:00Z"),
        status: "flown",
      },
    });
  }

  async function addLodgingWithStay(userId: string, batchId: string, name: string): Promise<void> {
    const lodging = await prisma.lodging.create({
      data: { userId, batchId, name, type: "hotel", city: "Berlin", country: "Deutschland" },
    });
    await prisma.lodgingStay.create({
      data: {
        userId,
        batchId,
        lodgingId: lodging.id,
        checkIn: new Date("2024-06-01"),
        checkOut: new Date("2024-06-03"),
        nights: 2,
        status: "completed",
        currency: "EUR",
      },
    });
  }

  it("lists the flights an import brought in", async () => {
    const batchId = await makeBatch(ownerId, "flight");
    await addFlight(ownerId, batchId, "LH100");
    await addFlight(ownerId, batchId, "LH200");

    const res = await request(app)
      .get(`/api/v1/import-batches/${batchId}/items`)
      .set("Cookie", ownerCookie)
      .expect(200);

    const flights = res.body.data.items.filter(
      (i: { kind: string }) => i.kind === "flight"
    );
    expect(flights).toHaveLength(2);
    expect(flights.map((f: { label: string }) => f.label).sort()).toEqual(["LH100", "LH200"]);
    expect(flights[0]).toHaveProperty("id");
  });

  it("finds lodgings and stays too, which hang off a differently named column", async () => {
    // `batchId` here, `importBatchId` on flights. A route that knows only one
    // reports half an import as empty.
    const batchId = await makeBatch(ownerId, "lodging");
    await addLodgingWithStay(ownerId, batchId, "Hotel Adlon");

    const res = await request(app)
      .get(`/api/v1/import-batches/${batchId}/items`)
      .set("Cookie", ownerCookie)
      .expect(200);

    const kinds = res.body.data.items.map((i: { kind: string }) => i.kind);
    expect(kinds).toContain("lodging");
    expect(kinds).toContain("stay");
    expect(
      res.body.data.items.find((i: { kind: string }) => i.kind === "lodging").label
    ).toBe("Hotel Adlon");
  });

  it("reports an empty import as empty rather than as an error", async () => {
    const batchId = await makeBatch(ownerId, "flight");

    const res = await request(app)
      .get(`/api/v1/import-batches/${batchId}/items`)
      .set("Cookie", ownerCookie)
      .expect(200);

    expect(res.body.data.items).toEqual([]);
    expect(res.body.data.total).toBe(0);
  });

  it("says how many there are in total, even when the list is capped", async () => {
    const batchId = await makeBatch(ownerId, "flight");
    await addFlight(ownerId, batchId, "LH1");

    const res = await request(app)
      .get(`/api/v1/import-batches/${batchId}/items`)
      .set("Cookie", ownerCookie)
      .expect(200);

    expect(res.body.data.total).toBe(1);
    expect(res.body.data.truncated).toBe(false);
  });

  it("does not hand another user's import over", async () => {
    const batchId = await makeBatch(ownerId, "flight");
    await addFlight(ownerId, batchId, "LH100");

    await request(app)
      .get(`/api/v1/import-batches/${batchId}/items`)
      .set("Cookie", strangerCookie)
      .expect(404);
  });

  it("refuses an anonymous caller", async () => {
    const batchId = await makeBatch(ownerId, "flight");
    await request(app).get(`/api/v1/import-batches/${batchId}/items`).expect(401);
  });

  it("rejects an id that is not a uuid instead of querying with it", async () => {
    await request(app)
      .get("/api/v1/import-batches/not-a-uuid/items")
      .set("Cookie", ownerCookie)
      .expect(400);
  });

  it("answers 404 for a batch that does not exist", async () => {
    await request(app)
      .get("/api/v1/import-batches/00000000-0000-4000-8000-000000000000/items")
      .set("Cookie", ownerCookie)
      .expect(404);
  });
});
