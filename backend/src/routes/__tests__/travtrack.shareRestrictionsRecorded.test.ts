import request from "supertest";

import app from "../../index";
import { shareSnapshotBuildLimiter } from "../../middleware/shareSnapshotBuildLimit";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
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
 * The restrictions recorded against a shared route (Codex review of T7, third
 * round): none is lost to a build running at the same time, each is read in
 * the profile zone that was in force when it was recorded, and a change that
 * moves no recorder window, or repeats one already recorded, adds no row.
 */

/** Holds the owner's build after it read its inputs, while `mockHold.armed` is set. */
const mockHold: { armed: boolean; reached?: () => void; release?: Promise<void> } = {
  armed: false,
};
jest.mock("../../services/travtrack/privacyCircles", () => {
  const actual = jest.requireActual("../../services/travtrack/privacyCircles");
  return {
    ...actual,
    privacyCirclesFor: async (...args: unknown[]) => {
      if (mockHold.armed) {
        mockHold.armed = false;
        mockHold.reached?.();
        await mockHold.release;
      }
      return actual.privacyCirclesFor(...args);
    },
  };
});

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

  describe("a build running while a flight comes and goes", () => {
    // From 01:30Z; the fixture flight's recorder window runs to 02:00Z.
    const FLIGHT_WALK = Date.parse("2026-10-12T01:30:00Z");
    const IN_FLIGHT_LON = 126.985;

    /** Runs the owner's share, and `during` while the build holds after reading its inputs. */
    async function shareWhile(during: () => Promise<void>) {
      let reached!: () => void;
      const atHold = new Promise<void>((resolve) => (reached = resolve));
      let release!: () => void;
      mockHold.release = new Promise<void>((resolve) => (release = resolve));
      mockHold.reached = reached;
      mockHold.armed = true;
      const building = share();
      const done = building.then((r) => r);
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
});
