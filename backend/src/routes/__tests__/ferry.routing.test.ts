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
const dep = { name: "Test harbour west", lat: 41.13656, lon: 16.8672687, country: "IT" };
const arr = { name: "Test harbour east", lat: 42.6637124, lon: 18.0813509, country: "HR" };
const line: Array<[number, number]> = [
  [dep.lon, dep.lat],
  [16.8291, 41.1676],
  [18.0047, 42.6272],
  [arr.lon, arr.lat],
];
let userId: string, otherId: string, cookie: string, otherCookie: string;
const routed = () => ({
  waypoints: line,
  protectedPrefixCount: 0,
  protectedSuffixCount: 0,
  routed: true,
  method: "maritime_graph" as const,
});
const post = (id: string, as = cookie) =>
  request(app).post(`/api/v1/ferry/${id}/route`).set("Cookie", as).send({});
/** A crossing that is still the straight line: since forgejo#323 a new crossing
 *  is routed on save, and this suite is about routing one that was not — the
 *  router found no way then, or failed. */
async function create(extra: Record<string, unknown> = {}) {
  jest.mocked(computeSchematicRoute).mockResolvedValueOnce({
    waypoints: [line[0], line[line.length - 1]],
    protectedPrefixCount: 0,
    protectedSuffixCount: 0,
    routed: false,
    method: "straight" as const,
  });
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
  // Count only the routing the test itself asks for.
  jest.mocked(computeSchematicRoute).mockClear();
  return r.body.data.id as string;
}
async function link(id: string) {
  const trip = await prisma.trip.create({ data: { userId, name: "Synthetic sea route" } });
  const route = await prisma.tripRoute.create({
    data: { userId, tripId: trip.id, name: "Synthetic coast", kind: "roadtrip", mode: "road" },
  });
  const a = await prisma.tripStop.create({
    data: {
      tripId: trip.id,
      routeId: route.id,
      title: "West",
      lat: dep.lat,
      lon: dep.lon,
      orderIdx: 0,
    },
  });
  const b = await prisma.tripStop.create({
    data: {
      tripId: trip.id,
      routeId: route.id,
      title: "East",
      lat: arr.lat,
      lon: arr.lon,
      orderIdx: 1,
    },
  });
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
  const result = await request(app)
    .put(`/api/v1/ferry/${id}/roadtrip-leg`)
    .set("Cookie", cookie)
    .send({ legId: leg.id });
  expect(result.status).toBe(200);
  return leg;
}
beforeAll(async () => {
  const user = await prisma.user.create({
    data: { username: "sea-routing-owner", passwordHash: "unused-test-hash" },
  });
  const other = await prisma.user.create({
    data: { username: "sea-routing-other", passwordHash: "unused-test-hash" },
  });
  userId = user.id;
  otherId = other.id;
  cookie = `auth_token=${generateToken(userId)}`;
  otherCookie = `auth_token=${generateToken(otherId)}`;
});
beforeEach(() => {
  jest.mocked(computeSchematicRoute).mockReset().mockResolvedValue(routed());
});
afterEach(async () => {
  await prisma.ferryJourney.deleteMany({ where: { userId } });
  await prisma.trip.deleteMany({ where: { userId } });
  await ferryCreationLimiter.resetKey(`user:${userId}`);
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
});

