import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { parsePackageText } from "../../services/trip/package/parsePackage";
import { loadDrafts, matchInput } from "../../services/trip/package/__tests__/draftTemplates";

/**
 * Document links, phase D3: the package commit links the kept booking document
 * to every confirmed entry as `covers` (provenance `parser`), plus the trip as
 * primary — atomically, and without duplicates on a retry. forgejo#425.
 */
const stamp = Date.now();

const invoiceReading = (): Record<string, unknown> => {
  const [invoice] = loadDrafts();
  const parsed = parsePackageText(matchInput(invoice), [invoice]);
  if (!parsed.reading) throw new Error("the invoice draft did not read");
  return parsed.reading as unknown as Record<string, unknown>;
};

describe("package commit links the booking document to what it covers", () => {
  let cookie: string;
  let userId: string;
  let documentId: string;

  const commit = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/trips/package/commit").set("Cookie", cookie).send(body);
  const preview = (body: Record<string, unknown>) =>
    request(app).post("/api/v1/trips/package/preview").set("Cookie", cookie).send(body);

  beforeAll(async () => {
    const passwordHash = await hashPassword("password123");
    userId = (await prisma.user.create({ data: { username: `pkgl-${stamp}`, passwordHash } })).id;
    cookie = `auth_token=${generateToken(userId)}`;
    documentId = (
      await prisma.document.create({
        data: {
          userId,
          storedName: `${Math.random()}.pdf`,
          mimetype: "application/pdf",
          sizeBytes: 1,
          sha256: "0".repeat(64),
          format: "pdf",
          source: "parse",
          parsedDomain: "package",
          parsedPayload: { domain: "package", package: invoiceReading() },
        },
      })
    ).id;
  });

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("the review lists the entries the document will cover, and not the excluded one", async () => {
    const res = await preview({ documentId, choices: { excludeFlights: [1] } }).expect(200);
    const doc = res.body.data.proposal.document;
    expect(doc.covers.map((c: { index: number }) => c.index)).toEqual([0, 2, 3]);
    expect(doc.covers.every((c: { action: string }) => c.action === "create")).toBe(true);
  });

  it("links the trip as primary and each committed flight as covers, never the excluded one", async () => {
    const res = await commit({ documentId, choices: { excludeFlights: [1] } }).expect(201);
    const tripId = res.body.data.trip.id as string;
    const links = await prisma.documentLink.findMany({ where: { documentId } });
    const flights = await prisma.flight.findMany({ where: { userId, tripId } });
    expect(flights).toHaveLength(3);
    expect(links).toHaveLength(4);
    expect(links.find((l) => l.role === "primary")).toMatchObject({
      tripId,
      provenance: "parser",
    });
    const covered = links.filter((l) => l.role === "covers");
    expect(covered.every((l) => l.provenance === "parser")).toBe(true);
    expect(covered.map((l) => l.flightId).sort()).toEqual(flights.map((f) => f.id).sort());
  });

  it("a retry adds only the missing link: the entry that was excluded before", async () => {
    const before = await prisma.documentLink.count({ where: { documentId } });
    const again = await commit({ documentId, choices: { excludeFlights: [1] } }).expect(201);
    expect(again.body.data.document.reason).toBe("alreadyOnTrip");
    expect(await prisma.documentLink.count({ where: { documentId } })).toBe(before);

    // The reviewer now confirms the fourth flight too: it gains its link, nothing doubles.
    await commit({ documentId }).expect(201);
    const links = await prisma.documentLink.findMany({ where: { documentId } });
    expect(links).toHaveLength(5);
    const flightIds = links.flatMap((l) => (l.flightId ? [l.flightId] : []));
    expect(new Set(flightIds).size).toBe(4);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: documentId } });
    expect(doc.tripId).toBe(links.find((l) => l.role === "primary")!.tripId);
  });
});
