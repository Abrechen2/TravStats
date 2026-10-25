import request from "supertest";

import app from "../../index";
import { shareSnapshotBuildLimiter } from "../../middleware/shareSnapshotBuildLimit";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import type { LonLat } from "../../services/travtrack/privacyCut";
import { narrowShareSnapshots } from "../../services/travtrack/shareNarrow";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import {
  makeFlight,
  makeTrip,
  makeUser,
  storePoint,
  wipeTravTrack,
} from "../../services/travtrack/__tests__/fixtures";

/**
 * Revocation wins (TravTrack plan T7, invariant 15; Codex review P1): a revoke
 * that lands while the owner's build runs, or while an automatic narrowing
 * runs, leaves nothing published behind — no write after it recreates the
 * route, and nothing recorded during that window matters any more.
 */

/** Holds the next `privacyCirclesFor` call (a build's or a narrowing's input read) while armed. */
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

function armHold() {
  let reached!: () => void;
  const atHold = new Promise<void>((resolve) => (reached = resolve));
  let release!: () => void;
  mockHold.release = new Promise<void>((resolve) => (release = resolve));
  mockHold.reached = reached;
  mockHold.armed = true;
  return { atHold, release };
}

const PREFIX = "travtrack-share-revoke-";
const MIN = 60_000;
const HOME = { lat: 37.5, lon: 127.0 };
/** Long enough for a revoke sent during the hold to reach the TravTrack lock. */
const SETTLE_MS = 300;

type Geometry = LonLat[][];

describe("TravTrack — a revoke wins over a build or a narrowing running at the same time", () => {
  const switches = travTrackSwitches();
  let owner: string;
  let recipient: string;
  let ownerCookie: string;
  let recipientCookie: string;
  let tripId: string;
  let copyId: string;

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
  const revoke = () =>
    request(app).delete(`/api/v1/trips/${tripId}/share-snapshot`).set("Cookie", ownerCookie);

  const recipientRead = async (): Promise<Geometry> => {
    const res = await request(app)
      .get(`/api/v1/trips/${copyId}/shared-route`)
      .set("Cookie", recipientCookie);
    if (res.status === 404) return [];
    expect(res.status).toBe(200);
    return (res.body.routes as Array<{ geometry: Geometry }>).flatMap((r) => r.geometry);
  };

  const expectRevoked = async () => {
    expect(await prisma.travTrackShareSnapshot.count({ where: { tripId } })).toBe(0);
    expect(await recipientRead()).toEqual([]);
    const own = await request(app)
      .get(`/api/v1/trips/${tripId}/share-snapshot`)
      .set("Cookie", ownerCookie);
    expect(own.status).toBe(200);
    expect(own.body.snapshot ?? null).toBeNull();
  };

  const linkAndUnlink = async () => {
    const flightId = await makeFlight(owner);
    await prisma.flight.update({ where: { id: flightId }, data: { tripId } });
    await prisma.flight.update({ where: { id: flightId }, data: { tripId: null } });
  };

  const FLIGHT_WALK = Date.parse("2026-10-12T01:30:00Z");

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
    await walk(126.95, 127.06, FLIGHT_WALK);
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  /** Runs the owner's share and, while its build holds after reading its inputs, `during`. */
  async function shareWhile(during: () => Promise<unknown>) {
    const { atHold, release } = armHold();
    const done = share().then((r) => r);
    await atHold;
    let pending: Promise<unknown>;
    try {
      pending = during();
      await new Promise((r) => setTimeout(r, SETTLE_MS));
    } finally {
      release();
    }
    const [res] = await Promise.all([done, pending]);
    return res;
  }

  describe("a revoke during a held build", () => {
    it("publishes nothing after it, and the share stays revoked (refresh)", async () => {
      expect((await share()).status).toBe(200);
      await shareWhile(async () => {
        await linkAndUnlink();
        const res = await revoke();
        expect(res.status).toBe(204);
      });
      await expectRevoked();
    });

    it("…and the same during the first share", async () => {
      await shareWhile(async () => {
        await linkAndUnlink();
        await revoke();
      });
      await expectRevoked();
    });

    it("a later share builds afresh, as an explicit request of the owner", async () => {
      expect((await share()).status).toBe(200);
      await shareWhile(() => revoke());
      await expectRevoked();
      const again = await share();
      expect(again.status).toBe(200);
      expect((await recipientRead()).length).toBeGreaterThan(0);
    });
  });

  describe("the route removed by a writer outside the lock during a held build", () => {
    it("the build writes nothing and says the share was revoked (refresh)", async () => {
      expect((await share()).status).toBe(200);
      const res = await shareWhile(async () => {
        await linkAndUnlink();
        await prisma.travTrackShareSnapshot.deleteMany({ where: { tripId } });
      });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("TRAVTRACK_SHARE_REVOKED");
      await expectRevoked();
    });

    it("…and during the first share, without recreating the pending row", async () => {
      const res = await shareWhile(() =>
        prisma.travTrackShareSnapshot.deleteMany({ where: { tripId } })
      );
      expect(res.status).toBe(409);
      expect(res.body.code).toBe("TRAVTRACK_SHARE_REVOKED");
      await expectRevoked();
    });
  });

  describe("a revoke racing an automatic narrowing", () => {
    it("the narrowing never writes the route back", async () => {
      expect((await share()).status).toBe(200);
      await prisma.trip.update({
        where: { id: tripId },
        data: { endDate: new Date("2026-10-13T00:00:00Z"), endDay: new Date("2026-10-13") },
      });
      const { atHold, release } = armHold();
      const narrowing = prisma.$transaction((tx) => narrowShareSnapshots(tx, owner));
      await atHold;
      try {
        expect((await revoke()).status).toBe(204);
      } finally {
        release();
      }
      await narrowing;
      await expectRevoked();
    });
  });
});
