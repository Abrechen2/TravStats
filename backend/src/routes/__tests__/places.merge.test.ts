import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

/**
 * `POST /places/:id/merge` (forgejo#232): two of the user's own places become
 * one, with the master data the user picked, and NOTHING hanging off either is
 * lost — every visit with its photos and documents, every list membership,
 * the roadtrip stations and photo findings that named the duplicate. In one
 * transaction: a failure half-way leaves both places exactly as they were.
 */
const USERS = ["placemerge", "placemergeother"];
const FAIL_NAME = "__merge_test_refuses_delete__";

const ALL_TARGET = {
  name: "target",
  localName: "target",
  category: "target",
  position: "target",
  address: "target",
  notes: "target",
} as const;

describe("POST /places/:id/merge", () => {
  let cookie: string;
  let userId: string;
  let otherUserId: string;

  const cleanup = async (): Promise<void> => {
    const where = { user: { username: { in: USERS } } };
    await prisma.document.deleteMany({ where });
    await prisma.photoJourney.deleteMany({ where });
    await prisma.placeList.deleteMany({ where });
    await prisma.placeVisit.deleteMany({ where });
    // The refusing trigger matches on the name; rename before cleaning up.
    await prisma.place.updateMany({ where: { ...where, name: FAIL_NAME }, data: { name: "x" } });
    await prisma.place.deleteMany({ where });
    await prisma.trip.deleteMany({ where });
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
  };

  beforeAll(async () => {
    await cleanup();
    const u = await prisma.user.create({
      data: { username: USERS[0], passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    otherUserId = (
      await prisma.user.create({
        data: { username: USERS[1], passwordHash: await hashPassword("password123") },
      })
    ).id;
    // A refusal the database itself raises at the LAST step of the merge —
    // deleting the duplicate — so every move before it must be rolled back.
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION merge_test_refuse() RETURNS trigger AS $$
      BEGIN RAISE EXCEPTION 'merge test: delete refused'; END $$ LANGUAGE plpgsql`);
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS merge_test_refuse ON places`);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER merge_test_refuse BEFORE DELETE ON places FOR EACH ROW
      WHEN (OLD.name = '${FAIL_NAME}') EXECUTE FUNCTION merge_test_refuse()`);
  });

  afterAll(async () => {
    await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS merge_test_refuse ON places`);
    await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS merge_test_refuse()`);
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const where = { userId: { in: [userId, otherUserId] } };
    await prisma.document.deleteMany({ where });
    await prisma.photoJourney.deleteMany({ where });
    await prisma.placeList.deleteMany({ where });
    await prisma.placeVisit.deleteMany({ where });
    await prisma.place.updateMany({ where: { ...where, name: FAIL_NAME }, data: { name: "x" } });
    await prisma.place.deleteMany({ where });
    await prisma.trip.deleteMany({ where });
  });

  const merge = (targetId: string, body: Record<string, unknown>) =>
    request(app).post(`/api/v1/places/${targetId}/merge`).set("Cookie", cookie).send(body);

  /** Two Colosseums, as a hand-entered place and an import leave them. */
  async function twoColosseums(sourceName = "Colosseum") {
    const trip = await prisma.trip.create({ data: { userId, name: "Rom 2025" } });
    const target = await prisma.place.create({
      data: {
        userId,
        name: "Kolosseum",
        category: "landmark",
        lat: 41.89,
        lon: 12.49,
        city: "Rom",
        country: "Italien",
        isoCountryCode: "IT",
        notes: "Abends beleuchtet",
        visited: false,
      },
    });
    const source = await prisma.place.create({
      data: {
        userId,
        name: sourceName,
        localName: "Colosseo",
        category: "other",
        lat: 41.8902,
        lon: 12.4922,
        externalRef: "osm:way/27765404",
        city: "Roma",
        country: "Italy",
        isoCountryCode: "IT",
        notes: "Ticket online",
        visited: true,
      },
    });
    const targetVisit = await prisma.placeVisit.create({
      data: { userId, placeId: target.id, visitedAt: new Date("2019-05-01") },
    });
    const sourceVisit = await prisma.placeVisit.create({
      data: { userId, placeId: source.id, tripId: trip.id, visitedAt: new Date("2025-04-02") },
    });
    const undated = await prisma.placeVisit.create({
      data: { userId, placeId: source.id, visitedAt: null },
    });
    await prisma.placeVisitPhoto.create({
      data: {
        placeVisitId: sourceVisit.id,
        filename: "a.jpg",
        mimetype: "image/jpeg",
        sizeBytes: 1,
      },
    });
    await prisma.document.create({
      data: {
        userId,
        storedName: "ticket.pdf",
        mimetype: "application/pdf",
        sizeBytes: 1,
        sha256: "x",
        format: "pdf",
        placeVisitId: sourceVisit.id,
      },
    });
    const shared = await prisma.placeList.create({ data: { userId, name: "Rom" } });
    const onlySource = await prisma.placeList.create({ data: { userId, name: "Antike" } });
    await prisma.placeListEntry.create({ data: { listId: shared.id, placeId: target.id } });
    await prisma.placeListEntry.create({ data: { listId: shared.id, placeId: source.id } });
    await prisma.placeListEntry.create({
      data: { listId: onlySource.id, placeId: source.id, sortIdx: 3 },
    });
    const stop = await prisma.tripStop.create({
      data: { tripId: trip.id, title: "Colosseum", placeId: source.id },
    });
    const journey = await prisma.photoJourney.create({
      data: {
        userId,
        startDate: new Date("2025-04-02"),
        endDate: new Date("2025-04-02"),
        photoCount: 3,
        locatedCount: 3,
        lat: 41.89,
        lon: 12.49,
        previewAssetIds: [],
        fingerprint: `merge-test-${source.id}`,
        kind: "place",
        placeId: source.id,
      },
    });
    return {
      trip,
      target,
      source,
      targetVisit,
      sourceVisit,
      undated,
      shared,
      onlySource,
      stop,
      journey,
    };
  }

  it("keeps every visit, photo, document and list membership on the place that stays", async () => {
    const f = await twoColosseums();
    const res = await merge(f.target.id, { sourceId: f.source.id, fields: ALL_TARGET });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.id).toBe(f.target.id);

    expect(await prisma.place.findUnique({ where: { id: f.source.id } })).toBeNull();
    const visits = await prisma.placeVisit.findMany({ where: { placeId: f.target.id } });
    expect(visits.map((v) => v.id).sort()).toEqual(
      [f.targetVisit.id, f.sourceVisit.id, f.undated.id].sort()
    );
    // Photos and documents hang off the visit, and came along with it.
    expect(await prisma.placeVisitPhoto.count({ where: { visit: { placeId: f.target.id } } })).toBe(
      1
    );
    expect(await prisma.document.count({ where: { placeVisit: { placeId: f.target.id } } })).toBe(
      1
    );
    // The visit keeps its trip.
    expect(visits.find((v) => v.id === f.sourceVisit.id)?.tripId).toBe(f.trip.id);

    const entries = await prisma.placeListEntry.findMany({ where: { placeId: f.target.id } });
    // One entry per list: the shared list keeps the one it had, the other moves.
    expect(entries.map((e) => e.listId).sort()).toEqual([f.shared.id, f.onlySource.id].sort());
    expect(entries.find((e) => e.listId === f.onlySource.id)?.sortIdx).toBe(3);

    expect((await prisma.tripStop.findUnique({ where: { id: f.stop.id } }))?.placeId).toBe(
      f.target.id
    );
    expect((await prisma.photoJourney.findUnique({ where: { id: f.journey.id } }))?.placeId).toBe(
      f.target.id
    );
  });

  it("takes each master-data group from the side the user picked", async () => {
    const f = await twoColosseums();
    const res = await merge(f.target.id, {
      sourceId: f.source.id,
      fields: {
        name: "target",
        localName: "source",
        category: "target",
        position: "source",
        address: "source",
        notes: "both",
      },
    });
    expect(res.status).toBe(200);
    const kept = await prisma.place.findUniqueOrThrow({ where: { id: f.target.id } });
    expect(kept).toMatchObject({
      name: "Kolosseum",
      localName: "Colosseo",
      category: "landmark",
      lat: 41.8902,
      lon: 12.4922,
      // The OSM identity follows the position it names.
      externalRef: "osm:way/27765404",
      city: "Roma",
      country: "Italy",
      isoCountryCode: "IT",
      notes: "Abends beleuchtet\n\nTicket online",
      // Not a choice: one of the two had been visited.
      visited: true,
    });
    expect(res.body.data).toMatchObject({ name: "Kolosseum", visitCount: 3 });
  });

  it("keeps the duplicate's identity when the place that stays has none, whichever position wins", async () => {
    const f = await twoColosseums();
    await merge(f.target.id, { sourceId: f.source.id, fields: ALL_TARGET });
    const kept = await prisma.place.findUniqueOrThrow({ where: { id: f.target.id } });
    expect(kept.externalRef).toBe("osm:way/27765404");
    expect(kept.lat).toBe(41.89);
  });

  it("changes nothing when a step fails half-way — one transaction", async () => {
    const f = await twoColosseums(FAIL_NAME);
    const before = {
      target: await prisma.place.findUniqueOrThrow({ where: { id: f.target.id } }),
      source: await prisma.place.findUniqueOrThrow({ where: { id: f.source.id } }),
    };

    const res = await merge(f.target.id, {
      sourceId: f.source.id,
      fields: { ...ALL_TARGET, name: "source", position: "source" },
    });
    expect(res.status).toBeGreaterThanOrEqual(500);

    expect(await prisma.place.findUniqueOrThrow({ where: { id: f.target.id } })).toEqual(
      before.target
    );
    // The duplicate is still there, with its identity and everything on it.
    expect(await prisma.place.findUniqueOrThrow({ where: { id: f.source.id } })).toEqual(
      before.source
    );
    expect(await prisma.placeVisit.count({ where: { placeId: f.source.id } })).toBe(2);
    expect(await prisma.placeVisit.count({ where: { placeId: f.target.id } })).toBe(1);
    expect(await prisma.placeListEntry.count({ where: { placeId: f.source.id } })).toBe(2);
    expect((await prisma.tripStop.findUnique({ where: { id: f.stop.id } }))?.placeId).toBe(
      f.source.id
    );
    expect((await prisma.photoJourney.findUnique({ where: { id: f.journey.id } }))?.placeId).toBe(
      f.source.id
    );
  });

  it("refuses another account's place with 404 and touches neither", async () => {
    const mine = await prisma.place.create({ data: { userId, name: "Mein", lat: 1, lon: 1 } });
    const theirs = await prisma.place.create({
      data: { userId: otherUserId, name: "Fremd", lat: 1, lon: 1 },
    });
    await prisma.placeVisit.create({ data: { userId: otherUserId, placeId: theirs.id } });

    const asSource = await merge(mine.id, { sourceId: theirs.id, fields: ALL_TARGET });
    expect(asSource.status).toBe(404);
    const asTarget = await merge(theirs.id, { sourceId: mine.id, fields: ALL_TARGET });
    expect(asTarget.status).toBe(404);

    expect(await prisma.place.count({ where: { id: { in: [mine.id, theirs.id] } } })).toBe(2);
    expect(await prisma.placeVisit.count({ where: { placeId: theirs.id } })).toBe(1);
  });

  it("refuses a place merged into itself", async () => {
    const one = await prisma.place.create({ data: { userId, name: "Eins", lat: 1, lon: 1 } });
    const res = await merge(one.id, { sourceId: one.id, fields: ALL_TARGET });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("PLACE_MERGE_SAME");
  });

  it("refuses two different checklist items — one checklist's tick would be lost", async () => {
    // `curatedItemId` carries no foreign key; any two distinct ids stand for
    // two checklist items.
    const a = await prisma.place.create({
      data: { userId, name: "A", lat: 1, lon: 1, curatedItemId: "merge-test-item-a" },
    });
    const b = await prisma.place.create({
      data: { userId, name: "B", lat: 1, lon: 1, curatedItemId: "merge-test-item-b" },
    });
    const res = await merge(a.id, { sourceId: b.id, fields: ALL_TARGET });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("PLACE_MERGE_BOTH_CURATED");
    expect(await prisma.place.count({ where: { id: { in: [a.id, b.id] } } })).toBe(2);
  });

  it("asks for every group explicitly — nothing is chosen for the user", async () => {
    const f = await twoColosseums();
    const res = await merge(f.target.id, {
      sourceId: f.source.id,
      fields: { name: "target" },
    });
    expect(res.status).toBe(400);
    expect(await prisma.place.count({ where: { id: { in: [f.target.id, f.source.id] } } })).toBe(2);
  });

  it("requires a session", async () => {
    const res = await request(app)
      .post("/api/v1/places/00000000-0000-0000-0000-000000000000/merge")
      .send({});
    expect(res.status).toBe(401);
  });
});
