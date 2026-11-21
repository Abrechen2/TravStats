import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { computeSchematicRoute } from "../../services/schematicRouter";
import { ferryCreationLimiter } from "../../middleware/ferryCreationLimiter";
import { polylineLengthKm } from "../../shared/geo/haversine";

jest.mock("../../services/schematicRouter", () => ({
  ...jest.requireActual("../../services/schematicRouter"),
  computeSchematicRoute: jest.fn(),
}));

const dep = { name: "Manual harbour west", lat: 41.13656, lon: 16.8672687, country: "IT" };
const arr = { name: "Manual harbour east", lat: 42.6637124, lon: 18.0813509, country: "HR" };
const via: Array<[number, number]> = [
  [16.9, 41.4],
  [17.6, 42.3],
];
const drawn = [[dep.lon, dep.lat], ...via, [arr.lon, arr.lat]];
const seaLine: Array<[number, number]> = [
  [dep.lon, dep.lat],
  [16.8291, 41.1676],
  [18.0047, 42.6272],
  [arr.lon, arr.lat],
];
const straight = {
  waypoints: [seaLine[0], seaLine[3]],
  protectedPrefixCount: 0,
  protectedSuffixCount: 0,
  routed: false,
  method: "direct" as const,
};
let userId: string, otherId: string, cookie: string, otherCookie: string;

const put = (id: string, waypoints: unknown, as = cookie) =>
  request(app).put(`/api/v1/ferry/${id}/route-override`).set("Cookie", as).send({ waypoints });
const del = (id: string, as = cookie) =>
  request(app).delete(`/api/v1/ferry/${id}/route-override`).set("Cookie", as);

async function create(extra: Record<string, unknown> = {}) {
  jest.mocked(computeSchematicRoute).mockResolvedValueOnce(straight);
  const r = await request(app)
    .post("/api/v1/ferry")
    .set("Cookie", cookie)
    .send({
      departureStation: dep,
      arrivalStation: arr,
      departureLocal: "2025-10-09T10:00",
      arrivalLocal: "2025-10-09T18:00",
      ...extra,
    });
  expect(r.status).toBe(201);
  jest.mocked(computeSchematicRoute).mockClear();
  return r.body.data.id as string;
}

beforeAll(async () => {
  userId = (
    await prisma.user.create({ data: { username: "manual-route-owner", passwordHash: "x" } })
  ).id;
  otherId = (
    await prisma.user.create({ data: { username: "manual-route-other", passwordHash: "x" } })
  ).id;
  cookie = `auth_token=${generateToken(userId)}`;
  otherCookie = `auth_token=${generateToken(otherId)}`;
});
beforeEach(() => {
  jest.mocked(computeSchematicRoute).mockReset().mockResolvedValue(straight);
});
afterEach(async () => {
  await prisma.ferryJourney.deleteMany({ where: { userId } });
  await ferryCreationLimiter.resetKey(`user:${userId}`);
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
});

it("sets a manual line, with the length taken from the polyline", async () => {
  const id = await create();
  const res = await put(id, drawn);
  expect(res.status).toBe(200);
  const row = await prisma.ferryJourney.findUniqueOrThrow({ where: { id } });
  const km = polylineLengthKm(drawn.map(([lon, lat]) => ({ lat, lon })));
  expect(row).toMatchObject({
    geometrySource: "manual",
    geometry: drawn,
    distanceSource: "sea_route",
    distanceKm: Math.round(km * 10) / 10,
  });
});

it("snaps the line's ends onto the terminals", async () => {
  const id = await create();
  const near = [[dep.lon + 0.002, dep.lat], ...via, [arr.lon, arr.lat - 0.002]];
  expect((await put(id, near)).status).toBe(200);
  expect((await prisma.ferryJourney.findUniqueOrThrow({ where: { id } })).geometry).toEqual(drawn);
});

