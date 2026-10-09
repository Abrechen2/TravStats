import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { acceptVisitFinding } from "../../services/photoJourneys/acceptVisit";
import { commitPlaceImport } from "../../services/places/placeImportCommit";
import { refToAdopt } from "../../services/places/placeNameBackfill";

/**
 * A merge keeps BOTH places' source references (forgejo#232, review I1).
 *
 * `Place.externalRef` is one column. A merge of an OSM pick and a Google
 * Takeout row kept one reference and dropped the other — and every dedup path
 * then missed the dropped one: picking that object from search again, a
 * Takeout re-import, a photo finding naming it. The losing reference now lives
 * on as an alias (`PlaceExternalRef`), and one lookup (`placeRefs.ts`) answers
 * "does this user already have a place for ref X?" over both.
 */
const USERS = ["placealias", "placealiasother"];
const OSM = "osm:way/27765404";
const GMAPS = "gmaps:123";

const ALL_TARGET = {
  name: "target",
  localName: "target",
  category: "target",
  position: "target",
  address: "target",
  notes: "target",
} as const;

describe("place reference aliases", () => {
  let cookie: string;
  let userId: string;
  let otherUserId: string;

  const cleanup = async (): Promise<void> => {
    const where = { user: { username: { in: USERS } } };
    await prisma.photoJourney.deleteMany({ where });
    await prisma.placeVisit.deleteMany({ where });
    await prisma.place.deleteMany({ where });
    await prisma.importBatch.deleteMany({ where });
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
  });

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    const where = { userId: { in: [userId, otherUserId] } };
    await prisma.photoJourney.deleteMany({ where });
    await prisma.placeVisit.deleteMany({ where });
    await prisma.place.deleteMany({ where });
    await prisma.importBatch.deleteMany({ where });
  });

  /** Kolosseum picked from search (OSM), Colosseo imported from Takeout. */
  async function mergedPair(keepPosition: "target" | "source" = "target") {
    const kept = await prisma.place.create({
      data: { userId, name: "Kolosseum", lat: 41.8902, lon: 12.4922, externalRef: OSM },
    });
    const gone = await prisma.place.create({
      data: { userId, name: "Colosseo", lat: 41.8903, lon: 12.4923, externalRef: GMAPS },
    });
    const res = await request(app)
      .post(`/api/v1/places/${kept.id}/merge`)
      .set("Cookie", cookie)
      .send({ sourceId: gone.id, fields: { ...ALL_TARGET, position: keepPosition } });
    expect(res.status).toBe(200);
    return { kept, gone };
  }

  it("keeps the folded place's reference as an alias of the place that stays", async () => {
    const { kept } = await mergedPair();
    const row = await prisma.place.findUniqueOrThrow({ where: { id: kept.id } });
    expect(row.externalRef).toBe(OSM);
    const aliases = await prisma.placeExternalRef.findMany({ where: { placeId: kept.id } });
    expect(aliases.map((a) => a.ref)).toEqual([GMAPS]);
  });

  it("keeps the kept place's OWN reference as an alias when the position came from the other", async () => {
    const { kept } = await mergedPair("source");
    const row = await prisma.place.findUniqueOrThrow({ where: { id: kept.id } });
    expect(row.externalRef).toBe(GMAPS);
    const aliases = await prisma.placeExternalRef.findMany({ where: { placeId: kept.id } });
    expect(aliases.map((a) => a.ref)).toEqual([OSM]);
  });

  it("(a) a search pick of the folded object answers the kept place instead of a new one", async () => {
    const { kept } = await mergedPair();
    const res = await request(app)
      .post("/api/v1/places")
      .set("Cookie", cookie)
      .send({ name: "Colosseo", category: "landmark", lat: 41.89, lon: 12.49, externalRef: GMAPS });
    expect(res.status).toBe(200);
    expect(res.body.deduped).toBe(true);
    expect(res.body.data.id).toBe(kept.id);
    expect(await prisma.place.count({ where: { userId } })).toBe(1);
  });

  it("(b) an import preview of the folded reference skips it as already here", async () => {
    const { kept } = await mergedPair();
    const res = await request(app)
      .post("/api/v1/place-import/preview")
      .set("Cookie", cookie)
      .send({
        candidates: [
          { sourceRowIndex: 0, name: "Colosseo", lat: 41.89, lon: 12.49, externalRef: GMAPS },
        ],
      });
    expect(res.status).toBe(200);
    const row = (res.body.data?.rows ?? res.body.rows)[0];
    expect(row).toMatchObject({ action: "skip", matchedPlaceId: kept.id });
  });

  it("an import commit of the folded reference skips it instead of creating", async () => {
    await mergedPair();
    const result = await commitPlaceImport(userId, "csv", null, [
      { sourceRowIndex: 0, name: "Colosseo", lat: 41.89, lon: 12.49, externalRef: GMAPS },
    ]);
    expect(result).toMatchObject({ created: 0, skipped: 1 });
    expect(await prisma.place.count({ where: { userId } })).toBe(1);
  });

  it("(c) accepting a photo finding that names the folded object records the visit on the kept place", async () => {
    const { kept } = await mergedPair();
    const journey = await prisma.photoJourney.create({
      data: {
        userId,
        kind: "visit",
        startDate: new Date("2025-04-02T10:00:00Z"),
        endDate: new Date("2025-04-02T11:00:00Z"),
        photoCount: 3,
        locatedCount: 3,
        lat: 41.89,
        lon: 12.49,
        previewAssetIds: [],
        fingerprint: `alias-test-${kept.id}`,
        suggestedName: "Colosseo",
        suggestedRef: GMAPS,
      },
    });
    const outcome = await acceptVisitFinding(userId, journey.id, {});
    expect(outcome).toMatchObject({ placeId: kept.id, placeCreated: false });
    expect(await prisma.place.count({ where: { userId } })).toBe(1);
  });

  it("the names backfill does not hand an alias to a third place", async () => {
    await mergedPair();
    const placeholder = await prisma.place.create({
      data: { userId, name: "Neu", lat: 1, lon: 1, externalRef: "companion:abc@41.89,12.49" },
    });
    const adopted = await refToAdopt(placeholder, GMAPS, new Set());
    expect(adopted).toEqual({ ref: "companion:abc@41.89,12.49", collision: true });
  });

  it("an edit that would write another place's alias as its own reference is refused", async () => {
    await mergedPair();
    const third = await prisma.place.create({ data: { userId, name: "Dritter", lat: 1, lon: 1 } });
    const res = await request(app)
      .patch(`/api/v1/places/${third.id}`)
      .set("Cookie", cookie)
      .send({ externalRef: GMAPS });
    expect(res.status).toBe(409);
    expect((await prisma.place.findUniqueOrThrow({ where: { id: third.id } })).externalRef).toBe(
      null
    );
  });

  it("a chain of merges keeps every reference, and a delete takes the aliases with it", async () => {
    const { kept } = await mergedPair();
    const third = await prisma.place.create({
      data: {
        userId,
        name: "Amphitheatrum Flavium",
        lat: 41.8902,
        lon: 12.4922,
        externalRef: "wd:Q10285",
      },
    });
    // Fold the kept place (with its alias) into a third one.
    const res = await request(app)
      .post(`/api/v1/places/${third.id}/merge`)
      .set("Cookie", cookie)
      .send({ sourceId: kept.id, fields: ALL_TARGET });
    expect(res.status).toBe(200);
    const aliases = await prisma.placeExternalRef.findMany({ where: { placeId: third.id } });
    expect(aliases.map((a) => a.ref).sort()).toEqual([GMAPS, OSM].sort());

    await request(app).delete(`/api/v1/places/${third.id}`).set("Cookie", cookie);
    expect(await prisma.placeExternalRef.count({ where: { userId } })).toBe(0);
  });

  it("an alias is per user: another account's pick of the same object creates its own place", async () => {
    await mergedPair();
    const res = await request(app)
      .post("/api/v1/places")
      .set("Cookie", `auth_token=${generateToken(otherUserId)}`)
      .send({ name: "Colosseo", category: "landmark", lat: 41.89, lon: 12.49, externalRef: GMAPS });
    expect(res.status).toBe(201);
  });
});
