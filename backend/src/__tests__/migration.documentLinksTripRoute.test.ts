import { prisma } from "../db";
import { hashPassword } from "../utils/password";

/**
 * GitHub #415: the new `trip_route_id` column is known to every database rule that
 * names the owner columns — the single-owner CHECKs, the legacy-writer trigger, the
 * promotion of the next link when the primary goes, and the unfile on the last one.
 */
const stamp = Date.now();

describe("documents on a roadtrip — database rules", () => {
  let userId: string;
  let routeId: string;
  let flightId: string;

  const insertDoc = async (tag: string, extra: string, value: string) => {
    const id = `tr-${stamp}-${tag}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO documents (id, user_id, stored_name, mimetype, size_bytes, sha256, format, ${extra})
       VALUES ($1, $2, $3, 'application/pdf', 1, $3, 'pdf', $4)`,
      id,
      userId,
      `${id}.pdf`,
      value
    );
    return id;
  };

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { username: `tr-owner-${stamp}`, passwordHash: await hashPassword("x-password") },
      })
    ).id;
    routeId = (await prisma.tripRoute.create({ data: { userId, name: "Ride", mode: "road" } })).id;
    flightId = (
      await prisma.flight.create({
        data: {
          userId,
          depIata: "FRA",
          depLat: 50,
          depLon: 8,
          arrIata: "MUC",
          arrLat: 48,
          arrLon: 11,
          departureTime: new Date("2024-05-01T08:00:00Z"),
          status: "flown",
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("gives a legacy owner-column write on trip_route_id its link", async () => {
    const docId = await insertDoc("legacy", "trip_route_id", routeId);
    const links = await prisma.documentLink.findMany({ where: { documentId: docId } });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ tripRouteId: routeId, role: "primary", provenance: "legacy" });
  });

  it("refuses a link that names a tour AND another entry", async () => {
    const docId = await insertDoc("two", "trip_route_id", routeId);
    await expect(
      prisma.documentLink.create({
        data: {
          documentId: docId,
          tripRouteId: routeId,
          flightId,
          role: "covers",
          provenance: "user",
        },
      })
    ).rejects.toThrow();
  });

  it("hands the primary to the next link when the tour link goes, then unfiles on the last", async () => {
    const docId = await insertDoc("handover", "trip_route_id", routeId);
    await prisma.documentLink.create({
      data: { documentId: docId, flightId, role: "covers", provenance: "user" },
    });
    await prisma.documentLink.deleteMany({ where: { documentId: docId, tripRouteId: routeId } });
    const moved = await prisma.document.findUniqueOrThrow({ where: { id: docId } });
    expect(moved).toMatchObject({ tripRouteId: null, flightId });
    await prisma.documentLink.deleteMany({ where: { documentId: docId } });
    const unfiled = await prisma.document.findUniqueOrThrow({ where: { id: docId } });
    expect(unfiled.flightId).toBeNull();
    expect(unfiled.unlinkedAt).not.toBeNull();
  });

  it("moves the primary link with a legacy writer that moves the owner onto a tour", async () => {
    const docId = await insertDoc("move", "flight_id", flightId);
    await prisma.$executeRawUnsafe(
      `UPDATE documents SET flight_id = NULL, trip_route_id = $2 WHERE id = $1`,
      docId,
      routeId
    );
    const links = await prisma.documentLink.findMany({ where: { documentId: docId } });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ tripRouteId: routeId, flightId: null, role: "primary" });
  });
});
