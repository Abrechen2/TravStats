import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { computeSchematicRoute } from "../../services/schematicRouter";
import { ferryCreationLimiter } from "../../middleware/ferryCreationLimiter";

jest.mock("../../services/schematicRouter", () => ({
  ...jest.requireActual("../../services/schematicRouter"),
  computeSchematicRoute: jest.fn(),
}));

/**
 * One crossing is drawn by two maps from two tables: the ferry layer / detail
 * page read the crossing's own line, the tour layer reads the linked roadtrip
 * leg's line. After a hand edit on EITHER side both must answer with the same
 * line - the owner saw the old line on the dashboard after redrawing it on the
 * ferry page.
 */
const dep = { name: "Parity harbour west", lat: 41.13656, lon: 16.8672687, country: "IT" };
const arr = { name: "Parity harbour east", lat: 42.6637124, lon: 18.0813509, country: "HR" };
const seaLine: Array<[number, number]> = [
  [dep.lon, dep.lat],
  [16.8291, 41.1676],
  [18.0047, 42.6272],
  [arr.lon, arr.lat],
];
const chord = {
  waypoints: [seaLine[0], seaLine[3]],
  protectedPrefixCount: 0,
  protectedSuffixCount: 0,
  routed: false,
  method: "direct" as const,
};
const viaA: Array<[number, number]> = [
  [16.9, 41.4],
  [17.6, 42.3],
];
const viaB: Array<[number, number]> = [
  [17.1, 41.2],
  [17.9, 42.0],
];
const withEnds = (via: Array<[number, number]>) => [[dep.lon, dep.lat], ...via, [arr.lon, arr.lat]];

let userId: string, cookie: string;

async function linkedCrossing(legSource: "straight" | "drawn" | "track") {
  jest.mocked(computeSchematicRoute).mockResolvedValue(chord);
  const created = await request(app).post("/api/v1/ferry").set("Cookie", cookie).send({
    departureStation: dep,
    arrivalStation: arr,
    departureLocal: "2025-10-09T10:00",
    arrivalLocal: "2025-10-09T18:00",
  });
  expect(created.status).toBe(201);
  const id = created.body.data.id as string;
  const trip = await prisma.trip.create({ data: { userId, name: "Parity trip" } });
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
  if (legSource !== "straight")
    await prisma.tripRouteLeg.update({
      where: { id: leg.id },
      data: { source: legSource, waypoints: withEnds(viaA) },
    });
  return { id, routeId: route.id, a, b, legId: leg.id };
}

/** What each map's data path answers for the crossing. */
async function bothLines(id: string, routeId: string) {
  const list = await request(app).get("/api/v1/ferry?limit=500").set("Cookie", cookie);
  const ferry = list.body.data.find((j: { id: string }) => j.id === id);
  const tours = await request(app)
    .post("/api/v1/tours/geometry/batch")
    .set("Cookie", cookie)
    .send({ ids: [routeId] });
  const feature = tours.body.data[routeId].features[0];
  return {
    ferry: ferry.geometry,
    ferrySource: ferry.geometrySource,
    tour: feature.geometry.coordinates,
  };
}

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { username: "leg-parity-owner", passwordHash: "x" } }))
    .id;
  cookie = `auth_token=${generateToken(userId)}`;
});
afterEach(async () => {
  await prisma.ferryJourney.deleteMany({ where: { userId } });
  await prisma.trip.deleteMany({ where: { userId } });
  await ferryCreationLimiter.resetKey(`user:${userId}`);
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
});

it("a line drawn on the ferry page replaces the line the tour editor drew on the linked leg", async () => {
  const { id, routeId } = await linkedCrossing("drawn");
  const put = await request(app)
    .put(`/api/v1/ferry/${id}/route-override`)
    .set("Cookie", cookie)
    .send({ waypoints: withEnds(viaB) });
  expect(put.status).toBe(200);
  const lines = await bothLines(id, routeId);
  expect(lines.ferry).toEqual(withEnds(viaB));
  expect(lines.tour).toEqual(lines.ferry);
});

it("a line drawn on the ferry page outranks a recording adopted on the linked leg", async () => {
  const { id, routeId } = await linkedCrossing("track");
  await request(app)
    .put(`/api/v1/ferry/${id}/route-override`)
    .set("Cookie", cookie)
    .send({ waypoints: withEnds(viaB) });
  const lines = await bothLines(id, routeId);
  expect(lines.tour).toEqual(lines.ferry);
});

it("a line drawn on the leg in the tour editor reaches the linked crossing", async () => {
  const { id, routeId, a, b } = await linkedCrossing("straight");
  const put = await request(app)
    .put(
      `/api/v1/trips/${(await prisma.tripRoute.findUniqueOrThrow({ where: { id: routeId } })).tripId}/routes/${routeId}/legs/${a.id}/${b.id}`
    )
    .set("Cookie", cookie)
    .send({ source: "drawn", waypoints: withEnds(viaB) });
  expect(put.status).toBe(200);
  const lines = await bothLines(id, routeId);
  expect(lines.ferrySource).toBe("manual");
  expect(lines.ferry).toEqual(withEnds(viaB));
  expect(lines.tour).toEqual(lines.ferry);
});

it("dropping the ferry's drawn line clears the drawn line on the linked leg too", async () => {
  const { id, routeId } = await linkedCrossing("drawn");
  await request(app)
    .put(`/api/v1/ferry/${id}/route-override`)
    .set("Cookie", cookie)
    .send({ waypoints: withEnds(viaB) });
  await request(app).delete(`/api/v1/ferry/${id}/route-override`).set("Cookie", cookie);
  const lines = await bothLines(id, routeId);
  // The crossing is a chord again (the router is mocked straight); a drawn leg
  // must not keep a line the crossing no longer has.
  expect(lines.ferry).toBeNull();
  expect(lines.tour).toEqual([seaLine[0], seaLine[3]]);
});
