import request from "supertest";

import app from "../../index";
import { observeQueries, prisma, type ObservedQuery } from "../../db";
import { generateToken } from "../../utils/jwt";
import { distanceM } from "../../services/travtrack/classify";
import { deleteTravTrackRange } from "../../services/travtrack/deleteRange";
import { segmentCrossesZone, type LonLat } from "../../services/travtrack/privacyCut";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import {
  makeFlight,
  makeTrip,
  makeUser,
  storePoint,
  wipeTravTrack,
} from "../../services/travtrack/__tests__/fixtures";

/**
 * A shared route is selected ONCE, by the owner (Codex review of T7): every
 * later change — a deletion, a zone, a home, a trip's days, a flight — may
 * only take away from what was stored, and a recipient's read serves that
 * stored geometry filtered, never raw points selected again. A revoke always
 * wins over an automatic change running beside it.
 */

const PREFIX = "travtrack-share-stored-";
const MIN = 60_000;
// The Seoul fixture trip runs 11–14 Oct on Asia/Seoul: 10 Oct 15:00Z to 14 Oct 15:00Z.
const T0 = Date.parse("2026-10-12T03:00:00Z");
const HOME = { lat: 37.5, lon: 127.0 };

type Geometry = LonLat[][];

const vertices = (g: Geometry) => g.flat();
const near = (g: Geometry, c: { lat: number; lon: number }, m: number) =>
  vertices(g).some((p) => distanceM({ lon: p[0], lat: p[1] }, c) <= m);
const crosses = (g: Geometry, circle: { lat: number; lon: number; radiusM: number }) =>
  g.some((line) => line.some((p, k) => k > 0 && segmentCrossesZone(line[k - 1], p, circle)));

/** Every query on the raw point table, while `run` runs. */
async function pointQueries(run: () => Promise<unknown>): Promise<ObservedQuery[]> {
  const seen: ObservedQuery[] = [];
  const stop = observeQueries((q) => {
    if (q.model === "TravTrackPoint") seen.push(q);
  });
  try {
    await run();
  } finally {
    stop();
  }
  return seen;
}

