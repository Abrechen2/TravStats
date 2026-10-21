import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { computeSchematicRoute } from "../../services/schematicRouter";
import { ferryCreationLimiter } from "../../middleware/ferryCreationLimiter";
import { importSheets } from "../../services/xlsxImport/importSheets";

/**
 * forgejo#323, owner UAT: a ferry added by hand was drawn as a straight line —
 * Kiel–Oslo straight across Denmark and Sweden. The sea router existed and
 * cruises used it on their own, but a crossing only got it from a button on
 * its detail page, and moving a terminal dropped it back to the chord. A
 * crossing is now routed when it is created, when a terminal moves and when a
 * spreadsheet writes it. Routing is best effort AFTER the save: no sea route
 * (a short hop across open water) or a router failure leaves the chord, which
 * the map draws faint, and never loses the crossing.
 */

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
const routed = (waypoints = line) => ({
  waypoints,
  protectedPrefixCount: 0,
  protectedSuffixCount: 0,
  routed: true,
  method: "maritime_graph" as const,
});
const unrouted = () => ({
  waypoints: [line[0], line[3]],
  protectedPrefixCount: 0,
  protectedSuffixCount: 0,
  routed: false,
  method: "straight" as const,
});

let userId: string;
let cookie: string;

const create = (extra: Record<string, unknown> = {}) =>
  request(app)
    .post("/api/v1/ferry")
    .set("Cookie", cookie)
    .send({
      departureStation: dep,
      arrivalStation: arr,
      departureLocal: "2025-10-09T10:00",
      arrivalLocal: "2025-10-09T18:00",
      ...extra,
    });

const sheetRow = {
  id: "",
  depStationName: dep.name,
  depLat: String(dep.lat),
  depLon: String(dep.lon),
  arrStationName: arr.name,
  arrLat: String(arr.lat),
  arrLon: String(arr.lon),
  departureTime: "2025-10-09T08:00:00.000Z",
  arrivalTime: "2025-10-09T16:00:00.000Z",
};

beforeAll(async () => {
  await prisma.user.deleteMany({ where: { username: "sea-autoroute-owner" } });
  const user = await prisma.user.create({
    data: { username: "sea-autoroute-owner", passwordHash: "unused-test-hash" },
  });
  userId = user.id;
  cookie = `auth_token=${generateToken(userId)}`;
});
beforeEach(() => {
  jest.mocked(computeSchematicRoute).mockReset().mockResolvedValue(routed());
});
afterEach(async () => {
  await prisma.ferryJourney.deleteMany({ where: { userId } });
  await ferryCreationLimiter.resetKey(`user:${userId}`);
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
});

