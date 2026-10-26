import request from "supertest";

import app from "../../index";
import { shareSnapshotBuildLimiter } from "../../middleware/shareSnapshotBuildLimit";
import { observeQueries, prisma } from "../../db";
import { Prisma } from "../../prisma";
import { generateToken } from "../../utils/jwt";
import { distanceM } from "../../services/travtrack/classify";
import type { LonLat } from "../../services/travtrack/privacyCut";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import {
  makeFlight,
  makeTrip,
  makeUser,
  storePoint,
  wipeTravTrack,
} from "../../services/travtrack/__tests__/fixtures";

/**
 * What hides part of a shared route stays hidden (Codex review of T7, second
 * round). A restriction — a former home, a trip's narrower days, a flight's
 * hours — is recorded in the same transaction as the change that makes it,
 * by whatever path the change takes, and it only ever accumulates: widening
 * the days again, clearing the home or removing the flight never brings back
 * what it hid. Only the owner's own new share starts over.
 */

const PREFIX = "travtrack-share-restrict-";
const MIN = 60_000;
// The Seoul fixture trip runs 11–14 Oct on Asia/Seoul: 10 Oct 15:00Z to 14 Oct 15:00Z.
const T0 = Date.parse("2026-10-12T03:00:00Z");
const HOME = { lat: 37.5, lon: 127.0 };

type Geometry = LonLat[][];

const vertices = (g: Geometry) => g.flat();
const near = (g: Geometry, c: { lat: number; lon: number }, m = 1000) =>
  vertices(g).some((p) => distanceM({ lon: p[0], lat: p[1] }, c) <= m);
const westOf = (g: Geometry, lon: number) => vertices(g).some((p) => p[0] < lon);

