import { prisma } from "../../../db";
import { mergeTrips } from "../../tripCleanupService";
import { ingestTravTrackPoints } from "../ingest";
import { deleteTravTrackRange } from "../deleteRange";
import { makeFlight, makeTrip, makeUser, pt, wipeTravTrack } from "./fixtures";

/**
 * Storing positions (TravTrack plan T2, ported from the archived
 * `/location/points` suite to service level): every point gets an outcome, a
 * retry is answered from the receipt, a deleted span stays deleted, and a fix
 * belongs to every flight and trip it was handed over for — one point, many
 * links (review focus 8).
 */

const PREFIX = "travtrack-ingest-";

describe("TravTrack ingest", () => {
  let userId: string;
  let otherId: string;

  const ingest = (
    uploadId: string,
    points: Record<string, unknown>[],
    opts: { deviceId?: string; gaps?: Record<string, unknown>[]; user?: string } = {}
  ) =>
    ingestTravTrackPoints({
      userId: opts.user ?? userId,
      deviceId: opts.deviceId ?? "phone-1",
      uploadId,
      points,
      gaps: opts.gaps,
    });

  const linksOf = async (pointRef: string) =>
    (
      await prisma.travTrackPointLink.findMany({
        where: { userId, point: { originRef: pointRef } },
        select: { entryKind: true, entryId: true },
        orderBy: { entryKind: "asc" },
      })
    ).map((l) => `${l.entryKind}:${l.entryId}`);

  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
    otherId = await makeUser(`${PREFIX}b`);
  });

  beforeEach(async () => {
    await wipeTravTrack([userId, otherId]);
    await prisma.trip.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.flight.deleteMany({ where: { userId: { in: [userId, otherId] } } });
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("stores every point and names each outcome", async () => {
    const { result, replayed } = await ingest("u1", [
      pt("a", "2026-10-12T01:00:00Z"),
      pt("b", "2026-10-12T01:00:30+09:00", 37.57, 126.98, {
        altitude: 38,
        speed: 1.2,
        course: 90,
        motion: "walking",
        purpose: "trip",
      }),
    ]);
    expect(replayed).toBe(false);
    expect(result).toMatchObject({
      uploadId: "u1",
      stored: 2,
      duplicate: 0,
      dropped: 0,
      linked: 0,
      unlinked: 0,
    });
    expect(result.outcomes).toEqual([
      { index: 0, id: "a", outcome: "stored" },
      { index: 1, id: "b", outcome: "stored" },
    ]);
    const rows = await prisma.travTrackPoint.findMany({ where: { userId }, orderBy: { t: "asc" } });
    expect(rows.map((r) => [r.originRef, r.origin, r.deviceId, r.tS, r.purpose])).toEqual([
      ["b", "companion:phone-1", "phone-1", Date.parse("2026-10-11T16:00:30Z") / 1000, "trip"],
      ["a", "companion:phone-1", "phone-1", Date.parse("2026-10-12T01:00:00Z") / 1000, "everyday"],
    ]);
    expect(rows[0]).toMatchObject({ altitudeM: 38, speedMps: 1.2, course: 90, motion: "walking" });
  });

  it("gives a bad point its own outcome instead of failing the batch", async () => {
    const { result } = await ingest("u-bad", [
      pt("ok", "2026-10-12T01:00:00Z"),
      pt("lat", "2026-10-12T01:01:00Z", 91, 0),
      { id: "no-time", lat: 1, lon: 1 },
      pt("zone-less", "2026-10-12T01:02:00"),
      pt("island", "2026-10-12T01:03:00Z", 0, 0),
      pt("motion", "2026-10-12T01:04:00Z", 1, 1, { motion: "teleporting" }),
      { t: "2026-10-12T01:05:00Z", lat: 1, lon: 1 },
      pt("purpose", "2026-10-12T01:06:00Z", 1, 1, { purpose: "walk" }),
      pt("entries", "2026-10-12T01:07:00Z", 1, 1, { entries: [{ kind: "cruise", id: "c" }] }),
      pt("nul\u0000id", "2026-10-12T01:08:00Z"),
    ]);
    expect(result.outcomes).toEqual([
      { index: 0, id: "ok", outcome: "stored" },
      { index: 1, id: "lat", outcome: "dropped", reason: "invalid" },
      { index: 2, id: "no-time", outcome: "dropped", reason: "invalid" },
      { index: 3, id: "zone-less", outcome: "dropped", reason: "invalid" },
      { index: 4, id: "island", outcome: "dropped", reason: "null_island" },
      { index: 5, id: "motion", outcome: "dropped", reason: "invalid" },
      { index: 6, id: null, outcome: "dropped", reason: "invalid" },
      { index: 7, id: "purpose", outcome: "dropped", reason: "invalid" },
      { index: 8, id: "entries", outcome: "dropped", reason: "invalid" },
      { index: 9, id: null, outcome: "dropped", reason: "invalid" },
    ]);
    expect(result).toMatchObject({ stored: 1, dropped: 9 });
  });

  it("answers a retry from the receipt and refuses the id with other points", async () => {
    const points = [pt("a", "2026-10-12T01:00:00Z")];
    expect((await ingest("u2", points)).replayed).toBe(false);
    const again = await ingest("u2", points);
    expect(again.replayed).toBe(true);
    expect(again.result).toMatchObject({ stored: 1 });
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(1);

    await expect(ingest("u2", [pt("a", "2026-10-12T01:00:01Z")])).rejects.toMatchObject({
      statusCode: 409,
      code: "RECORDING_UPLOAD_ID_REUSED",
    });
  });

  it("keys a position like Dawarich: same second and coordinates is one point, from any device", async () => {
    await ingest("u3", [pt("a", "2026-10-12T01:00:00.200Z")]);
    const { result } = await ingest("u4", [
      pt("a", "2026-10-12T01:00:00.200Z"),
      pt("a2", "2026-10-12T01:00:00.900Z"),
      pt("c", "2026-10-12T02:00:00Z"),
      pt("c", "2026-10-12T02:00:00Z"),
    ]);
    expect(result.outcomes.map((o) => o.outcome)).toEqual([
      "duplicate",
      "duplicate",
      "stored",
      "duplicate",
    ]);
    const fromPhone2 = await ingest("u5", [pt("z", "2026-10-12T01:00:00.500Z")], {
      deviceId: "phone-2",
    });
    expect(fromPhone2.result.outcomes[0].outcome).toBe("duplicate");
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(2);
  });

  it("keeps a deleted span deleted: a late upload cannot bring it back", async () => {
    await ingest("u6", [pt("a", "2026-10-12T01:00:00Z"), pt("b", "2026-10-12T03:00:00Z")]);
    const del = await deleteTravTrackRange(
      userId,
      new Date("2026-10-12T00:00:00Z"),
      new Date("2026-10-12T02:00:00Z")
    );
    expect(del).toEqual({ deleted: 1, gapsClipped: 0 });
    const late = await ingest("u7", [
      pt("a", "2026-10-12T01:00:00Z"),
      pt("d", "2026-10-12T02:00:00Z"),
    ]);
    expect(late.result.outcomes).toEqual([
      { index: 0, id: "a", outcome: "dropped", reason: "deleted_range" },
      { index: 1, id: "d", outcome: "stored" },
    ]);
  });

  it("checks a far-apart batch against its own seconds only", async () => {
    await ingest("far1", [pt("x", "2026-06-01T00:00:00Z", 10, 10)]);
    const { result } = await ingest("far2", [
      pt("y", "2020-01-01T00:00:00Z", 10, 10),
      pt("z", "2026-10-12T00:00:00Z", 10, 10),
    ]);
    expect(result).toMatchObject({ stored: 2, duplicate: 0 });
  });

  it("a point inside a zone is dropped before it is checked against a deleted range", async () => {
    await prisma.travTrackPrivacyZone.create({
      data: { userId, name: "Zuhause", lat: 37.5665, lon: 126.978, radiusM: 250 },
    });
    await prisma.travTrackDeletedRange.create({
      data: {
        userId,
        fromAt: new Date("2026-10-12T00:00:00Z"),
        toAt: new Date("2026-10-12T02:00:00Z"),
      },
    });
    const { result } = await ingest("zone-first", [pt("home", "2026-10-12T01:00:00Z")]);
    expect(result.outcomes).toEqual([
      { index: 0, id: "home", outcome: "dropped", reason: "privacy_zone" },
    ]);
  });

  describe("links to flights and trips", () => {
    it("one fix uploaded for the trip and again for the flight is one point with two links", async () => {
      const tripId = await makeTrip(userId);
      const flightId = await makeFlight(userId);
      const fix = (entries: object[]) =>
        pt("fix", "2026-10-12T00:45:00Z", 37.2, 126.4, { purpose: "trip", entries });

      const first = await ingest("trip-up", [fix([{ kind: "trip", id: tripId }])]);
      expect(first.result).toMatchObject({ stored: 1, linked: 1 });
      const second = await ingest("flight-up", [fix([{ kind: "flight", id: flightId }])]);
      expect(second.result).toMatchObject({ stored: 0, duplicate: 1, linked: 1 });

      expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(1);
      expect(await linksOf("fix")).toEqual([`flight:${flightId}`, `trip:${tripId}`]);
    });

    it("a duplicate never removes a link", async () => {
      const tripId = await makeTrip(userId);
      await ingest("l1", [
        pt("p", "2026-10-12T01:00:00Z", 1, 1, { entries: [{ kind: "trip", id: tripId }] }),
      ]);
      const again = await ingest("l2", [pt("p", "2026-10-12T01:00:00Z", 1, 1)]);
      expect(again.result).toMatchObject({ duplicate: 1, linked: 0 });
      expect(await linksOf("p")).toEqual([`trip:${tripId}`]);
    });

    it("an entry of another account is counted unlinked and the point is still stored", async () => {
      const theirTrip = await makeTrip(otherId);
      const { result } = await ingest("foreign", [
        pt("p", "2026-10-12T01:00:00Z", 1, 1, {
          entries: [
            { kind: "trip", id: theirTrip },
            { kind: "flight", id: "not-a-flight" },
          ],
        }),
      ]);
      expect(result).toMatchObject({ stored: 1, linked: 0, unlinked: 2 });
      expect(await linksOf("p")).toEqual([]);
    });

    it("a trip merged away links to the surviving trip", async () => {
      const target = await makeTrip(userId, "Ziel");
      const source = await makeTrip(userId, "Quelle");
      await mergeTrips(userId, { tripIds: [target, source], targetId: target });

      const { result } = await ingest("merged", [
        pt("p", "2026-10-12T01:00:00Z", 1, 1, { entries: [{ kind: "trip", id: source }] }),
      ]);
      expect(result).toMatchObject({ stored: 1, linked: 1, unlinked: 0 });
      expect(await linksOf("p")).toEqual([`trip:${target}`]);
    });
  });

  describe("gaps", () => {
    const gap = (from: string, to: string, reason = "recorderSilent") => ({ from, to, reason });

    it("gaps are stored once", async () => {
      const gaps = [gap("2026-10-12T01:00:00Z", "2026-10-12T02:00:00Z")];
      await ingest("g1", [pt("a", "2026-10-12T00:00:00Z")], { gaps });
      await ingest("g2", [pt("b", "2026-10-12T03:00:00Z")], { gaps });
      const rows = await prisma.travTrackGap.findMany({ where: { userId } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ deviceId: "phone-1", reason: "recorderSilent" });
    });

    it("a gap uploaded into a deleted range is not stored, one straddling it is clipped to the outside", async () => {
      await deleteTravTrackRange(
        userId,
        new Date("2026-10-12T02:00:00Z"),
        new Date("2026-10-12T04:00:00Z")
      );
      await ingest("g3", [], {
        gaps: [
          gap("2026-10-12T02:30:00Z", "2026-10-12T03:00:00Z", "permission"),
          gap("2026-10-12T01:00:00Z", "2026-10-12T05:00:00Z", "zonesUnknown"),
        ],
      });
      const rows = await prisma.travTrackGap.findMany({
        where: { userId },
        orderBy: { fromAt: "asc" },
      });
      expect(rows.map((g) => [g.reason, g.fromAt.toISOString(), g.toAt.toISOString()])).toEqual([
        ["zonesUnknown", "2026-10-12T01:00:00.000Z", "2026-10-12T02:00:00.000Z"],
        ["zonesUnknown", "2026-10-12T04:00:00.000Z", "2026-10-12T05:00:00.000Z"],
      ]);
    });

    it("a gap-only upload is accepted and answered like any other", async () => {
      const gaps = [gap("2026-10-12T01:00:00Z", "2026-10-12T02:00:00Z")];
      const first = await ingest("gap-only", [], { gaps });
      expect(first).toMatchObject({
        replayed: false,
        result: { uploadId: "gap-only", stored: 0, duplicate: 0, dropped: 0, gapsStored: 1 },
      });
      const replay = await ingest("gap-only", [], { gaps });
      expect(replay.replayed).toBe(true);
    });

    it("an upload with neither points nor gaps is 400", async () => {
      await expect(ingest("empty", [], { gaps: [] })).rejects.toMatchObject({ statusCode: 400 });
      await expect(ingest("empty2", [])).rejects.toMatchObject({ statusCode: 400 });
    });

    it("a gap that ends before it starts, or lies outside 2000 … tomorrow, is 400", async () => {
      await expect(
        ingest("bad1", [], { gaps: [gap("2026-10-12T02:00:00Z", "2026-10-12T01:00:00Z")] })
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        ingest("bad2", [], { gaps: [gap("1999-01-01T00:00:00Z", "1999-01-02T00:00:00Z")] })
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        ingest("bad3", [], { gaps: [gap("2026-10-12T01:00:00", "2026-10-12T02:00:00Z")] })
      ).rejects.toMatchObject({ statusCode: 400 });
      await expect(
        ingest("bad4", [], { gaps: [gap("2026-10-12T01:00:00Z", "2026-10-12T02:00:00Z", "zone")] })
      ).rejects.toMatchObject({ statusCode: 400 });
      expect(await prisma.travTrackGap.count({ where: { userId } })).toBe(0);
    });
  });
});
