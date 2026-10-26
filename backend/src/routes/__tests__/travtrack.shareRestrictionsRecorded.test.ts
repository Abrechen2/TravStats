import request from "supertest";

import app from "../../index";
import { shareSnapshotBuildLimiter } from "../../middleware/shareSnapshotBuildLimit";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import type { LonLat } from "../../services/travtrack/privacyCut";
import { takeTravTrackLock } from "../../services/travtrack/lock";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import {
  makeFlight,
  makeTrip,
  makeUser,
  storePoint,
  wipeTravTrack,
} from "../../services/travtrack/__tests__/fixtures";

/**
 * The restrictions recorded against a shared route (Codex review of T7, third
 * round): none is lost to a build running at the same time, each is read in
 * the profile zone that was in force when it was recorded, and a change that
 * moves no recorder window, or repeats one already recorded, adds no row.
 */

/**
 * Holds the owner's build after it read its inputs, while `mockHold.armed` is
 * set; with `fail`, the held build then throws instead of going on.
 */
const mockHold: {
  armed: boolean;
  fail?: boolean;
  reached?: () => void;
  release?: Promise<void>;
} = { armed: false };
jest.mock("../../services/travtrack/privacyCircles", () => {
  const actual = jest.requireActual("../../services/travtrack/privacyCircles");
  return {
    ...actual,
    privacyCirclesFor: async (...args: unknown[]) => {
      if (mockHold.armed) {
        const fail = mockHold.fail === true;
        mockHold.armed = false;
        mockHold.fail = false;
        mockHold.reached?.();
        await mockHold.release;
        if (fail) throw new Error("build failed (test)");
      }
      return actual.privacyCirclesFor(...args);
    },
  };
});

/** Arms the hold for the next build: resolves `atHold` when reached, holds until `release()`. */
function armHold(fail = false) {
  let reached!: () => void;
  const atHold = new Promise<void>((resolve) => (reached = resolve));
  let release!: () => void;
  mockHold.release = new Promise<void>((resolve) => (release = resolve));
  mockHold.reached = reached;
  mockHold.fail = fail;
  mockHold.armed = true;
  return { atHold, release };
}

const PREFIX = "travtrack-share-recorded-";
const MIN = 60_000;
const HOME = { lat: 37.5, lon: 127.0 };

type Geometry = LonLat[][];
const vertices = (g: Geometry) => g.flat();
const westOf = (g: Geometry, lon: number) => vertices(g).some((p) => p[0] < lon);
const eastOf = (g: Geometry, lon: number) => vertices(g).some((p) => p[0] > lon);

