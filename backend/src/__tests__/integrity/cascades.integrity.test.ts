/**
 * Data-integrity audit 2026-09-19 — what a single confirmed delete actually
 * takes with it, measured against the live foreign keys rather than read off
 * `schema.prisma`. The schema and the database can disagree (a hand-written
 * migration, a `prisma db push` on a dev box); only the database decides what
 * is lost.
 *
 * The delete routes themselves are one `prisma.<model>.delete()` each, so the
 * cascade IS the behaviour — see routes/trips.ts:617, routes/cruises.ts:744,
 * routes/lodging/stays.ts:327, routes/flights.ts:1290.
 */
import { prisma } from "../../db";

const TAG = `i2casc-${Date.now()}`;
let userId = "";

async function makeDoc(tag: string, owner: Record<string, string>): Promise<string> {
  const d = await prisma.document.create({
    data: {
      userId,
      storedName: `${tag}.pdf`,
      mimetype: "application/pdf",
      sizeBytes: 1,
      sha256: tag,
      format: "pdf",
      ...owner,
    },
  });
  return d.id;
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { username: `${TAG}-user`, passwordHash: "x" },
  });
  userId = user.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({ where: { username: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("DELETE /trips/:id", () => {
  it("takes the journal, the tour route, its track and the trip documents", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: `${TAG}-trip` } });
    await prisma.tripJournalEntry.create({
      data: { tripId: trip.id, date: new Date(), title: `${TAG}-j`, body: "a written day" },
    });
    const stopA = await prisma.tripStop.create({
      data: { tripId: trip.id, title: `${TAG}-a`, lat: 1, lon: 1 },
    });
    const stopB = await prisma.tripStop.create({
      data: { tripId: trip.id, title: `${TAG}-b`, lat: 2, lon: 2 },
    });
    const route = await prisma.tripRoute.create({
      data: { userId, tripId: trip.id, mode: "car", name: `${TAG}-route` },
    });
    await prisma.tripRouteLeg.create({
      data: {
        routeId: route.id,
        fromStopId: stopA.id,
        toStopId: stopB.id,
        distanceKm: 1,
        source: "straight",
        mode: "car",
      },
    });
    await prisma.tripRouteTrack.create({
      data: {
        routeId: route.id,
        source: "gpx",
        name: `${TAG}.gpx`,
        startedAt: new Date(),
        endedAt: new Date(),
        geometry: {},
        pointCount: 3,
        distanceKm: 1,
      },
    });
    const photo = await prisma.tripPhoto.create({
      data: { tripId: trip.id, filename: `${TAG}.jpg`, mimetype: "image/jpeg", sizeBytes: 1 },
    });
    const docId = await makeDoc(`${TAG}-tripdoc`, { tripId: trip.id });

    // Things that must SURVIVE, as the dialog promises.
    const flight = await prisma.flight.create({
      data: {
        userId,
        flightNumber: "LH1",
        depLat: 1,
        depLon: 1,
        arrLat: 2,
        arrLon: 2,
        tripId: trip.id,
      },
    });

    await prisma.trip.delete({ where: { id: trip.id } });

    expect(await prisma.tripJournalEntry.count({ where: { tripId: trip.id } })).toBe(0);
    expect(await prisma.tripRoute.count({ where: { id: route.id } })).toBe(0);
    expect(await prisma.tripRouteTrack.count({ where: { routeId: route.id } })).toBe(0);
    expect(await prisma.tripRouteLeg.count({ where: { routeId: route.id } })).toBe(0);
    expect(await prisma.tripStop.count({ where: { tripId: trip.id } })).toBe(0);
    expect(await prisma.tripPhoto.count({ where: { id: photo.id } })).toBe(0);
    expect(await prisma.document.count({ where: { id: docId } })).toBe(0);

    const survivor = await prisma.flight.findUniqueOrThrow({ where: { id: flight.id } });
    expect(survivor.tripId).toBeNull();
  });
});

describe("DELETE /lodgings/:id/stays/:stayId", () => {
  it("takes the stay documents; the lodging and a linked trip survive", async () => {
    const trip = await prisma.trip.create({ data: { userId, name: `${TAG}-staytrip` } });
    const lodging = await prisma.lodging.create({ data: { userId, name: `${TAG}-hotel` } });
    const stay = await prisma.lodgingStay.create({
      data: { userId, lodgingId: lodging.id, tripId: trip.id, checkIn: new Date() },
    });
    const docId = await makeDoc(`${TAG}-staydoc`, { lodgingStayId: stay.id });

    await prisma.lodgingStay.delete({ where: { id: stay.id } });

    expect(await prisma.document.count({ where: { id: docId } })).toBe(0);
    expect(await prisma.lodging.count({ where: { id: lodging.id } })).toBe(1);
    expect(await prisma.trip.count({ where: { id: trip.id } })).toBe(1);
  });
});