it("keeps a typed distance when the line is drawn", async () => {
  const id = await create({ distanceKm: 250 });
  await put(id, drawn);
  expect(await prisma.ferryJourney.findUniqueOrThrow({ where: { id } })).toMatchObject({
    geometrySource: "manual",
    distanceKm: 250,
    distanceSource: "user",
  });
});

it("refuses a line that does not start and end at the terminals, with its own code", async () => {
  const id = await create();
  const res = await put(id, [[10, 40], ...via, [arr.lon, arr.lat]]);
  expect(res.status).toBe(400);
  expect(res.body.code).toBe("FERRY_ROUTE_NOT_ANCHORED");
  expect((await prisma.ferryJourney.findUniqueOrThrow({ where: { id } })).geometrySource).toBe(
    "straight"
  );
});

it("refuses too few, too many and out-of-range points with FERRY_ROUTE_INVALID", async () => {
  const id = await create();
  for (const bad of [
    [drawn[0], drawn[3]],
    [drawn[0], ...Array.from({ length: 70 }, () => via[0]), drawn[3]],
    [drawn[0], [200, 10], drawn[3]],
    "nope",
  ]) {
    const res = await put(id, bad);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("FERRY_ROUTE_INVALID");
  }
});

it("refuses a line absurdly longer than the crossing", async () => {
  const id = await create();
  const loop = [drawn[0], [-170, 60], [170, -60], [-170, 60], [170, -60], drawn[3]];
  const res = await put(id, loop);
  expect(res.status).toBe(400);
  expect(res.body.code).toBe("FERRY_ROUTE_INVALID");
});

it("answers 404 for another user's crossing and 401 without a login", async () => {
  const id = await create();
  expect((await put(id, drawn, otherCookie)).status).toBe(404);
  expect((await del(id, otherCookie)).status).toBe(404);
  expect(
    (await request(app).put(`/api/v1/ferry/${id}/route-override`).send({ waypoints: drawn })).status
  ).toBe(401);
});

it("a re-route never overwrites a manual line", async () => {
  const id = await create();
  await put(id, drawn);
  jest.mocked(computeSchematicRoute).mockResolvedValue({
    waypoints: seaLine,
    protectedPrefixCount: 0,
    protectedSuffixCount: 0,
    routed: true,
    method: "maritime_graph" as const,
  });
  const res = await request(app).post(`/api/v1/ferry/${id}/route`).set("Cookie", cookie).send({});
  expect(res.body.data.outcome).toBe("unchanged");
  const row = await prisma.ferryJourney.findUniqueOrThrow({ where: { id } });
  expect(row).toMatchObject({ geometrySource: "manual", geometry: drawn });
});

it("an edit that leaves the terminals alone keeps the manual line and its length", async () => {
  const id = await create();
  await put(id, drawn);
  const before = await prisma.ferryJourney.findUniqueOrThrow({ where: { id } });
  const edit = await request(app)
    .patch(`/api/v1/ferry/${id}`)
    .set("Cookie", cookie)
    .send({ notes: "later" });
  expect(edit.status).toBe(200);
  const after = await prisma.ferryJourney.findUniqueOrThrow({ where: { id } });
  expect(after).toMatchObject({ geometrySource: "manual", geometry: drawn });
  expect(after.distanceKm).toBe(before.distanceKm);
});

it("clearing returns to the routed geometry", async () => {
  const id = await create();
  await put(id, drawn);
  jest.mocked(computeSchematicRoute).mockResolvedValue({
    waypoints: seaLine,
    protectedPrefixCount: 0,
    protectedSuffixCount: 0,
    routed: true,
    method: "maritime_graph" as const,
  });
  const res = await del(id);
  expect(res.status).toBe(200);
  expect(res.body.meta.seaRoute).toBe("routed");
  expect(await prisma.ferryJourney.findUniqueOrThrow({ where: { id } })).toMatchObject({
    geometrySource: "sea_route",
    geometry: seaLine,
  });
});

