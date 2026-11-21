import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { strToU8, unzipSync, zipSync } from "fflate";

import app from "../../index";
import { prisma } from "../../db";
import { commitTripFile } from "../../services/trip/exchange/commit";
import { readTripArchive } from "../../services/trip/exchange/readArchive";
import { createDocument } from "../../services/documents/documentService";
import { makeAccount, wipeShareTestAccounts, type TestAccount } from "./sharingFixtures";
import { PNG_DOC, seedFullTrip } from "./tripExchange.fixture";

/**
 * Document links, phase D3: a `.travstats` file (version 5) carries ONE document
 * with several archive-local links; the import remaps both ends and adds the
 * links even when the bytes are known already. forgejo#425.
 */
describe("trip archive — one document, several links", () => {
  let anna: TestAccount;
  let ben: TestAccount;
  let tripId: string;
  let documentId: string;
  let flightId: string;
  let stayId: string;
  let outsideFerryId: string;

  const binary = (res: request.Response, done: (err: Error | null, body: Buffer) => void): void => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
    res.on("end", () => done(null, Buffer.concat(chunks)));
  };
  const exportAs = async (): Promise<Buffer> =>
    (
      await request(app)
        .get(`/api/v1/trips/${tripId}/export?documents=1`)
        .set("Cookie", anna.cookie)
        .buffer(true)
        .parse(binary)
    ).body as Buffer;

  beforeAll(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-xdoclinks");
    ben = await makeAccount("ben-xdoclinks");
    tripId = (await seedFullTrip(anna.id, Date.now())).tripId;
    documentId = (await prisma.document.findFirstOrThrow({ where: { userId: anna.id } })).id;
    flightId = (await prisma.flight.findFirstOrThrow({ where: { userId: anna.id } })).id;
    stayId = (await prisma.lodgingStay.findFirstOrThrow({ where: { userId: anna.id } })).id;
    outsideFerryId = (
      await prisma.ferryJourney.create({
        data: {
          userId: anna.id,
          operator: "Elsewhere Line",
          depStationName: "Out A",
          arrStationName: "Out B",
          depLat: 1,
          depLon: 1,
          arrLat: 2,
          arrLon: 2,
          departureTime: new Date("2026-01-01T12:00:00Z"),
          arrivalTime: new Date("2026-01-01T14:00:00Z"),
          status: "scheduled",
        },
      })
    ).id;
    await prisma.documentLink.createMany({
      data: [
        { documentId, flightId, role: "covers", provenance: "parser" },
        { documentId, lodgingStayId: stayId, role: "covers", provenance: "suggestion" },
        { documentId, ferryJourneyId: outsideFerryId, role: "covers", provenance: "user" },
      ],
    });
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("writes version 5 with the links inside the trip only", async () => {
    const entries = unzipSync(new Uint8Array(await exportAs()));
    const manifest = JSON.parse(Buffer.from(entries["manifest.json"]).toString());
    const file = JSON.parse(Buffer.from(entries["trip.json"]).toString());
    expect(manifest.formatVersion).toBe(5);
    expect(file.documents).toHaveLength(1);
    const links = file.documents[0].links;
    expect(links.map((l: { entity: { kind: string } }) => l.entity.kind).sort()).toEqual([
      "flight",
      "stay",
      "trip",
    ]);
    // Never the ferry outside the trip: it is not in the file, and neither is a reference to it.
    expect(JSON.stringify(file)).not.toContain(outsideFerryId);
    expect(links.find((l: { role: string }) => l.role === "primary").entity.kind).toBe("trip");
  });

  it("a document with one link is written in the version-4 form, with no links key", async () => {
    await prisma.documentLink.deleteMany({ where: { documentId, role: "covers" } });
    try {
      const entries = unzipSync(new Uint8Array(await exportAs()));
      const manifest = JSON.parse(Buffer.from(entries["manifest.json"]).toString());
      const file = JSON.parse(Buffer.from(entries["trip.json"]).toString());
      expect(manifest.formatVersion).toBeLessThan(5);
      expect(file.documents[0]).not.toHaveProperty("links");
    } finally {
      await prisma.documentLink.createMany({
        data: [
          { documentId, flightId, role: "covers", provenance: "parser" },
          { documentId, lodgingStayId: stayId, role: "covers", provenance: "suggestion" },
          { documentId, ferryJourneyId: outsideFerryId, role: "covers", provenance: "user" },
        ],
      });
    }
  });

  it("an import remaps both ends: one document, the same three links on the new rows", async () => {
    const result = await commitTripFile(ben.id, readTripArchive(await exportAs()));
    expect(result.documents).toMatchObject({ filed: 1, skipped: 0, linked: 2 });
    const docs = await prisma.document.findMany({
      where: { userId: ben.id },
      include: { links: true },
    });
    expect(docs).toHaveLength(1);
    const links = docs[0].links;
    expect(links).toHaveLength(3);
    const trip = await prisma.trip.findFirstOrThrow({ where: { userId: ben.id } });
    const flight = await prisma.flight.findFirstOrThrow({ where: { userId: ben.id } });
    const stay = await prisma.lodgingStay.findFirstOrThrow({ where: { userId: ben.id } });
    expect(links.find((l) => l.role === "primary")).toMatchObject({ tripId: trip.id });
    expect(links.find((l) => l.flightId === flight.id)).toMatchObject({
      role: "covers",
      provenance: "parser",
    });
    expect(links.find((l) => l.lodgingStayId === stay.id)).toMatchObject({
      provenance: "suggestion",
    });
    expect(docs[0].tripId).toBe(trip.id);
  });

  it("an import that finds the bytes already held still adds the missing links", async () => {
    const carol = await makeAccount("carol-xdoclinks");
    // Carol already holds the file, unfiled — a hash match used to skip the row and drop its links.
    const held = await createDocument({ userId: carol.id, buffer: PNG_DOC, originalName: "t.png" });
    expect(await prisma.documentLink.count({ where: { documentId: held.document.id } })).toBe(0);
    const result = await commitTripFile(carol.id, readTripArchive(await exportAs()));
    expect(result.documents).toMatchObject({ filed: 0, skipped: 1, linked: 3 });
    expect(await prisma.document.count({ where: { userId: carol.id } })).toBe(1);
    expect(await prisma.documentLink.count({ where: { documentId: held.document.id } })).toBe(3);

    // And once more: nothing doubles.
    await commitTripFile(carol.id, readTripArchive(await exportAs()));
    expect(await prisma.documentLink.count({ where: { documentId: held.document.id } })).toBe(3);
  });

  it("a version-4 file with the single-owner document form still imports", async () => {
    const entries = unzipSync(new Uint8Array(await exportAs()));
    const file = JSON.parse(Buffer.from(entries["trip.json"]).toString());
    for (const d of file.documents) delete d.links;
    const manifest = JSON.parse(Buffer.from(entries["manifest.json"]).toString());
    manifest.formatVersion = 4;
    const legacy = Buffer.from(
      zipSync({
        ...entries,
        "manifest.json": strToU8(JSON.stringify(manifest)),
        "trip.json": strToU8(JSON.stringify(file)),
      })
    );
    const dan = await makeAccount("dan-xdoclinks");
    const result = await commitTripFile(dan.id, readTripArchive(legacy));
    expect(result.documents).toMatchObject({ filed: 1, linked: 0 });
    const doc = await prisma.document.findFirstOrThrow({
      where: { userId: dan.id },
      include: { links: true },
    });
    expect(doc.links).toHaveLength(1);
    expect(doc.links[0]).toMatchObject({ role: "primary", tripId: doc.tripId });
  });
});
