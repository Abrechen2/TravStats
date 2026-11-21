import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import request from "supertest";
import { unzipSync } from "fflate";

import app from "../../index";
import { prisma } from "../../db";
import { commitTripFile } from "../../services/trip/exchange/commit";
import { readTripArchive } from "../../services/trip/exchange/readArchive";
import { MAX_DOCUMENT_LINKS } from "../../services/trip/exchange/format";
import { listEntryDocuments } from "../../services/documents/documentEntryLinks";
import { makeAccount, wipeShareTestAccounts, type TestAccount } from "./sharingFixtures";
import { seedFullTrip } from "./tripExchange.fixture";

/** forgejo#425 review fixes: per-link rental category, the link cap, the entry list's category. */
describe("document links — rental categories and the archive cap", () => {
  let anna: TestAccount;
  let tripId: string;
  let documentId: string;
  let rentalA: string;
  let rentalB: string;

  const binary = (res: request.Response, done: (err: Error | null, body: Buffer) => void): void => {
    const chunks: Buffer[] = [];
    res.on("data", (c: Buffer) => chunks.push(Buffer.from(c)));
    res.on("end", () => done(null, Buffer.concat(chunks)));
  };
  const exportRes = () =>
    request(app)
      .get(`/api/v1/trips/${tripId}/export?documents=1`)
      .set("Cookie", anna.cookie)
      .buffer(true)
      .parse(binary);

  beforeAll(async () => {
    await wipeShareTestAccounts();
    anna = await makeAccount("anna-xdlp2");
    tripId = (await seedFullTrip(anna.id, Date.now())).tripId;
    documentId = (await prisma.document.findFirstOrThrow({ where: { userId: anna.id } })).id;
    rentalA = (await prisma.rentalBooking.findFirstOrThrow({ where: { userId: anna.id } })).id;
    const a = await prisma.rentalBooking.findUniqueOrThrow({ where: { id: rentalA } });
    const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = a;
    rentalB = (
      await prisma.rentalBooking.create({
        data: { ...rest, licensePlate: "ZZ-99", externalRef: null, shareKey: null } as never,
      })
    ).id;
    await prisma.documentLink.deleteMany({ where: { documentId } });
    await prisma.documentLink.createMany({
      data: [
        {
          documentId,
          rentalBookingId: rentalA,
          role: "primary",
          provenance: "user",
          rentalCategory: "pickup",
        },
        {
          documentId,
          rentalBookingId: rentalB,
          role: "covers",
          provenance: "user",
          rentalCategory: "damage",
        },
      ],
    });
  });
  afterAll(async () => {
    await wipeShareTestAccounts();
    await prisma.$disconnect();
  });

  it("an entry list returns the category of the link for THAT rental, not the primary's", async () => {
    const [onB] = await listEntryDocuments(anna.id, { type: "rentalBooking", id: rentalB });
    expect(onB.document.rentalCategory).toBe("damage");
    const [onA] = await listEntryDocuments(anna.id, { type: "rentalBooking", id: rentalA });
    expect(onA.document.rentalCategory).toBe("pickup");
  });

  it("each rental keeps its own category through export and import", async () => {
    const ben = await makeAccount("ben-xdlp2");
    await commitTripFile(ben.id, readTripArchive((await exportRes()).body as Buffer));
    const links = await prisma.documentLink.findMany({
      where: { document: { userId: ben.id }, rentalBookingId: { not: null } },
      include: { document: true },
    });
    expect(links.map((l) => l.rentalCategory).sort()).toEqual(["damage", "pickup"]);
    expect(links.find((l) => l.role === "primary")?.rentalCategory).toBe("pickup");
  });

  it("a document with more than 200 in-trip links exports (it used to answer 500)", async () => {
    const template = await prisma.ferryJourney.create({
      data: {
        userId: anna.id,
        tripId,
        depStationName: "A",
        arrStationName: "B",
        depLat: 1,
        depLon: 1,
        arrLat: 2,
        arrLon: 2,
        departureTime: new Date("2026-05-01T08:00:00Z"),
        arrivalTime: new Date("2026-05-01T10:00:00Z"),
        status: "scheduled",
      },
    });
    const ids: string[] = [template.id];
    for (let i = 1; i < 205; i += 1) {
      ids.push(
        (
          await prisma.ferryJourney.create({
            data: { ...template, id: undefined, depStationName: `A${i}` } as never,
          })
        ).id
      );
    }
    await prisma.documentLink.createMany({
      data: ids.map((id) => ({
        documentId,
        ferryJourneyId: id,
        role: "covers",
        provenance: "user",
      })),
    });
    const res = await exportRes();
    expect(res.status).toBe(200);
    const file = JSON.parse(
      Buffer.from(unzipSync(new Uint8Array(res.body as Buffer))["trip.json"]).toString()
    );
    expect(file.documents[0].links.length).toBeGreaterThan(200);
    expect(file.documents[0].links.length).toBeLessThanOrEqual(MAX_DOCUMENT_LINKS);
  });
});