describe("TravTrack — a shared route is selected once and only ever narrowed", () => {
  const switches = travTrackSwitches();
  let owner: string;
  let recipient: string;
  let stranger: string;
  let ownerCookie: string;
  let recipientCookie: string;
  let tripId: string;
  let copyId: string;

  const walk = async (fromLon = 126.95, toLon = 127.06, startMs = T0) => {
    const steps = Math.round((toLon - fromLon) / 0.002);
    for (let i = 0; i <= steps; i++) {
      await storePoint(owner, { t: startMs + i * MIN, lat: 37.5, lon: fromLon + i * 0.002 });
    }
  };

  const share = async () => {
    const res = await request(app)
      .put(`/api/v1/trips/${tripId}/share-snapshot`)
      .set("Cookie", ownerCookie);
    expect(res.status).toBe(200);
    return res.body.snapshot as { version: number; geometry: Geometry };
  };

  const stored = () =>
    prisma.travTrackShareSnapshot.findUnique({
      where: { tripId },
      select: { id: true, version: true, geometry: true },
    });

  const recipientRead = async (): Promise<Geometry | null> => {
    const res = await request(app)
      .get(`/api/v1/trips/${copyId}/shared-route`)
      .set("Cookie", recipientCookie);
    if (res.status === 404) return null;
    expect(res.status).toBe(200);
    return (res.body.routes as Array<{ geometry: Geometry }>).flatMap((r) => r.geometry);
  };

  const moveHome = (to: { lat: number; lon: number }) =>
    request(app)
      .put("/api/v1/settings/personal")
      .set("Cookie", ownerCookie)
      .send({ homePlace: { name: "Neu", ...to, zone: null } })
      .expect(200);

  beforeAll(async () => {
    owner = await makeUser(`${PREFIX}owner`);
    recipient = await makeUser(`${PREFIX}recipient`);
    stranger = await makeUser(`${PREFIX}stranger`);
    ownerCookie = `auth_token=${generateToken(owner)}`;
    recipientCookie = `auth_token=${generateToken(recipient)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await wipeTravTrack([owner, recipient, stranger]);
    await prisma.flight.deleteMany({ where: { userId: owner } });
    await prisma.trip.deleteMany({ where: { userId: { in: [owner, recipient, stranger] } } });
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

  it("a revoke committed while an automatic change is under way stays a revoke", async () => {
    await walk();
    await share();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    let deleted!: () => void;
    const deleting = new Promise<void>((resolve) => (deleted = resolve));
    let armed = false;
    let writing!: () => void;
    const writeSeen = new Promise<void>((resolve) => (writing = resolve));
    const stop = observeQueries((q) => {
      const write = !["findMany", "findFirst", "findUnique", "count"].includes(q.operation);
      if (armed && q.model === "TravTrackShareSnapshot" && write) writing();
    });
    // The revoke, held open: its delete is done, its commit waits on the gate.
    const revoke = prisma.$transaction(
      async (tx) => {
        await tx.travTrackShareSnapshot.deleteMany({ where: { tripId, userId: owner } });
        deleted();
        await gate;
      },
      { timeout: 30_000 }
    );
    await deleting;
    armed = true;
    // An automatic change that removes one minute inside the trip.
    const automatic = deleteTravTrackRange(owner, new Date(T0 + 30 * MIN), new Date(T0 + 31 * MIN));
    // Let it reach its write (which waits on the revoke's row lock), then commit the revoke.
    await Promise.race([writeSeen, new Promise((resolve) => setTimeout(resolve, 3_000))]);
    await new Promise((resolve) => setTimeout(resolve, 200));
    release();
    await revoke;
    await automatic;
    stop();
    expect(await stored()).toBeNull();
    expect(await recipientRead()).toBeNull();
  });

  it("a flight deleted after sharing does not uncover the hours it held", async () => {
    // 01:30Z onwards; the fixture flight's recorder window runs to 02:00Z.
    await walk(126.95, 127.06, Date.parse("2026-10-12T01:30:00Z"));
    const flightId = await makeFlight(owner);
    await prisma.flight.update({ where: { id: flightId }, data: { tripId } });
    await share();
    const west = (g: Geometry) => vertices(g).some((p) => p[0] < 126.985);
    expect(west((await recipientRead()) ?? [])).toBe(false);
    await prisma.flight.delete({ where: { id: flightId } });
    expect(west((await recipientRead()) ?? [])).toBe(false);
    // An automatic change after it takes away, and still adds nothing.
    await deleteTravTrackRange(owner, new Date(T0 + 50 * MIN), new Date(T0 + 51 * MIN));
    expect(west((await recipientRead()) ?? [])).toBe(false);
    expect(west((await stored())?.geometry as Geometry)).toBe(false);
  });

  it("a flight moved out of the trip after sharing does not uncover the hours it held", async () => {
    await walk(126.95, 127.06, Date.parse("2026-10-12T01:30:00Z"));
    const flightId = await makeFlight(owner);
    await prisma.flight.update({ where: { id: flightId }, data: { tripId } });
    await share();
    await prisma.flight.update({ where: { id: flightId }, data: { tripId: null } });
    await moveHome({ lat: 37.9, lon: 127.9 });
    const west = (g: Geometry) => vertices(g).some((p) => p[0] < 126.985);
    expect(west((await recipientRead()) ?? [])).toBe(false);
  });

  it("an automatic change never reads the raw points again", async () => {
    await walk();
    await share();
    // A cap of raw points is no bound once rows go: nothing may be selected anew.
    const onDelete = await pointQueries(() =>
      deleteTravTrackRange(owner, new Date(T0), new Date(T0 + 5 * MIN))
    );
    expect(onDelete.filter((q) => q.operation !== "deleteMany")).toEqual([]);
    const onHome = await pointQueries(() => moveHome({ lat: 37.5, lon: 127.04 }));
    expect(onHome).toEqual([]);
    const onTrip = await pointQueries(() =>
      request(app)
        .patch(`/api/v1/trips/${tripId}`)
        .set("Cookie", ownerCookie)
        .send({ startDate: "2026-10-12", endDate: "2026-10-14" })
        .expect(200)
    );
    expect(onTrip).toEqual([]);
  });

  it("deleting early points does not pull later points into the route", async () => {
    await walk();
    const first = await share();
    const eastmost = Math.max(...vertices(first.geometry).map((p) => p[0]));
    await deleteTravTrackRange(owner, new Date(T0), new Date(T0 + 20 * MIN));
    const after = (await stored())?.geometry as Geometry;
    expect(Math.max(...vertices(after).map((p) => p[0]))).toBeLessThanOrEqual(eastmost);
    expect(vertices(after).length).toBeLessThan(vertices(first.geometry).length);
  });

  it("a recipient's read costs the stored geometry, not the raw history", async () => {
    await walk();
    await share();
    const seen = await pointQueries(async () => {
      expect(await recipientRead()).not.toBeNull();
    });
    expect(seen).toEqual([]);
  });

  it("a home changed twice keeps every home it passed hidden", async () => {
    await walk();
    await share();
    const second = { lat: 37.5, lon: 127.04 };
    // Written past every hook, then moved on through the settings.
    await prisma.userSettings.update({
      where: { userId: owner },
      data: { homePlace: { name: "Zweites", ...second } },
    });
    const third = { lat: 37.9, lon: 127.9 };
    await moveHome(third);
    const read = (await recipientRead()) ?? [];
    const storedGeometry = (await stored())?.geometry as Geometry;
    for (const g of [read, storedGeometry]) {
      for (const home of [HOME, second]) {
        expect(near(g, home, 1000)).toBe(false);
        expect(crosses(g, { ...home, radiusM: 1000 })).toBe(false);
      }
    }
  });

  it("a deleted span the stored chords stepped over still breaks the route", async () => {
    // Four fixes along a straight line: simplification keeps only the ends.
    for (let i = 0; i <= 3; i++) {
      await storePoint(owner, { t: T0 + i * MIN, lat: 37.6, lon: 127.1 + i * 0.01 });
    }
    const first = await share();
    expect(vertices(first.geometry)).toHaveLength(2);
    await deleteTravTrackRange(owner, new Date(T0 + MIN), new Date(T0 + 2 * MIN + 1));
    expect(await recipientRead()).toBeNull();
  });

  it("a snapshot stored without vertex times is served to nobody until shared again", async () => {
    await walk();
    await share();
    const row = await stored();
    const untimed = (row?.geometry as number[][][]).map((l) => l.map((v) => [v[0], v[1]]));
    await prisma.travTrackShareSnapshot.update({
      where: { tripId },
      data: { geometry: untimed },
    });
    expect(await recipientRead()).toBeNull();
    const own = await request(app)
      .get(`/api/v1/trips/${tripId}/share-snapshot`)
      .set("Cookie", ownerCookie);
    expect(own.body.snapshot?.geometry ?? []).toEqual([]);
    await share();
    expect(await recipientRead()).not.toBeNull();
  });

  it("a recipient's reads are rate-limited", async () => {
    const strangerTrip = await makeTrip(stranger);
    const cookie = `auth_token=${generateToken(stranger)}`;
    let status = 0;
    for (let i = 0; i < 80 && status !== 429; i++) {
      const res = await request(app)
        .get(`/api/v1/trips/${strangerTrip}/shared-route`)
        .set("Cookie", cookie);
      status = res.status;
    }
    expect(status).toBe(429);
  });
});
