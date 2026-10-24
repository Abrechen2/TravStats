import { prisma } from "../../../db";
import { distanceM, inPrivacyZone } from "../classify";
import { ingestTravTrackPoints } from "../ingest";
import { registerPointsRemovedHandler, type PointsRemovedCause } from "../deleteRange";
import { createZone, deleteZone, listZones, LOCATION_ZONE_MAX, updateZone } from "../zones";
import { makeTrip, makeUser, wipeTravTrack } from "./fixtures";

/**
 * Privacy zones (TravTrack plan T2, ported from the archived
 * `/location/zones` suite to service level): inside one the user is never
 * tracked. A new, moved or grown zone deletes the stored points inside it —
 * with their links — once the user has seen the count and agreed, and it
 * always tells the `onPointsRemoved` hook, even when it deleted nothing: a
 * zone over no stored point can still lie under a chord of a shared route.
 */

const PREFIX = "travtrack-zones-";

// Seoul City Hall and points around it.
const HOME = { lat: 37.5665, lon: 126.978 };
const AT_200M = { lat: 37.5683, lon: 126.978 };
const AT_2KM = { lat: 37.5845, lon: 126.978 };

describe("TravTrack privacy zones", () => {
  let userId: string;
  let otherId: string;
  const causes: PointsRemovedCause[] = [];
  let unregister: () => void;

  const upload = (
    uploadId: string,
    points: { id: string; lat: number; lon: number; entries?: object[] }[],
    user = userId
  ) =>
    ingestTravTrackPoints({
      userId: user,
      deviceId: "phone-1",
      uploadId,
      points: points.map((p, i) => ({
        ...p,
        t: `2026-10-12T01:00:${String(i).padStart(2, "0")}Z`,
      })),
    });

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    otherId = await makeUser(`${PREFIX}b`);
    unregister = registerPointsRemovedHandler(async (_tx, uid, cause) => {
      if (uid === userId) causes.push(cause);
    });
  });

  beforeEach(async () => {
    causes.length = 0;
    await wipeTravTrack([userId, otherId]);
    await prisma.trip.deleteMany({ where: { userId } });
  });

  afterAll(async () => {
    unregister();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("measures distance and the zone edge the same way as the SQL", () => {
    expect(distanceM(HOME, AT_200M)).toBeGreaterThan(195);
    expect(distanceM(HOME, AT_200M)).toBeLessThan(205);
    expect(inPrivacyZone(AT_200M, [{ ...HOME, radiusM: 250 }])).toBe(true);
    expect(inPrivacyZone(AT_200M, [{ ...HOME, radiusM: 150 }])).toBe(false);
    expect(
      inPrivacyZone({ lat: 0, lon: -179.9995 }, [{ lat: 0, lon: 179.9995, radiusM: 150 }])
    ).toBe(true);
  });

  it("drops a point inside a zone on ingest and stores the rest", async () => {
    await createZone(userId, { name: "Zuhause", ...HOME, radiusM: 250 }, false);
    const { result } = await upload("u1", [
      { id: "home", ...HOME },
      { id: "near", ...AT_200M },
      { id: "far", ...AT_2KM },
    ]);
    expect(result.outcomes.map((o) => ("reason" in o ? o.reason : o.outcome))).toEqual([
      "privacy_zone",
      "privacy_zone",
      "stored",
    ]);
  });

  it("asks before a new zone deletes stored points, and deletes them once confirmed", async () => {
    const tripId = await makeTrip(userId);
    await upload("u1", [
      { id: "home", ...HOME, entries: [{ kind: "trip", id: tripId }] },
      { id: "near", ...AT_200M },
      { id: "far", ...AT_2KM },
    ]);

    await expect(
      createZone(userId, { name: "Zuhause", ...HOME, radiusM: 250 }, false)
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "LOCATION_ZONE_HOLDS_POINTS",
      extra: { pointsInside: 2 },
    });
    expect(await prisma.travTrackPrivacyZone.count({ where: { userId } })).toBe(0);
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(3);

    const done = await createZone(userId, { name: "Zuhause", ...HOME, radiusM: 250 }, true);
    expect(done.deleted).toBe(2);
    expect(done.zone).toMatchObject({ name: "Zuhause", radiusM: 250 });
    const left = await prisma.travTrackPoint.findMany({
      where: { userId },
      select: { originRef: true },
    });
    expect(left.map((p) => p.originRef)).toEqual(["far"]);
    // The deleted point's link went with it.
    expect(await prisma.travTrackPointLink.count({ where: { userId } })).toBe(0);
  });

  it("finds stored points inside a zone that straddles the antimeridian", async () => {
    await upload("u1", [{ id: "east", lat: 0, lon: -179.9995 }]);
    await expect(
      createZone(userId, { name: "Fidschi", lat: 0, lon: 179.9995, radiusM: 150 }, false)
    ).rejects.toMatchObject({ extra: { pointsInside: 1 } });
  });

  it("never lets the bounding box cut off a point the distance keeps", async () => {
    await upload("u1", [
      { id: "north", lat: 37.044939038575315, lon: 10 },
      { id: "polar", lat: 89.99, lon: 150 },
    ]);
    await expect(
      createZone(userId, { name: "n", lat: 37, lon: 10, radiusM: 5000 }, false)
    ).rejects.toMatchObject({ extra: { pointsInside: 1 } });
    await expect(
      createZone(userId, { name: "p", lat: 89.97, lon: 0, radiusM: 5000 }, false)
    ).rejects.toMatchObject({ extra: { pointsInside: 1 } });
  });

  it("asks again when a zone grows over stored points", async () => {
    await upload("u1", [{ id: "far", ...AT_2KM }]);
    const { zone } = await createZone(userId, { name: "Zuhause", ...HOME, radiusM: 250 }, false);

    expect((await updateZone(userId, zone.id, { name: "Daheim" }, false)).deleted).toBe(0);
    await expect(updateZone(userId, zone.id, { radiusM: 5000 }, false)).rejects.toMatchObject({
      code: "LOCATION_ZONE_HOLDS_POINTS",
      extra: { pointsInside: 1 },
    });
    const confirmed = await updateZone(userId, zone.id, { radiusM: 5000 }, true);
    expect(confirmed).toMatchObject({ deleted: 1, zone: { name: "Daheim", radiusM: 5000 } });
  });

  it("refuses more zones than the limit, and a zone of another account", async () => {
    await prisma.travTrackPrivacyZone.createMany({
      data: Array.from({ length: LOCATION_ZONE_MAX }, (_, i) => ({
        userId,
        name: `z${i}`,
        lat: -40 + i,
        lon: 10,
        radiusM: 100,
      })),
    });
    await expect(
      createZone(userId, { name: "one more", ...HOME, radiusM: 100 }, false)
    ).rejects.toMatchObject({ statusCode: 409, code: "LOCATION_ZONE_LIMIT" });

    const [mine] = await listZones(userId);
    await expect(deleteZone(otherId, mine.id)).rejects.toMatchObject({
      statusCode: 404,
      code: "LOCATION_ZONE_NOT_FOUND",
    });
    await expect(updateZone(otherId, mine.id, { name: "x" }, false)).rejects.toMatchObject({
      statusCode: 404,
    });
    await deleteZone(userId, mine.id);
    expect(await prisma.travTrackPrivacyZone.count({ where: { userId } })).toBe(
      LOCATION_ZONE_MAX - 1
    );
  });

  describe("what a zone protected stays protected after it goes (Codex P2)", () => {
    const at = (iso: string, id: string, where = HOME) => ({ id, t: iso, ...where });
    const send = (uploadId: string, points: object[]) =>
      ingestTravTrackPoints({ userId, deviceId: "phone-1", uploadId, points: points as never });

    it("an old fix re-sent after its zone is removed stays dropped; a new fix there is stored", async () => {
      await send("before", [at("2026-10-12T01:00:00Z", "old")]);
      const { zone } = await createZone(userId, { name: "Zuhause", ...HOME, radiusM: 250 }, true);
      await deleteZone(userId, zone.id);

      const again = await send("resent", [at("2026-10-12T01:00:00Z", "old")]);
      expect(again.result.outcomes).toEqual([
        { index: 0, id: "old", outcome: "dropped", reason: "privacy_zone" },
      ]);
      const fresh = await send("after", [at(new Date().toISOString(), "new")]);
      expect(fresh.result.outcomes).toEqual([{ index: 0, id: "new", outcome: "stored" }]);
    });

    it("moving or shrinking a zone keeps its old circle's fixes dropped", async () => {
      await send("before", [at("2026-10-12T01:00:00Z", "old", AT_200M)]);
      const { zone } = await createZone(userId, { name: "Zuhause", ...HOME, radiusM: 250 }, true);
      await updateZone(userId, zone.id, { radiusM: 100 }, false);

      const again = await send("resent", [at("2026-10-12T01:00:00Z", "old", AT_200M)]);
      expect(again.result.outcomes[0]).toMatchObject({
        outcome: "dropped",
        reason: "privacy_zone",
      });
      const fresh = await send("after", [at(new Date().toISOString(), "new", AT_200M)]);
      expect(fresh.result.outcomes[0]).toMatchObject({ outcome: "stored" });
    });

    it("a zone that is only renamed leaves no tombstone", async () => {
      const { zone } = await createZone(userId, { name: "Zuhause", ...HOME, radiusM: 250 }, false);
      await updateZone(userId, zone.id, { name: "Daheim" }, false);
      expect(await prisma.travTrackZoneTombstone.count({ where: { userId } })).toBe(0);
    });
  });

  it("a zone create and a zone update call onPointsRemoved even when they delete nothing", async () => {
    const { zone, deleted } = await createZone(
      userId,
      { name: "Leer", lat: 10, lon: 10, radiusM: 100 },
      false
    );
    expect(deleted).toBe(0);
    await updateZone(userId, zone.id, { radiusM: 300 }, false);
    expect(causes).toEqual([
      { kind: "zone", zone: { lat: 10, lon: 10, radiusM: 100 } },
      { kind: "zone", zone: { lat: 10, lon: 10, radiusM: 300 } },
    ]);
  });
});