it("clearing with no sea route available falls back to the chord and its length", async () => {
  const id = await create();
  await put(id, drawn);
  const res = await del(id);
  expect(res.body.meta.seaRoute).toBe("straight");
  const row = await prisma.ferryJourney.findUniqueOrThrow({ where: { id } });
  expect(row).toMatchObject({ geometrySource: "straight", distanceSource: "great_circle" });
  expect(row.geometry).toBeNull();
  expect(row.distanceKm).toBeLessThan(polylineLengthKm(drawn.map(([lon, lat]) => ({ lat, lon }))));
});

it("clearing a crossing that has no manual line changes nothing", async () => {
  const id = await create();
  const res = await del(id);
  expect(res.status).toBe(200);
  expect(res.body.meta.seaRoute).toBe("unchanged");
  expect(computeSchematicRoute).not.toHaveBeenCalled();
});

it("moving a terminal drops the manual line, which no longer fits", async () => {
  const id = await create();
  await put(id, drawn);
  const res = await request(app)
    .patch(`/api/v1/ferry/${id}`)
    .set("Cookie", cookie)
    .send({ arrivalStation: { ...arr, lat: 42.5, lon: 18.0 } });
  expect(res.status).toBe(200);
  expect((await prisma.ferryJourney.findUniqueOrThrow({ where: { id } })).geometrySource).not.toBe(
    "manual"
  );
});

it("carries the manual line onto a linked roadtrip leg", async () => {
  const id = await create();
  const trip = await prisma.trip.create({ data: { userId, name: "Manual line trip" } });
  const route = await prisma.tripRoute.create({
    data: { userId, tripId: trip.id, name: "Coast", kind: "roadtrip", mode: "road" },
  });
  const mk = (title: string, p: { lat: number; lon: number }, orderIdx: number) =>
    prisma.tripStop.create({
      data: { tripId: trip.id, routeId: route.id, title, lat: p.lat, lon: p.lon, orderIdx },
    });
  const a = await mk("W", dep, 0);
  const b = await mk("E", arr, 1);
  const leg = await prisma.tripRouteLeg.create({
    data: {
      routeId: route.id,
      fromStopId: a.id,
      toStopId: b.id,
      mode: "road",
      source: "straight",
      distanceKm: 197.3,
    },
  });
  await request(app)
    .put(`/api/v1/ferry/${id}/roadtrip-leg`)
    .set("Cookie", cookie)
    .send({ legId: leg.id });
  await put(id, drawn);
  expect(await prisma.tripRouteLeg.findUnique({ where: { id: leg.id } })).toMatchObject({
    mode: "ferry",
    waypoints: drawn,
  });
  await prisma.ferryJourney.deleteMany({ where: { userId } });
  await prisma.trip.deleteMany({ where: { userId } });
});

it("refuses a save from an editor that opened an older version of the crossing", async () => {
  const id = await create();
  const opened = (await prisma.ferryJourney.findUniqueOrThrow({ where: { id } })).updatedAt;
  expect((await put(id, drawn)).status).toBe(200);
  const stale = await request(app)
    .put(`/api/v1/ferry/${id}/route-override`)
    .set("Cookie", cookie)
    .send({ waypoints: [drawn[0], [17.0, 41.2], [17.5, 42.0], drawn[3]], baseVersion: opened });
  expect(stale.status).toBe(409);
  expect((await prisma.ferryJourney.findUniqueOrThrow({ where: { id } })).geometry).toEqual(drawn);
});

it("refuses a globe-spanning line on terminals less than 500 m apart", async () => {
  const id = await create({
    departureStation: { ...dep, name: "Quay A" },
    arrivalStation: { ...dep, name: "Quay B", lat: dep.lat + 0.001 },
  });
  const res = await put(id, [
    [dep.lon, dep.lat],
    [-100, 10],
    [dep.lon, dep.lat + 0.001],
  ]);
  expect(res.status).toBe(400);
  expect(res.body.code).toBe("FERRY_ROUTE_INVALID");
});