describe("DELETE /lodgings/:id", () => {
  it("takes every stay under it, their documents and its photos", async () => {
    const lodging = await prisma.lodging.create({ data: { userId, name: `${TAG}-hotel2` } });
    const stay = await prisma.lodgingStay.create({
      data: { userId, lodgingId: lodging.id, checkIn: new Date() },
    });
    const photo = await prisma.lodgingPhoto.create({
      data: {
        lodgingId: lodging.id,
        filename: `${TAG}-l.jpg`,
        mimetype: "image/jpeg",
        sizeBytes: 1,
      },
    });
    const docId = await makeDoc(`${TAG}-hoteldoc`, { lodgingStayId: stay.id });

    await prisma.lodging.delete({ where: { id: lodging.id } });

    expect(await prisma.lodgingStay.count({ where: { id: stay.id } })).toBe(0);
    expect(await prisma.lodgingPhoto.count({ where: { id: photo.id } })).toBe(0);
    expect(await prisma.document.count({ where: { id: docId } })).toBe(0);
  });
});

describe("DELETE /flights/:id", () => {
  it("takes the flight documents and pending updates", async () => {
    const flight = await prisma.flight.create({
      data: { userId, flightNumber: "LH2", depLat: 1, depLon: 1, arrLat: 2, arrLon: 2 },
    });
    const docId = await makeDoc(`${TAG}-flightdoc`, { flightId: flight.id });
    const pending = await prisma.pendingFlightUpdate.create({
      data: {
        flightId: flight.id,
        userId,
        changes: {},
        originalData: {},
        proposedData: {},
        apiSource: "airlabs",
        fetchedAt: new Date(),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });

    await prisma.flight.delete({ where: { id: flight.id } });

    expect(await prisma.document.count({ where: { id: docId } })).toBe(0);
    expect(await prisma.pendingFlightUpdate.count({ where: { id: pending.id } })).toBe(0);
  });
});

describe("DELETE /cruises/:id", () => {
  it("takes stops, legs and the cruise documents; ports survive", async () => {
    const port = await prisma.port.findFirstOrThrow({ orderBy: { id: "asc" } });
    const cruise = await prisma.cruise.create({
      data: { userId, routeName: `${TAG}-cruise`, startDate: new Date() },
    });
    const stop = await prisma.cruiseStop.create({
      data: { cruiseId: cruise.id, dayNumber: 1, portId: port.id },
    });
    const leg = await prisma.cruiseLeg.create({
      data: {
        cruiseId: cruise.id,
        ordinal: 0,
        fromPortId: port.id,
        toPortId: port.id,
        distanceKm: 1,
        method: "test",
        routerVersion: "test",
      },
    });
    const docId = await makeDoc(`${TAG}-cruisedoc`, { cruiseId: cruise.id });

    await prisma.cruise.delete({ where: { id: cruise.id } });

    expect(await prisma.cruiseStop.count({ where: { id: stop.id } })).toBe(0);
    expect(await prisma.cruiseLeg.count({ where: { id: leg.id } })).toBe(0);
    expect(await prisma.document.count({ where: { id: docId } })).toBe(0);
    expect(await prisma.port.count({ where: { id: port.id } })).toBe(1);
  });

  it("a port in use by a cruise leg cannot be deleted (Restrict holds)", async () => {
    const port = await prisma.port.findFirstOrThrow({ orderBy: { id: "asc" } });
    const cruise = await prisma.cruise.create({
      data: { userId, routeName: `${TAG}-cruise2`, startDate: new Date() },
    });
    await prisma.cruiseLeg.create({
      data: {
        cruiseId: cruise.id,
        ordinal: 0,
        fromPortId: port.id,
        toPortId: port.id,
        distanceKm: 1,
        method: "test",
        routerVersion: "test",
      },
    });

    await expect(prisma.port.delete({ where: { id: port.id } })).rejects.toBeDefined();

    await prisma.cruise.delete({ where: { id: cruise.id } });
  });
});

describe("DELETE /admin/users/:id", () => {
  it("takes every row of that user and nothing of another", async () => {
    const victim = await prisma.user.create({
      data: { username: `${TAG}-victim`, passwordHash: "x" },
    });
    const bystanderFlights = await prisma.flight.count({ where: { userId } });

    await prisma.flight.create({
      data: { userId: victim.id, flightNumber: "LH3", depLat: 1, depLon: 1, arrLat: 2, arrLon: 2 },
    });
    await prisma.document.create({
      data: {
        userId: victim.id,
        storedName: `${TAG}-v.pdf`,
        mimetype: "application/pdf",
        sizeBytes: 1,
        sha256: `${TAG}-v`,
        format: "pdf",
      },
    });
    await prisma.passwordResetRequest.create({ data: { userId: victim.id } });

    await prisma.user.delete({ where: { id: victim.id } });

    expect(await prisma.flight.count({ where: { userId: victim.id } })).toBe(0);
    expect(await prisma.document.count({ where: { userId: victim.id } })).toBe(0);
    expect(await prisma.passwordResetRequest.count({ where: { userId: victim.id } })).toBe(0);
    expect(await prisma.flight.count({ where: { userId } })).toBe(bystanderFlights);
  });
});