describe("a crossing follows the sea from the start (forgejo#323)", () => {
  it("routes a crossing added by hand and answers with the sea line", async () => {
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      geometrySource: "sea_route",
      geometry: line,
      distanceSource: "sea_route",
      distanceKm: 201.4,
    });
    expect(res.body.meta).toEqual({ seaRoute: "routed" });
    expect(computeSchematicRoute).toHaveBeenCalledTimes(1);
  });

  it("keeps the ticket's distance and still draws the sea line", async () => {
    const res = await create({ distanceKm: 250 });
    expect(res.body.data).toMatchObject({
      geometrySource: "sea_route",
      distanceKm: 250,
      distanceSource: "user",
    });
  });

  it("saves a crossing the router finds no sea way for as the straight line", async () => {
    jest.mocked(computeSchematicRoute).mockResolvedValue(unrouted());
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ geometrySource: "straight", geometry: null });
    // No sea way is an answer, not a failure.
    expect(res.body.meta).toEqual({ seaRoute: "straight" });
  });

  it("never loses a crossing to a router failure", async () => {
    jest.mocked(computeSchematicRoute).mockRejectedValue(new Error("land mask missing"));
    const res = await create();
    expect(res.status).toBe(201);
    expect(res.body.data.geometrySource).toBe("straight");
    // Saved, and the client is told the sea line did not come (Codex review).
    expect(res.body.meta).toEqual({ seaRoute: "failed" });
    expect(await prisma.ferryJourney.count({ where: { userId } })).toBe(1);
  });

  it("routes again when a terminal moves, and not for a note", async () => {
    const id = (await create()).body.data.id as string;
    const moved = { ...arr, lat: 42.7, lon: 18.1 };
    jest
      .mocked(computeSchematicRoute)
      .mockReset()
      .mockResolvedValue(routed([...line.slice(0, 3), [moved.lon, moved.lat]]));
    const note = await request(app)
      .patch(`/api/v1/ferry/${id}`)
      .set("Cookie", cookie)
      .send({ notes: "Window seat" });
    expect(note.status).toBe(200);
    expect(note.body.meta).toEqual({ seaRoute: "unchanged" });
    expect(computeSchematicRoute).not.toHaveBeenCalled();

    const edit = await request(app)
      .patch(`/api/v1/ferry/${id}`)
      .set("Cookie", cookie)
      .send({ arrivalStation: moved });
    expect(edit.status).toBe(200);
    expect(edit.body.data).toMatchObject({
      geometrySource: "sea_route",
      geometry: [...line.slice(0, 3), [moved.lon, moved.lat]],
    });
    expect(edit.body.meta).toEqual({ seaRoute: "routed" });
    expect(computeSchematicRoute).toHaveBeenCalledTimes(1);
  });

  it("still links to a roadtrip leg whose stops are not at the ports", async () => {
    // A roadtrip stop is a town, rarely the pier. A straight crossing could
    // always be linked to such a leg; a routed one must not be refused.
    const id = (await create()).body.data.id as string;
    const trip = await prisma.trip.create({ data: { userId, name: "Coast trip" } });
    const route = await prisma.tripRoute.create({
      data: { userId, tripId: trip.id, name: "Coast", kind: "roadtrip", mode: "road" },
    });
    const from = await prisma.tripStop.create({
      data: { tripId: trip.id, routeId: route.id, title: "Town A", lat: 41.2, lon: 16.6 },
    });
    const to = await prisma.tripStop.create({
      data: { tripId: trip.id, routeId: route.id, title: "Town B", lat: 42.65, lon: 18.11 },
    });
    const leg = await prisma.tripRouteLeg.create({
      data: {
        routeId: route.id,
        fromStopId: from.id,
        toStopId: to.id,
        mode: "road",
        source: "routed",
        distanceKm: 300,
      },
    });
    const res = await request(app)
      .put(`/api/v1/ferry/${id}/roadtrip-leg`)
      .set("Cookie", cookie)
      .send({ legId: leg.id });
    expect(res.status).toBe(200);
    // The sea line does not start at the leg's stops, so the leg keeps the
    // chord between them, as a straight crossing's link always gave it.
    expect(await prisma.tripRouteLeg.findUniqueOrThrow({ where: { id: leg.id } })).toMatchObject({
      mode: "ferry",
      source: "straight",
      waypoints: null,
    });
    await prisma.trip.delete({ where: { id: trip.id } });
  });

  it("names a spreadsheet row whose sea route failed", async () => {
    jest.mocked(computeSchematicRoute).mockRejectedValue(new Error("land mask missing"));
    const [outcome] = await importSheets([{ key: "ferry", rows: [sheetRow] }], {
      userId,
      dryRun: false,
      mode: "merge",
    });
    expect(outcome.created).toBe(1);
    expect(outcome.rows[0].notes).toContain("sea_route_failed");
  });

  it("routes a crossing a spreadsheet creates", async () => {
    const [outcome] = await importSheets([{ key: "ferry", rows: [sheetRow] }], {
      userId,
      dryRun: false,
      mode: "merge",
    });
    expect(outcome.created).toBe(1);
    expect(outcome.rows[0].notes ?? []).not.toContain("sea_route_failed");
    expect(await prisma.ferryJourney.findFirstOrThrow({ where: { userId } })).toMatchObject({
      geometrySource: "sea_route",
      geometry: line,
    });
  });
});