it("requires authentication and ownership before computing", async () => {
  const id = await create();
  expect((await request(app).post(`/api/v1/ferry/${id}/route`).send({})).status).toBe(401);
  expect((await post(id, otherCookie)).status).toBe(404);
  expect(computeSchematicRoute).not.toHaveBeenCalled();
});
it("stores a sea estimate and its linked leg atomically, and preserves it on note edits", async () => {
  const id = await create();
  const leg = await link(id);
  expect((await post(id)).body.data.outcome).toBe("routed");
  const ferry = await prisma.ferryJourney.findUniqueOrThrow({ where: { id } });
  expect(ferry).toMatchObject({
    geometrySource: "sea_route",
    distanceSource: "sea_route",
    geometry: line,
    distanceKm: 201.4,
  });
  expect(await prisma.tripRouteLeg.findUnique({ where: { id: leg.id } })).toMatchObject({
    source: "routed",
    mode: "ferry",
    confidence: "low",
    waypoints: line,
    distanceKm: 201.4,
    drivingMinutes: null,
  });
  const edit = await request(app)
    .patch(`/api/v1/ferry/${id}`)
    .set("Cookie", cookie)
    .send({ notes: "Edited later" });
  expect(edit.status).toBe(200);
  expect(edit.body.data).toMatchObject({
    geometrySource: "sea_route",
    distanceSource: "sea_route",
    distanceKm: 201.4,
  });
  expect((await post(id)).body.data.outcome).toBe("unchanged");
  expect(computeSchematicRoute).toHaveBeenCalledTimes(1);
});
it("preserves a ticket distance; clearing it uses the stored sea line", async () => {
  const id = await create({ distanceKm: 250 });
  await post(id);
  expect(await prisma.ferryJourney.findUnique({ where: { id } })).toMatchObject({
    distanceKm: 250,
    distanceSource: "user",
    geometrySource: "sea_route",
  });
  const edit = await request(app)
    .patch(`/api/v1/ferry/${id}`)
    .set("Cookie", cookie)
    .send({ distanceKm: null });
  expect(edit.status).toBe(200);
  expect(edit.body.data).toMatchObject({ distanceKm: 201.4, distanceSource: "sea_route" });
});
it("keeps a failed route and manual geometry unchanged", async () => {
  const id = await create();
  const before = await prisma.ferryJourney.findUnique({ where: { id } });
  jest
    .mocked(computeSchematicRoute)
    .mockResolvedValue({ ...routed(), routed: false, method: "direct" });
  expect((await post(id)).body.data.outcome).toBe("straight");
  expect(await prisma.ferryJourney.findUnique({ where: { id } })).toEqual(before);
  await prisma.ferryJourney.update({
    where: { id },
    data: { geometrySource: "manual", geometry: line },
  });
  jest.mocked(computeSchematicRoute).mockClear();
  expect((await post(id)).body.data.outcome).toBe("unchanged");
  expect(computeSchematicRoute).not.toHaveBeenCalled();
});
it("preserves a drawn linked leg", async () => {
  const id = await create();
  const leg = await link(id);
  await prisma.tripRouteLeg.update({
    where: { id: leg.id },
    data: { source: "drawn", waypoints: line, distanceKm: 220 },
  });
  expect((await post(id)).status).toBe(200);
  expect(await prisma.tripRouteLeg.findUnique({ where: { id: leg.id } })).toMatchObject({
    source: "drawn",
    distanceKm: 220,
  });
});
it("keeps an already routed crossing when linked afterwards", async () => {
  const id = await create();
  await post(id);
  const leg = await link(id);
  expect(await prisma.tripRouteLeg.findUnique({ where: { id: leg.id } })).toMatchObject({
    source: "routed",
    distanceKm: 201.4,
    waypoints: line,
  });
});
it("rejects concurrent edits during routing", async () => {
  const id = await create();
  jest.mocked(computeSchematicRoute).mockImplementationOnce(async () => {
    await prisma.ferryJourney.update({
      where: { id },
      data: { notes: "Concurrent edit", updatedAt: new Date(Date.now() + 1000) },
    });
    return routed();
  });
  expect((await post(id)).status).toBe(409);
  expect(await prisma.ferryJourney.findUnique({ where: { id } })).toMatchObject({
    geometrySource: "straight",
    notes: "Concurrent edit",
  });
});
it("rolls back the crossing when the linked sea leg has incompatible terminals", async () => {
  const id = await create();
  const leg = await link(id);
  await prisma.tripStop.update({ where: { id: leg.fromStopId }, data: { lat: 50 } });
  expect((await post(id)).status).toBe(409);
  expect(await prisma.ferryJourney.findUnique({ where: { id } })).toMatchObject({
    geometrySource: "straight",
  });
});
it("invalidates an unlinked sea line when a terminal moves", async () => {
  const id = await create();
  await post(id);
  const edit = await request(app)
    .patch(`/api/v1/ferry/${id}`)
    .set("Cookie", cookie)
    .send({ arrivalStation: { ...arr, lat: 43 } });
  expect(edit.status).toBe(200);
  expect(edit.body.data).toMatchObject({
    geometrySource: "straight",
    geometry: null,
    distanceSource: "great_circle",
  });
});
it("gives an unlinked leg its road routing back after a sea route replaced it", async () => {
  const id = await create();
  const leg = await link(id);
  await post(id);
  const unlink = await request(app)
    .put(`/api/v1/ferry/${id}/roadtrip-leg`)
    .set("Cookie", cookie)
    .send({ legId: null });
  expect(unlink.status).toBe(200);
  expect(await prisma.tripRouteLeg.findUnique({ where: { id: leg.id } })).toMatchObject({
    mode: "road",
    source: "straight",
    distanceKm: 197.3,
  });
});
it("answers a stale terminal edit on a linked crossing with the version conflict", async () => {
  const id = await create();
  await link(id);
  const stale = (await prisma.ferryJourney.findUniqueOrThrow({ where: { id } })).updatedAt;
  await request(app)
    .patch(`/api/v1/ferry/${id}`)
    .set("Cookie", cookie)
    .send({ notes: "Newer edit" })
    .expect(200);
  const res = await request(app)
    .patch(`/api/v1/ferry/${id}`)
    .set("Cookie", cookie)
    .send({ arrivalStation: { ...arr, lat: 43 }, baseVersion: stale.toISOString() });
  expect(res.status).toBe(409);
  expect(res.body.code).toBe("VERSION_CONFLICT");
});
it("does not write a stale chord over a sea route committed during an edit without a version", async () => {
  const id = await create();
  const real = prisma.$transaction.bind(prisma);
  const spy = jest
    .spyOn(prisma, "$transaction")
    .mockImplementationOnce(((fn: unknown, opts: unknown) =>
      post(id).then(() =>
        (real as (f: unknown, o: unknown) => Promise<unknown>)(fn, opts)
      )) as typeof prisma.$transaction);
  const edit = await request(app)
    .patch(`/api/v1/ferry/${id}`)
    .set("Cookie", cookie)
    .send({ notes: "Racing note" });
  spy.mockRestore();
  expect(edit.status).toBe(409);
  expect(await prisma.ferryJourney.findUnique({ where: { id } })).toMatchObject({
    geometrySource: "sea_route",
    distanceSource: "sea_route",
    distanceKm: 201.4,
  });
});
