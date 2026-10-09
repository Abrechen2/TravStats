import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import * as routeLock from "../../services/roadtrip/lockRoute";

/**
 * forgejo#244 / forgejo#271: the web editor writes the WHOLE station list, the
 * phone appends ONE station ("Heute Nacht hier"). A list the web read before
 * the phone's append used to delete the appended station on its next autosave,
 * silently. `expectedStationIds` names the set the writer read; a different
 * stored set is refused with 409 and nothing is written.
 */
const USER = "stationsprecondition";

describe("PUT /roadtrips/:id/stations with expectedStationIds", () => {
  let cookie: string;
  let roadtripId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    const u = await prisma.user.create({
      data: { username: USER, passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(u.id)}`;
    const res = await request(app)
      .post("/api/v1/roadtrips")
      .set("Cookie", cookie)
      .send({ name: "Fjorde" });
    roadtripId = res.body.roadtrip.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: USER } });
    await prisma.$disconnect();
  });

  const BERGEN = {
    title: "Bergen",
    lat: 60.39,
    lon: 5.32,
    startDate: "2026-07-12",
    endDate: "2026-07-13",
    night: { kind: "free" },
  };
  const FLAM = {
    title: "Flåm",
    lat: 60.86,
    lon: 7.11,
    startDate: "2026-07-13",
    endDate: "2026-07-14",
    night: { kind: "free" },
  };

  const put = (body: Record<string, unknown>) =>
    request(app).put(`/api/v1/roadtrips/${roadtripId}/stations`).set("Cookie", cookie).send(body);

  it("refuses a list written against a set the phone has since added to, and writes nothing", async () => {
    const first = await put({ stations: [BERGEN, FLAM] });
    expect(first.status).toBe(200);
    const read: Array<{ id: string; title: string }> = first.body.stations;

    // The phone appends tonight's station.
    const appended = await request(app)
      .post(`/api/v1/roadtrips/${roadtripId}/stations`)
      .set("Cookie", cookie)
      .send({ lat: 61.0, lon: 7.5, date: "2026-07-14", night: "free", title: "Lærdal" });
    expect(appended.status).toBe(201);

    // The web, still on what it read, renames Bergen and writes the whole list.
    const stale = await put({
      stations: read.map((s) => ({
        ...(s.title === "Bergen" ? { ...BERGEN, title: "Bergen sentrum" } : FLAM),
        id: s.id,
      })),
      expectedStationIds: read.map((s) => s.id),
    });
    expect(stale.status).toBe(409);
    expect(stale.body.code).toBe("ROADTRIP_STATIONS_CHANGED");

    const detail = await request(app).get(`/api/v1/roadtrips/${roadtripId}`).set("Cookie", cookie);
    expect(detail.body.stations.map((s: { title: string }) => s.title)).toEqual([
      "Bergen",
      "Flåm",
      "Lærdal",
    ]);
  });

  it("writes when the stored set is the one that was read, new stations included", async () => {
    const detail = await request(app).get(`/api/v1/roadtrips/${roadtripId}`).set("Cookie", cookie);
    const current: Array<{ id: string; title: string; lat: number; lon: number }> =
      detail.body.stations;
    const res = await put({
      stations: [
        ...current.map((s) => ({
          id: s.id,
          title: s.title,
          lat: s.lat,
          lon: s.lon,
          night: { kind: "free" },
        })),
        { title: "Lom", lat: 61.84, lon: 8.57, night: { kind: "pass" } },
      ],
      expectedStationIds: current.map((s) => s.id),
    });
    expect(res.status).toBe(200);
    expect(res.body.stations).toHaveLength(4);
  });

  it("refuses a list whose writer still expects a station removed elsewhere", async () => {
    const detail = await request(app).get(`/api/v1/roadtrips/${roadtripId}`).set("Cookie", cookie);
    const ids: string[] = detail.body.stations.map((s: { id: string }) => s.id);
    // The phone takes its station back (its undo).
    const removed = await request(app)
      .delete(`/api/v1/roadtrips/${roadtripId}/stations/${ids[2]}`)
      .set("Cookie", cookie);
    expect(removed.status).toBe(200);

    const res = await put({
      stations: [BERGEN, FLAM].map((s, i) => ({ ...s, id: ids[i] })),
      expectedStationIds: ids,
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ROADTRIP_STATIONS_CHANGED");
  });

  // Review M2: a legacy station without a coordinate is in no editor's list.
  // Counting it made every write from the web 409, for good.
  it("does not count a legacy station without a coordinate against the writer's set", async () => {
    const placed = await put({ stations: [BERGEN, FLAM] });
    const ids: string[] = placed.body.stations.map((s: { id: string }) => s.id);
    await prisma.tripStop.create({
      data: { routeId: roadtripId, routeOrderIdx: 2, title: "Altlast", domain: "roadtrip" },
    });
    const res = await put({
      stations: [BERGEN, FLAM].map((s, i) => ({ ...s, id: ids[i] })),
      expectedStationIds: ids,
    });
    expect(res.status).toBe(200);
  });

  // Review M1: a station the phone appends while a list write is already
  // running must not be deleted by it. The write now takes the route's row lock
  // BEFORE it reads the stations; before, it read them first and only then
  // waited, so its precondition checked a set that was about to change.
  it("sees a station committed while it waited, and refuses instead of deleting it", async () => {
    const before = await request(app).get(`/api/v1/roadtrips/${roadtripId}`).set("Cookie", cookie);
    const ids: string[] = before.body.stations
      .filter((s: { lat: number | null }) => s.lat !== null)
      .map((s: { id: string }) => s.id);
    let release: () => void = () => {};
    const gate = new Promise<void>((r) => (release = r));
    // The "phone": holds the route, appends a station, commits on release.
    const phone = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM trip_routes WHERE id = ${roadtripId} FOR UPDATE`;
        await gate;
        await tx.tripStop.create({
          data: {
            routeId: roadtripId,
            routeOrderIdx: 99,
            title: "Vom Handy",
            lat: 61.5,
            lon: 7.5,
            domain: "roadtrip",
          },
        });
      },
      { timeout: 20_000 }
    );
    const write = put({
      stations: before.body.stations
        .filter((s: { lat: number | null }) => s.lat !== null)
        .map((s: { id: string; title: string; lat: number; lon: number }) => ({
          id: s.id,
          title: s.title || "x",
          lat: s.lat,
          lon: s.lon,
          night: { kind: "pass" },
        })),
      expectedStationIds: ids,
      // supertest sends only once it is awaited or `then`ed: start it now, so
      // it is already waiting on the route while the phone appends.
    }).then((r) => r);
    await new Promise((r) => setTimeout(r, 1000));
    release();
    await phone;
    const res = await write;
    expect(res.status).toBe(409);
    const after = await prisma.tripStop.count({
      where: { routeId: roadtripId, title: "Vom Handy" },
    });
    expect(after).toBe(1);
  });

  // The test above cannot tell the lock from the connection pool (the test
  // database serialises the two connections anyway), so the lock itself is
  // pinned here: every writer of the station list takes it.
  it("takes the route lock in all three writers: the list write, the append, the removal", async () => {
    const spy = jest.spyOn(routeLock, "lockRoute");
    try {
      const placed = await put({ stations: [BERGEN] });
      const added = await request(app)
        .post(`/api/v1/roadtrips/${roadtripId}/stations`)
        .set("Cookie", cookie)
        .send({ lat: 62.5, lon: 7.2, date: "2026-07-21", night: "pass", title: "Lock" });
      await request(app)
        .delete(`/api/v1/roadtrips/${roadtripId}/stations/${added.body.station.id}`)
        .set("Cookie", cookie);
      expect(placed.status).toBe(200);
      expect(spy).toHaveBeenCalledTimes(3);
      expect(spy.mock.calls.every((call) => call[1] === roadtripId)).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });

  it("serves a writer that names no expectation exactly as before", async () => {
    const res = await put({ stations: [BERGEN] });
    expect(res.status).toBe(200);
    expect(res.body.stations).toHaveLength(1);
  });
});