describe("TravTrack — what hid part of a shared route keeps it hidden", () => {
  const switches = travTrackSwitches();
  let owner: string;
  let recipient: string;
  let ownerCookie: string;
  let recipientCookie: string;
  let tripId: string;
  let copyId: string;

  /**
   * One fix a minute, eastwards along `lat`, 0.002° apart — zigzagging, so
   * simplification keeps every vertex and a cut leaves drawable pieces.
   */
  const walk = async (fromLon: number, toLon: number, startMs: number, lat = 37.5) => {
    const steps = Math.round((toLon - fromLon) / 0.002);
    for (let i = 0; i <= steps; i++) {
      await storePoint(owner, {
        t: startMs + i * MIN,
        lat: lat + (i % 2) * 0.001,
        lon: fromLon + i * 0.002,
      });
    }
  };

  const share = async () => {
    const res = await request(app)
      .put(`/api/v1/trips/${tripId}/share-snapshot`)
      .set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    return res.body.snapshot as { version: number; geometry: Geometry };
  };

  const recipientRead = async (): Promise<Geometry> => {
    const res = await request(app)
      .get(`/api/v1/trips/${copyId}/shared-route`)
      .set("Cookie", recipientCookie);
    if (res.status === 404) return [];
    expect(res.status).toBe(200);
    return (res.body.routes as Array<{ geometry: Geometry }>).flatMap((r) => r.geometry);
  };

  const putHome = (to: { lat: number; lon: number } | null) =>
    request(app)
      .put("/api/v1/settings/personal")
      .set("Cookie", ownerCookie)
      .send({ homePlace: to ? { name: "Neu", ...to, zone: null } : null });

  const patchDays = (startDate: string, endDate: string) =>
    request(app)
      .patch(`/api/v1/trips/${tripId}`)
      .set("Cookie", ownerCookie)
      .send({ startDate, endDate });

  /**
   * Every write to this trip's stored route fails while `run` runs — the
   * narrowing a change makes breaks, by a trigger only this trip's row trips.
   */
  async function whileSnapshotWritesFail<T>(run: () => Promise<T>): Promise<T> {
    const fn = `test_fail_snapshot_${Date.now()}`;
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ${fn}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected snapshot failure'; END $$`
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${fn} BEFORE UPDATE OR DELETE ON travtrack_share_snapshots FOR EACH ROW WHEN (OLD.trip_id = '${tripId}') EXECUTE FUNCTION ${fn}()`
    );
    try {
      return await run();
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER ${fn} ON travtrack_share_snapshots`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION ${fn}()`);
    }
  }

  const storedHome = async () =>
    (
      await prisma.userSettings.findUnique({
        where: { userId: owner },
        select: { homePlace: true },
      })
    )?.homePlace;

  beforeAll(async () => {
    owner = await makeUser(`${PREFIX}owner`);
    recipient = await makeUser(`${PREFIX}recipient`);
    ownerCookie = `auth_token=${generateToken(owner)}`;
    recipientCookie = `auth_token=${generateToken(recipient)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    // Each test builds afresh; the build limiter's own test spends the bucket on purpose.
    for (const id of [owner, recipient]) await shareSnapshotBuildLimiter.resetKey(`user:${id}`);
    await wipeTravTrack([owner, recipient]);
    await prisma.flight.deleteMany({ where: { userId: owner } });
    await prisma.trip.deleteMany({ where: { userId: { in: [owner, recipient] } } });
    await prisma.shareConsent.deleteMany({
      where: { OR: [{ requesterId: owner }, { targetId: owner }] },
    });
    await prisma.userSettings.deleteMany({ where: { userId: owner } });
    await prisma.userSettings.create({
      data: { userId: owner, data: {}, homePlace: { name: "Zuhause", ...HOME } },
    });
    tripId = await makeTrip(owner);
    copyId = await makeTrip(recipient);
    const group = await prisma.tripShareGroup.create({ data: { createdById: owner } });
    await prisma.trip.updateMany({
      where: { id: { in: [tripId, copyId] } },
      data: { shareGroupId: group.id },
    });
    await prisma.shareConsent.create({
      data: { requesterId: owner, targetId: recipient, status: "accepted" },
    });
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  describe("homes", () => {
    const B = { lat: 37.5, lon: 126.96 };
    const C = { lat: 37.5, lon: 127.05 };

    it("two home changes from the same home keep both new homes hidden", async () => {
      await walk(126.95, 127.06, T0);
      await share();
      // Hold the settings row so both requests are under way before either writes.
      let release!: () => void;
      const gate = new Promise<void>((resolve) => (release = resolve));
      let held!: () => void;
      const holding = new Promise<void>((resolve) => (held = resolve));
      const hold = prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT 1 FROM user_settings WHERE user_id = ${owner} FOR UPDATE`;
          held();
          await gate;
        },
        { timeout: 30_000 }
      );
      await holding;
      let writes = 0;
      const stop = observeQueries((q) => {
        if (q.model === "UserSettings" && q.operation === "updateMany") writes += 1;
      });
      const toB = putHome(B);
      const toC = putHome(C);
      const started = Promise.all([toB, toC]);
      for (let i = 0; i < 60 && writes < 1; i++) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      await new Promise((resolve) => setTimeout(resolve, 300));
      release();
      await hold;
      const [b, c] = await started;
      stop();
      expect(b.status).toBe(200);
      expect(c.status).toBe(200);
      const read = await recipientRead();
      expect(read.length).toBeGreaterThan(0);
      for (const home of [HOME, B, C]) expect(near(read, home)).toBe(false);
    });

    it("a home change whose narrowing fails does not happen", async () => {
      await walk(126.95, 127.06, T0);
      await share();
      const res = await whileSnapshotWritesFail(() => putHome(B));
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(await storedHome()).toMatchObject(HOME);
    });

    it("a home moved and cleared past every route keeps each home hidden", async () => {
      await walk(126.95, 127.06, T0);
      await share();
      // Neither write goes through the settings route.
      await prisma.userSettings.update({
        where: { userId: owner },
        data: { homePlace: { name: "Zweites", ...B } },
      });
      await prisma.userSettings.update({
        where: { userId: owner },
        data: { homePlace: Prisma.DbNull },
      });
      const read = await recipientRead();
      expect(read.length).toBeGreaterThan(0);
      expect(near(read, B)).toBe(false);
      expect(near(read, HOME)).toBe(false);
    });

    it("the owner's new share starts over from the home in force", async () => {
      await walk(126.95, 127.06, T0);
      await share();
      expect((await putHome(B)).status).toBe(200);
      expect((await putHome(null)).status).toBe(200);
      expect(near(await recipientRead(), B)).toBe(false);
      await share();
      expect(near(await recipientRead(), B)).toBe(true);
    });
  });

  describe("a trip's days", () => {
    // 23:30 KST on 11 Oct to 00:25 KST on 12 Oct, well north of home.
    const MIDNIGHT_WALK = Date.parse("2026-10-11T14:30:00Z");
    const walkOverMidnight = () => walk(126.95, 127.06, MIDNIGHT_WALK, 37.6);
    // Points before 15:00Z (the first half) lie west of this.
    const BEFORE_MIDNIGHT_LON = 126.95 + 29 * 0.002 + 0.001;

    it("days narrowed past every route and widened again keep the cut-off part hidden", async () => {
      await walkOverMidnight();
      await share();
      expect(westOf(await recipientRead(), BEFORE_MIDNIGHT_LON)).toBe(true);
      // Written past every route: the trip now starts on 12 Oct.
      await prisma.trip.update({
        where: { id: tripId },
        data: { startDate: new Date("2026-10-12T00:00:00Z"), startDay: new Date("2026-10-12") },
      });
      expect(westOf(await recipientRead(), BEFORE_MIDNIGHT_LON)).toBe(false);
      expect((await patchDays("2026-10-10", "2026-10-14")).status).toBe(200);
      const read = await recipientRead();
      expect(read.length).toBeGreaterThan(0);
      expect(westOf(read, BEFORE_MIDNIGHT_LON)).toBe(false);
    });

    it("a change of days whose narrowing fails does not happen", async () => {
      await walkOverMidnight();
      await share();
      const res = await whileSnapshotWritesFail(() => patchDays("2026-10-12", "2026-10-14"));
      expect(res.status).toBeGreaterThanOrEqual(500);
      const trip = await prisma.trip.findUnique({ where: { id: tripId } });
      expect(trip?.startDay?.toISOString().slice(0, 10)).toBe("2026-10-11");
      expect((await patchDays("2026-10-10", "2026-10-14")).status).toBe(200);
      expect(westOf(await recipientRead(), BEFORE_MIDNIGHT_LON)).toBe(true);
    });

    it("days narrowed through the trip and widened again keep the cut-off part hidden", async () => {
      await walkOverMidnight();
      await share();
      expect((await patchDays("2026-10-12", "2026-10-14")).status).toBe(200);
      expect((await patchDays("2026-10-10", "2026-10-14")).status).toBe(200);
      expect(westOf(await recipientRead(), BEFORE_MIDNIGHT_LON)).toBe(false);
    });
  });

  describe("flights", () => {
    // From 01:30Z; the fixture flight's recorder window runs to 02:00Z.
    const FLIGHT_WALK = Date.parse("2026-10-12T01:30:00Z");
    const IN_FLIGHT_LON = 126.985;
    const addFlight = async () => {
      const flightId = await makeFlight(owner);
      await prisma.flight.update({ where: { id: flightId }, data: { tripId } });
      return flightId;
    };

    it("a flight added after sharing and then deleted keeps its hours hidden", async () => {
      await walk(126.95, 127.06, FLIGHT_WALK);
      await share();
      expect(westOf(await recipientRead(), IN_FLIGHT_LON)).toBe(true);
      const flightId = await addFlight();
      expect(westOf(await recipientRead(), IN_FLIGHT_LON)).toBe(false);
      await prisma.flight.delete({ where: { id: flightId } });
      const read = await recipientRead();
      expect(read.length).toBeGreaterThan(0);
      expect(westOf(read, IN_FLIGHT_LON)).toBe(false);
    });

    it("…and so does one moved out of the trip, or cancelled", async () => {
      await walk(126.95, 127.06, FLIGHT_WALK);
      await share();
      const moved = await addFlight();
      await prisma.flight.update({ where: { id: moved }, data: { tripId: null } });
      expect(westOf(await recipientRead(), IN_FLIGHT_LON)).toBe(false);
      await prisma.flight.delete({ where: { id: moved } });
      await share();
      expect(westOf(await recipientRead(), IN_FLIGHT_LON)).toBe(true);
      const cancelled = await addFlight();
      await prisma.flight.update({ where: { id: cancelled }, data: { status: "cancelled" } });
      expect(westOf(await recipientRead(), IN_FLIGHT_LON)).toBe(false);
    });

    it("…and so does one whose times moved", async () => {
      await walk(126.95, 127.06, FLIGHT_WALK);
      await share();
      const flightId = await addFlight();
      const later = Date.parse("2026-10-13T08:00:00Z");
      await prisma.flight.update({
        where: { id: flightId },
        data: { departureTime: new Date(later), arrivalTime: new Date(later + 3_600_000) },
      });
      expect(westOf(await recipientRead(), IN_FLIGHT_LON)).toBe(false);
    });

    it("the owner's new share after the flight went shows its hours again", async () => {
      await walk(126.95, 127.06, FLIGHT_WALK);
      await share();
      const flightId = await addFlight();
      await prisma.flight.delete({ where: { id: flightId } });
      await share();
      expect(westOf(await recipientRead(), IN_FLIGHT_LON)).toBe(true);
    });

    it("deleting a shared trip with flights takes its route and its records with it", async () => {
      await walk(126.95, 127.06, FLIGHT_WALK);
      await share();
      const flightId = await addFlight();
      await prisma.trip.delete({ where: { id: tripId } });
      expect(await prisma.travTrackShareSnapshot.count({ where: { tripId } })).toBe(0);
      expect(await prisma.flight.findUnique({ where: { id: flightId } })).not.toBeNull();
    });
  });
});