describe("TravTrack — restrictions recorded against a shared route", () => {
  const switches = travTrackSwitches();
  let owner: string;
  let recipient: string;
  let ownerCookie: string;
  let recipientCookie: string;
  let tripId: string;
  let copyId: string;

  /** One fix a minute, eastwards along `lat`, 0.002° apart, zigzagging. */
  const walk = async (fromLon: number, toLon: number, startMs: number, lat = 37.6) => {
    const steps = Math.round((toLon - fromLon) / 0.002);
    for (let i = 0; i <= steps; i++) {
      await storePoint(owner, {
        t: startMs + i * MIN,
        lat: lat + (i % 2) * 0.001,
        lon: fromLon + i * 0.002,
      });
    }
  };

  const share = () =>
    request(app).put(`/api/v1/trips/${tripId}/share-snapshot`).set("Cookie", ownerCookie);

  const recipientRead = async (): Promise<Geometry> => {
    const res = await request(app)
      .get(`/api/v1/trips/${copyId}/shared-route`)
      .set("Cookie", recipientCookie);
    if (res.status === 404) return [];
    expect(res.status).toBe(200);
    return (res.body.routes as Array<{ geometry: Geometry }>).flatMap((r) => r.geometry);
  };

  const setProfileZone = (zone: string | null) =>
    prisma.userSettings.update({
      where: { userId: owner },
      data: { data: zone ? { display: { timezone: zone } } : {} },
    });

  const snapshotId = async () =>
    (await prisma.travTrackShareSnapshot.findUniqueOrThrow({ where: { tripId } })).id;

  beforeAll(async () => {
    owner = await makeUser(`${PREFIX}owner`);
    recipient = await makeUser(`${PREFIX}recipient`);
    ownerCookie = `auth_token=${generateToken(owner)}`;
    recipientCookie = `auth_token=${generateToken(recipient)}`;
  });

  beforeEach(async () => {
    mockHold.armed = false;
    await switches.set({ beta: true, config: true });
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

  /** Runs the owner's share, and `during` while the build holds after reading its inputs. */
  async function shareWhile(during: () => Promise<void>) {
    const { atHold, release } = armHold();
    const done = share().then((r) => r);
    await atHold;
    try {
      await during();
    } finally {
      release();
    }
    return done;
  }

  const linkAndUnlink = async () => {
    const flightId = await makeFlight(owner);
    await prisma.flight.update({ where: { id: flightId }, data: { tripId } });
    await prisma.flight.update({ where: { id: flightId }, data: { tripId: null } });
  };

  // From 01:30Z; the fixture flight's recorder window runs to 02:00Z.
  const FLIGHT_WALK = Date.parse("2026-10-12T01:30:00Z");
  const IN_FLIGHT_LON = 126.985;

  describe("a build running while a flight comes and goes", () => {
    it("a flight linked and unlinked during a new share keeps its hours hidden", async () => {
      await walk(126.95, 127.06, FLIGHT_WALK);
      expect((await share()).status).toBe(200);
      expect(westOf(await recipientRead(), IN_FLIGHT_LON)).toBe(true);
      const res = await shareWhile(linkAndUnlink);
      expect(res.status).toBe(200);
      const read = await recipientRead();
      expect(read.length).toBeGreaterThan(0);
      expect(westOf(read, IN_FLIGHT_LON)).toBe(false);
    });

    it("…and during the first share too", async () => {
      await walk(126.95, 127.06, FLIGHT_WALK);
      const res = await shareWhile(linkAndUnlink);
      expect(res.status).toBe(200);
      expect(res.body.snapshot.version).toBe(1);
      const read = await recipientRead();
      expect(read.length).toBeGreaterThan(0);
      expect(westOf(read, IN_FLIGHT_LON)).toBe(false);
    });

    it("a first share that finds nothing leaves no stored route behind", async () => {
      const res = await share();
      expect(res.status).toBe(409);
      expect(await prisma.travTrackShareSnapshot.count({ where: { tripId } })).toBe(0);
      const own = await request(app)
        .get(`/api/v1/trips/${tripId}/share-snapshot`)
        .set("Cookie", ownerCookie);
      expect(own.body.snapshot ?? null).toBeNull();
    });
  });

  describe("a restriction repeated while a refresh runs", () => {
    // The refresh captures what is recorded, then reads its inputs; the same
    // restriction recorded again after that read must survive the refresh,
    // although it lands on the row the refresh captured (one row per key).

    it("a flight linked and unlinked again during the refresh keeps its hours hidden", async () => {
      await walk(126.95, 127.06, FLIGHT_WALK);
      expect((await share()).status).toBe(200);
      await linkAndUnlink();
      expect(westOf(await recipientRead(), IN_FLIGHT_LON)).toBe(false);
      const res = await shareWhile(linkAndUnlink);
      expect(res.status).toBe(200);
      const read = await recipientRead();
      expect(read.length).toBeGreaterThan(0);
      expect(westOf(read, IN_FLIGHT_LON)).toBe(false);
    });

    it("days narrowed and widened again during the refresh keep the cut-off hours hidden", async () => {
      // The trip (Asia/Seoul) ends on 14 Oct at 15:00Z; narrowed to 13 Oct, a day earlier.
      const AFTER_NARROW_END_LON = 126.95 + 29 * 0.002 + 0.001;
      const narrowAndWiden = async () => {
        await prisma.trip.update({
          where: { id: tripId },
          data: { endDate: new Date("2026-10-13T00:00:00Z"), endDay: new Date("2026-10-13") },
        });
        await prisma.trip.update({
          where: { id: tripId },
          data: { endDate: new Date("2026-10-14T00:00:00Z"), endDay: new Date("2026-10-14") },
        });
      };
      await walk(126.95, 127.06, Date.parse("2026-10-13T14:30:00Z"));
      expect((await share()).status).toBe(200);
      expect(eastOf(await recipientRead(), AFTER_NARROW_END_LON)).toBe(true);
      await narrowAndWiden();
      expect(eastOf(await recipientRead(), AFTER_NARROW_END_LON)).toBe(false);
      const res = await shareWhile(narrowAndWiden);
      expect(res.status).toBe(200);
      const read = await recipientRead();
      expect(read.length).toBeGreaterThan(0);
      expect(eastOf(read, AFTER_NARROW_END_LON)).toBe(false);
    });

    it("a home moved and moved back during the refresh keeps its former place hidden", async () => {
      const MOVED = { lat: 37.6, lon: 127.0 };
      const nearMoved = (g: Geometry) =>
        vertices(g).some(
          (p) => Math.abs(p[0] - MOVED.lon) < 0.005 && Math.abs(p[1] - MOVED.lat) < 0.005
        );
      const moveAndBack = async () => {
        await prisma.userSettings.update({
          where: { userId: owner },
          data: { homePlace: { name: "Zuhause", ...MOVED } },
        });
        await prisma.userSettings.update({
          where: { userId: owner },
          data: { homePlace: { name: "Zuhause", ...HOME } },
        });
      };
      await walk(126.95, 127.06, Date.parse("2026-10-12T03:00:00Z"));
      expect((await share()).status).toBe(200);
      expect(nearMoved(await recipientRead())).toBe(true);
      await moveAndBack();
      expect(nearMoved(await recipientRead())).toBe(false);
      const res = await shareWhile(moveAndBack);
      expect(res.status).toBe(200);
      const read = await recipientRead();
      expect(read.length).toBeGreaterThan(0);
      expect(nearMoved(read)).toBe(false);
    });
  });

  describe("two first shares at once, one of them failing", () => {
    /** Builds and cleanups of the owner's account waiting for its TravTrack lock. */
    const lockWaiters = async () => {
      const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
        SELECT count(*) AS n FROM pg_locks l,
          LATERAL (SELECT hashtextextended(${`travtrack:${owner}`}, 0) AS k) h
        WHERE l.locktype = 'advisory' AND NOT l.granted
          AND l.classid = ((h.k >> 32) & 4294967295)::oid
          AND l.objid = (h.k & 4294967295)::oid`;
      return Number(rows[0].n);
    };
    const until = async (done: () => Promise<boolean> | boolean) => {
      for (let i = 0; i < 500; i++) {
        if (await done()) return;
        await new Promise((r) => setTimeout(r, 20));
      }
      throw new Error("condition not reached");
    };

    it("the failed build's cleanup never takes the pending row the other build is using", async () => {
      await walk(126.95, 127.06, FLIGHT_WALK);
      // A: creates the pending row, takes the lock, reads its inputs and holds.
      const a = armHold(true);
      let aSettled = false;
      const first = share().then((r) => {
        aSettled = true;
        return r;
      });
      await a.atHold;
      // B: finds A's pending row and waits for the lock A holds.
      const second = share().then((r) => r);
      await until(async () => (await lockWaiters()) >= 1);
      const b = armHold();
      // A fails; B takes the lock and reads its inputs.
      a.release();
      await b.atHold;
      // A's cleanup either ran or waits for B's lock — never interleaves with B.
      await until(async () => aSettled || (await lockWaiters()) >= 1);
      await linkAndUnlink();
      b.release();
      const [resA, resB] = await Promise.all([first, second]);
      expect(resA.status).toBe(500);
      expect(resB.status).toBe(200);
      expect(resB.body.snapshot.version).toBe(1);
      const read = await recipientRead();
      expect(read.length).toBeGreaterThan(0);
      expect(westOf(read, IN_FLIGHT_LON)).toBe(false);
    });

    it("a build that finds its pending row removed commits it again before reading anything", async () => {
      await walk(126.95, 127.06, FLIGHT_WALK);
      // Something else holds the account's TravTrack lock.
      let unlock!: () => void;
      const unlocked = new Promise<void>((resolve) => (unlock = resolve));
      let locked!: () => void;
      const isLocked = new Promise<void>((resolve) => (locked = resolve));
      const holder = prisma.$transaction(async (tx) => {
        await takeTravTrackLock(tx, owner);
        locked();
        await unlocked;
      });
      await isLocked;
      const b = armHold();
      const building = share().then((r) => r);
      await until(async () => (await lockWaiters()) >= 1);
      // The pending row the share committed goes while it waits (a revoke, say).
      await prisma.travTrackShareSnapshot.deleteMany({ where: { tripId } });
      unlock();
      await holder;
      await b.atHold;
      await linkAndUnlink();
      b.release();
      const res = await building;
      expect(res.status).toBe(200);
      expect(res.body.snapshot.version).toBe(1);
      const read = await recipientRead();
      expect(read.length).toBeGreaterThan(0);
      expect(westOf(read, IN_FLIGHT_LON)).toBe(false);
    });

    it("a first share that fails alone leaves no pending row behind", async () => {
      await walk(126.95, 127.06, FLIGHT_WALK);
      const a = armHold(true);
      const first = share().then((r) => r);
      await a.atHold;
      a.release();
      expect((await first).status).toBe(500);
      expect(await prisma.travTrackShareSnapshot.count({ where: { tripId } })).toBe(0);
    });
  });

  describe("the profile zone a trip's days were read in", () => {
    // A trip with no zone of its own: its days are read on the profile clock.
    // Under UTC it ends at 15 Oct 00:00Z; under Asia/Tokyo at 14 Oct 15:00Z.
    const AT_TOKYO_END = Date.parse("2026-10-14T14:30:00Z");
    // Fixes from 15:00Z lie east of this.
    const AFTER_TOKYO_END_LON = 126.95 + 29 * 0.002 + 0.001;

    beforeEach(async () => {
      await prisma.trip.update({ where: { id: tripId }, data: { startZone: null, endZone: null } });
    });

    it("a profile zone changed and changed back keeps the hours it cut off hidden", async () => {
      await walk(126.95, 127.06, AT_TOKYO_END);
      expect((await share()).status).toBe(200);
      expect(eastOf(await recipientRead(), AFTER_TOKYO_END_LON)).toBe(true);
      await setProfileZone("Asia/Tokyo");
      expect(eastOf(await recipientRead(), AFTER_TOKYO_END_LON)).toBe(false);
      await setProfileZone(null);
      const read = await recipientRead();
      expect(read.length).toBeGreaterThan(0);
      expect(eastOf(read, AFTER_TOKYO_END_LON)).toBe(false);
    });

    it("a span recorded under one zone is read in it after the zone changed", async () => {
      // Under Tokyo a trip ending on 13 Oct ends at 13 Oct 15:00Z; under UTC a day later.
      await walk(126.95, 127.06, Date.parse("2026-10-13T14:30:00Z"));
      expect((await share()).status).toBe(200);
      expect(eastOf(await recipientRead(), AFTER_TOKYO_END_LON)).toBe(true);
      await setProfileZone("Asia/Tokyo");
      // Under Tokyo the days narrow to 13 Oct and widen again…
      await prisma.trip.update({
        where: { id: tripId },
        data: { endDate: new Date("2026-10-13T00:00:00Z"), endDay: new Date("2026-10-13") },
      });
      await prisma.trip.update({
        where: { id: tripId },
        data: { endDate: new Date("2026-10-14T00:00:00Z"), endDay: new Date("2026-10-14") },
      });
      // …and that span stays Tokyo's after the zone went back to UTC.
      await setProfileZone(null);
      const read = await recipientRead();
      expect(read.length).toBeGreaterThan(0);
      expect(eastOf(read, AFTER_TOKYO_END_LON)).toBe(false);
    });

    it("a settings row deleted and created again keeps the default zone's cut hidden", async () => {
      // Under Tokyo the trip starts on 10 Oct 15:00Z; under UTC on 11 Oct 00:00Z.
      await walk(126.95, 127.06, Date.parse("2026-10-10T14:30:00Z"));
      await setProfileZone("Asia/Tokyo");
      expect((await share()).status).toBe(200);
      expect(eastOf(await recipientRead(), AFTER_TOKYO_END_LON)).toBe(true);
      await prisma.userSettings.delete({ where: { userId: owner } });
      await prisma.userSettings.create({
        data: {
          userId: owner,
          data: { display: { timezone: "Asia/Tokyo" } },
          homePlace: { name: "Zuhause", ...HOME },
        },
      });
      expect(eastOf(await recipientRead(), AFTER_TOKYO_END_LON)).toBe(false);
    });
  });

  describe("what a change adds to the records", () => {
    it("a flight's provider readings add nothing, and a repeated window is recorded once", async () => {
      await walk(126.95, 127.06, FLIGHT_WALK);
      expect((await share()).status).toBe(200);
      const flightId = await makeFlight(owner);
      await prisma.flight.update({ where: { id: flightId }, data: { tripId } });
      const id = await snapshotId();
      for (let i = 0; i < 10; i++) {
        const at = new Date(Date.parse("2026-10-12T00:35:00Z") + i * MIN);
        await prisma.flight.update({
          where: { id: flightId },
          data: { actualDeparture: at, runwayDepartureTime: at, actualArrival: at },
        });
      }
      expect(await prisma.travTrackSharePastFlight.count({ where: { snapshotId: id } })).toBe(0);
      const a = new Date("2026-10-12T00:30:00Z");
      const b = new Date("2026-10-12T00:40:00Z");
      for (let i = 0; i < 10; i++) {
        await prisma.flight.update({
          where: { id: flightId },
          data: { departureTime: i % 2 === 0 ? b : a },
        });
      }
      expect(await prisma.travTrackSharePastFlight.count({ where: { snapshotId: id } })).toBe(2);
    });

    it("days and profile zones toggled back and forth are each recorded once", async () => {
      await prisma.trip.update({ where: { id: tripId }, data: { startZone: null, endZone: null } });
      await walk(126.95, 127.06, Date.parse("2026-10-12T03:00:00Z"));
      expect((await share()).status).toBe(200);
      const id = await snapshotId();
      for (let i = 0; i < 6; i++) {
        await setProfileZone(i % 2 === 0 ? "Asia/Tokyo" : null);
        await prisma.trip.update({
          where: { id: tripId },
          data: { endDay: new Date(i % 2 === 0 ? "2026-10-13" : "2026-10-14") },
        });
      }
      // Two zones × two spans at most, whatever the number of writes.
      expect(
        await prisma.travTrackSharePastSpan.count({ where: { snapshotId: id } })
      ).toBeLessThanOrEqual(4);
      expect((await recipientRead()).length).toBeGreaterThan(0);
    });
  });
});
