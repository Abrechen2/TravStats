import { prisma } from "../db";
import { hashPassword } from "../utils/password";
import { listDocumentLinks } from "../services/documents/documentEntryLinks";
import { visitDocumentCounts } from "../services/places/visitDocumentCounts";

/**
 * forgejo#425: a writer that sets only an owner column on `documents` (SQL on a
 * server, an older build) still gets its link — the trigger
 * `documents_after_owner_set` writes it, so reads and counts need no fallback.
 */
const stamp = Date.now();

describe("documents_after_owner_set (legacy owner-column writers)", () => {
  let userId: string;
  let flightA: string;
  let flightB: string;
  let visitId: string;

  const insertDoc = async (tag: string, column: "flight_id" | "place_visit_id", id: string) => {
    const docId = `legacy-${stamp}-${tag}`;
    await prisma.$executeRawUnsafe(
      `INSERT INTO documents (id, user_id, stored_name, mimetype, size_bytes, sha256, format, ${column})
       VALUES ($1, $2, $3, 'application/pdf', 1, $3, 'pdf', $4)`,
      docId,
      userId,
      `${docId}.pdf`,
      id
    );
    return docId;
  };
  const flightData = (uid: string) => ({
    userId: uid,
    depIata: "FRA",
    depLat: 50.03,
    depLon: 8.56,
    arrIata: "MUC",
    arrLat: 48.35,
    arrLon: 11.78,
    departureTime: new Date("2024-05-01T08:00:00Z"),
    status: "flown",
  });

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: { username: `legacy-owner-${stamp}`, passwordHash: await hashPassword("x-password") },
      })
    ).id;
    flightA = (await prisma.flight.create({ data: flightData(userId) })).id;
    flightB = (await prisma.flight.create({ data: flightData(userId) })).id;
    const place = await prisma.place.create({
      data: { userId, name: "Dam", lat: 1, lon: 1, category: "other" },
    });
    visitId = (await prisma.placeVisit.create({ data: { userId, placeId: place.id } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("an INSERT with only an owner column produces its primary/legacy link", async () => {
    const docId = await insertDoc("insert", "flight_id", flightA);
    const links = await prisma.documentLink.findMany({ where: { documentId: docId } });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ flightId: flightA, role: "primary", provenance: "legacy" });
    // Reads and counts see it with no read-side fallback.
    expect((await listDocumentLinks(userId, docId)).map((l) => l.entry.id)).toEqual([flightA]);
  });

  it("counts a legacy-written visit document", async () => {
    await insertDoc("visit", "place_visit_id", visitId);
    expect((await visitDocumentCounts(userId, [visitId])).get(visitId)).toBe(1);
  });

  it("an UPDATE to another target adds a covers link beside the existing primary", async () => {
    const docId = await insertDoc("update", "flight_id", flightA);
    await prisma.$executeRawUnsafe(
      `UPDATE documents SET flight_id = $1 WHERE id = $2`,
      flightB,
      docId
    );
    const roles = Object.fromEntries(
      (await prisma.documentLink.findMany({ where: { documentId: docId } })).map((l) => [
        l.flightId,
        l.role,
      ])
    );
    expect(roles).toEqual({ [flightA]: "primary", [flightB]: "covers" });
  });

  it("does not double a link the service already wrote", async () => {
    const docId = await insertDoc("again", "flight_id", flightA);
    await prisma.$executeRawUnsafe(
      `UPDATE documents SET flight_id = $1 WHERE id = $2`,
      flightA,
      docId
    );
    expect(await prisma.documentLink.count({ where: { documentId: docId } })).toBe(1);
  });
});
