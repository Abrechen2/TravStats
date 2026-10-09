import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

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

  it("serves a writer that names no expectation exactly as before", async () => {
    const res = await put({ stations: [BERGEN] });
    expect(res.status).toBe(200);
    expect(res.body.stations).toHaveLength(1);
  });
});
