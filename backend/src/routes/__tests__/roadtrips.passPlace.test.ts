import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { importSheets } from "../../services/xlsxImport/importSheets";

/**
 * A pass-through station names the place it passed (tester 2026-09-26): as a
 * stay station picks its stay, a "Durchfahrt" picks one of the user's own
 * places (POI). The link must be the caller's, must survive a spreadsheet
 * import, and is refused on anything that is not a pass-through.
 */
const USERS = ["passplacer", "passplacestranger"];

describe("Roadtrip pass-through linked to a place", () => {
  let cookie: string;
  let userId: string;
  let roadtripId: string;
  let placeId: string;
  let strangerPlaceId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    const u = await prisma.user.create({
      data: { username: USERS[0], passwordHash: await hashPassword("password123") },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
    const s = await prisma.user.create({
      data: { username: USERS[1], passwordHash: await hashPassword("password123") },
    });
    placeId = (
      await prisma.place.create({
        data: { userId, name: "Trollstigen", category: "viewpoint", lat: 62.45, lon: 7.67 },
      })
    ).id;
    strangerPlaceId = (
      await prisma.place.create({
        data: { userId: s.id, name: "Fremder Ort", lat: 62.4, lon: 7.6 },
      })
    ).id;
    const res = await request(app)
      .post("/api/v1/roadtrips")
      .set("Cookie", cookie)
      .send({ name: "Fjorde" });
    roadtripId = res.body.roadtrip.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: USERS } } });
    await prisma.$disconnect();
  });

  const put = (stations: unknown[]) =>
    request(app)
      .put(`/api/v1/roadtrips/${roadtripId}/stations`)
      .set("Cookie", cookie)
      .send({ stations });

  const ALESUND = {
    title: "Ålesund",
    lat: 62.47,
    lon: 6.15,
    startDate: "2026-07-10",
    endDate: "2026-07-11",
    night: { kind: "free" },
  };

  it("links a pass-through to the caller's place and names it back", async () => {
    const res = await put([
      ALESUND,
      { title: "Trollstigen", lat: 62.45, lon: 7.67, night: { kind: "pass", placeId } },
    ]);
    expect(res.status).toBe(200);
    expect(res.body.stations[1]).toMatchObject({
      state: "pass",
      placeId,
      place: { id: placeId, name: "Trollstigen", category: "viewpoint" },
    });
    const detail = await request(app).get(`/api/v1/roadtrips/${roadtripId}`).set("Cookie", cookie);
    expect(detail.body.stations[1].place.name).toBe("Trollstigen");
  });

  it("refuses someone else's place with 404, and a place on a night", async () => {
    const foreign = await put([
      ALESUND,
      { title: "x", lat: 62.4, lon: 7.6, night: { kind: "pass", placeId: strangerPlaceId } },
    ]);
    expect(foreign.status).toBe(404);
    const onNight = await put([{ ...ALESUND, night: { kind: "free", placeId } }]);
    expect(onNight.status).toBe(400);
  });

  it("keeps the link when a spreadsheet re-import names the station as a pass-through", async () => {
    await put([
      ALESUND,
      { title: "Trollstigen", lat: 62.45, lon: 7.67, night: { kind: "pass", placeId } },
    ]);
    const stations = await prisma.tripStop.findMany({
      where: { routeId: roadtripId },
      orderBy: { routeOrderIdx: "asc" },
    });
    const [outcome] = await importSheets(
      [
        {
          key: "roadtripStations",
          rows: [
            {
              id: stations[1].id,
              roadtripId: `Fjorde [${roadtripId}]`,
              order: "2",
              title: "Trollstigen (Passhöhe)",
              lat: "62.45",
              lon: "7.67",
              night: "pass",
            },
          ],
        },
      ],
      { userId, mode: "merge", dryRun: false }
    );
    expect(outcome).toMatchObject({ errors: 0 });
    const after = await prisma.tripStop.findUniqueOrThrow({ where: { id: stations[1].id } });
    expect(after.title).toBe("Trollstigen (Passhöhe)");
    expect(after.placeId).toBe(placeId);
  });

  it("keeps the station as a pass-through when its place is deleted", async () => {
    await prisma.place.delete({ where: { id: placeId } });
    const detail = await request(app).get(`/api/v1/roadtrips/${roadtripId}`).set("Cookie", cookie);
    expect(detail.body.stations[1]).toMatchObject({ state: "pass", placeId: null, place: null });
  });
});
