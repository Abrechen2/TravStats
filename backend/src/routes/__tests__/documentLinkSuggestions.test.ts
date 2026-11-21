import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { createDocument } from "../../services/documents/documentService";
import {
  ensureDocumentLinkPass,
  runDocumentLinkPass,
} from "../../services/documents/linkSuggestions/pass";
import { settleAllJobs } from "../../services/jobs/jobRegistry";

/**
 * Plan D4 (docs/superpowers/specs/2026-11-21-document-links.md): a stored
 * document whose reading names other entries of its trip is proposed for them
 * in the inbox. Nothing is linked until accepted; a "no" is remembered by
 * content key; the scan runs once as a job and never asks twice. forgejo#425.
 */
const PDF = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n% ${tag}\n%%EOF`);

describe("document link suggestions (D4)", () => {
  const stamp = Date.now();
  let userId: string;
  let strangerId: string;
  let cookie: string;
  let strangerCookie: string;
  let tripId: string;
  let flight1Id: string;
  let flight2Id: string;
  let flight3Id: string;
  let stayId: string;
  let visitDocId: string;
  let counter = 0;

  const flightData = (extra: object) => ({
    userId,
    tripId,
    depIata: "FRA",
    depLat: 50.03,
    depLon: 8.56,
    arrIata: "LIS",
    arrLat: 38.77,
    arrLon: -9.13,
    status: "scheduled",
    ...extra,
  });
  const keep = async (payload: unknown, entry: { type: "trip" | "flight"; id: string }) => {
    counter += 1;
    const { document } = await createDocument({
      userId,
      buffer: PDF(`${stamp}-${counter}`),
      entry,
    });
    await prisma.document.update({
      where: { id: document.id },
      data: { parsedDomain: "flight", parsedPayload: payload as object },
    });
    return document.id;
  };
  const get = (path: string, c = cookie) => request(app).get(`/api/v1${path}`).set("Cookie", c);
  const post = (path: string, body: object, c = cookie) =>
    request(app).post(`/api/v1${path}`).set("Cookie", c).send(body);
  const rows = (documentId: string) =>
    prisma.documentLinkSuggestion.findMany({ where: { documentId }, orderBy: { entryId: "asc" } });

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `dls-a-${stamp}`, passwordHash } })).id;
    strangerId = (await prisma.user.create({ data: { username: `dls-b-${stamp}`, passwordHash } }))
      .id;
    cookie = `auth_token=${generateToken(userId)}`;
    strangerCookie = `auth_token=${generateToken(strangerId)}`;
    tripId = (await prisma.trip.create({ data: { userId, name: "Lissabon" } })).id;
    flight1Id = (
      await prisma.flight.create({
        data: flightData({
          flightNumber: "TP 571",
          departureTime: new Date("2026-06-01T08:00:00Z"),
          bookingReference: "ABC123",
        }),
      })
    ).id;
    flight2Id = (
      await prisma.flight.create({
        data: flightData({
          flightNumber: "TP 572",
          departureTime: new Date("2026-06-08T17:00:00Z"),
        }),
      })
    ).id;
    flight3Id = (
      await prisma.flight.create({
        data: flightData({
          flightNumber: "LH 400",
          departureTime: new Date("2026-06-09T17:00:00Z"),
        }),
      })
    ).id;
    const lodging = await prisma.lodging.create({
      data: { userId, name: "Hotel Avenida Palace", city: "Lissabon", lat: 38.7, lon: -9.1 },
    });
    stayId = (
      await prisma.lodgingStay.create({
        data: {
          userId,
          tripId,
          lodgingId: lodging.id,
          checkIn: new Date("2026-06-01T00:00:00Z"),
          checkOut: new Date("2026-06-08T00:00:00Z"),
        },
      })
    ).id;
  });

  afterAll(async () => {
    await settleAllJobs();
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  const outbound = (extra: object = {}) => ({
    domain: "flight",
    flights: [
      { flightNumber: "TP571", departureTime: "2026-06-01T08:00:00" },
      { flightNumber: "TP572", departureTime: "2026-06-08T17:00:00" },
    ],
    ...extra,
  });

  it("proposes the other flight of the booking, by flight number and day, and never the one it is filed on", async () => {
    const docId = await keep(outbound(), { type: "flight", id: flight1Id });
    await runDocumentLinkPass(userId);
    const found = await rows(docId);
    expect(found.map((r) => [r.entryId, r.reason, r.status])).toEqual([
      [flight2Id, "flightNumber", "pending"],
    ]);
  });

  it("proposes by booking reference when the numbers do not match", async () => {
    const docId = await keep(
      { domain: "flight", flights: [{ flightNumber: "XX1", bookingReference: "abc-123" }] },
      { type: "trip", id: tripId }
    );
    await runDocumentLinkPass(userId);
    const found = await rows(docId);
    expect(found.map((r) => [r.entryId, r.reason])).toEqual([[flight1Id, "bookingReference"]]);
  });

  it("proposes a stay by hotel name and dates, and by dates alone when the reading names no hotel", async () => {
    const named = await keep(
      {
        domain: "lodging",
        candidates: [
          {
            lodgingName: "Avenida Palace",
            stay: { checkIn: "2026-06-01", checkOut: "2026-06-08" },
          },
        ],
      },
      { type: "trip", id: tripId }
    );
    const unnamed = await keep(
      {
        domain: "lodging",
        candidates: [{ stay: { checkIn: "2026-06-01", checkOut: "2026-06-08" } }],
      },
      { type: "trip", id: tripId }
    );
    const otherHotel = await keep(
      {
        domain: "lodging",
        candidates: [
          { lodgingName: "Pensao Flor", stay: { checkIn: "2026-06-01", checkOut: "2026-06-08" } },
        ],
      },
      { type: "trip", id: tripId }
    );
    await runDocumentLinkPass(userId);
    expect((await rows(named)).map((r) => [r.entryId, r.reason])).toEqual([[stayId, "hotelDates"]]);
    expect((await rows(unnamed)).map((r) => [r.entryId, r.reason])).toEqual([
      [stayId, "dateRange"],
    ]);
    expect(await rows(otherHotel)).toEqual([]);
  });

  it("proposes nothing when no field matches, and never a place visit", async () => {
    visitDocId = await keep(
      {
        domain: "flight",
        flights: [{ flightNumber: "KL1234", departureTime: "2026-07-01T10:00:00" }],
      },
      { type: "trip", id: tripId }
    );
    await runDocumentLinkPass(userId);
    expect(await rows(visitDocId)).toEqual([]);
    const types = new Set(
      (await prisma.documentLinkSuggestion.findMany({ where: { userId } })).map((r) => r.entryType)
    );
    expect(types.has("placeVisit")).toBe(false);
  });

  it("accepting a ticked subset links only those as covers/suggestion and leaves the rest pending", async () => {
    const docId = await keep(
      {
        domain: "flight",
        flights: [
          { flightNumber: "TP572", departureTime: "2026-06-08T17:00:00" },
          { flightNumber: "LH400", departureTime: "2026-06-09T17:00:00" },
        ],
      },
      { type: "flight", id: flight1Id }
    );
    await runDocumentLinkPass(userId);
    const list = await get("/document-link-suggestions");
    const group = list.body.data.suggestions.find(
      (g: { documentId: string }) => g.documentId === docId
    );
    expect(group.entries).toHaveLength(2);
    const pick = group.entries.find((e: { entry: { id: string } }) => e.entry.id === flight2Id);
    const accepted = await post(`/document-link-suggestions/${docId}/accept`, {
      suggestionIds: [pick.suggestionId],
    });
    expect(accepted.status).toBe(200);
    expect(accepted.body.data).toEqual({ linked: 1, skipped: 0 });
    const links = await prisma.documentLink.findMany({ where: { documentId: docId } });
    const added = links.find((l) => l.flightId === flight2Id)!;
    expect([added.role, added.provenance]).toEqual(["covers", "suggestion"]);
    expect(links.some((l) => l.flightId === flight3Id)).toBe(false);
    const after = await rows(docId);
    expect(after.map((r) => [r.entryId, r.status]).sort()).toEqual(
      [
        [flight2Id, "accepted"],
        [flight3Id, "pending"],
      ].sort()
    );
  });

  it("a rejected suggestion never resurfaces, not even after a re-run of the pass or a re-import of the entry", async () => {
    const docId = await keep(
      {
        domain: "flight",
        flights: [{ flightNumber: "LH400", departureTime: "2026-06-09T17:00:00" }],
      },
      { type: "flight", id: flight1Id }
    );
    await runDocumentLinkPass(userId);
    const dismissed = await post(`/document-link-suggestions/${docId}/dismiss`, {});
    expect(dismissed.body.data.dismissed).toBe(1);

    // Force a full re-scan, then delete and re-import the entry under a new id.
    await prisma.documentLinkPass.deleteMany({ where: { userId } });
    await runDocumentLinkPass(userId);
    await prisma.flight.delete({ where: { id: flight3Id } });
    flight3Id = (
      await prisma.flight.create({
        data: flightData({
          flightNumber: "LH 400",
          departureTime: new Date("2026-06-09T17:00:00Z"),
        }),
      })
    ).id;
    await prisma.documentLinkPass.deleteMany({ where: { userId } });
    await runDocumentLinkPass(userId);

    expect((await rows(docId)).map((r) => r.status)).toEqual(["dismissed"]);
    const list = await get("/document-link-suggestions");
    expect(
      list.body.data.suggestions.some((g: { documentId: string }) => g.documentId === docId)
    ).toBe(false);
  });

  it("a deleted entry takes its suggestion out of the list", async () => {
    const extra = await prisma.flight.create({
      data: flightData({ flightNumber: "TP 900", departureTime: new Date("2026-06-04T09:00:00Z") }),
    });
    const docId = await keep(
      {
        domain: "flight",
        flights: [{ flightNumber: "TP900", departureTime: "2026-06-04T09:00:00" }],
      },
      { type: "trip", id: tripId }
    );
    await runDocumentLinkPass(userId);
    const before = await get("/document-link-suggestions");
    expect(
      before.body.data.suggestions.some((g: { documentId: string }) => g.documentId === docId)
    ).toBe(true);
    await prisma.flight.delete({ where: { id: extra.id } });
    const after = await get("/document-link-suggestions");
    expect(
      after.body.data.suggestions.some((g: { documentId: string }) => g.documentId === docId)
    ).toBe(false);
    expect(await rows(docId)).toEqual([]);
    const gone = await post(`/document-link-suggestions/${docId}/accept`, {});
    expect(gone.status).toBe(404);
  });

  it("the pass is idempotent: a second run proposes nothing and asks nothing twice", async () => {
    await prisma.documentLinkPass.deleteMany({ where: { userId } });
    const before = await prisma.documentLinkSuggestion.count({ where: { userId } });
    const first = await runDocumentLinkPass(userId);
    expect(first.documentsScanned).toBeGreaterThan(0);
    expect(first.proposed).toBe(0);
    expect(await prisma.documentLinkSuggestion.count({ where: { userId } })).toBe(before);
    // Nothing new since: no job is started at all.
    expect(await ensureDocumentLinkPass(userId)).toBeNull();
  });

  it("a newly filed document is picked up by the next read, as a job with progress", async () => {
    const docId = await keep(
      {
        domain: "flight",
        flights: [{ flightNumber: "TP571", departureTime: "2026-06-01T08:00:00" }],
      },
      { type: "trip", id: tripId }
    );
    const first = await get("/document-link-suggestions/count");
    expect(first.body.data.pass.jobId).toEqual(expect.any(String));
    await settleAllJobs();
    const job = await get(`/jobs/${first.body.data.pass.jobId}`);
    expect(job.status).toBe(200);
    expect((await rows(docId)).map((r) => r.entryId)).toEqual([flight1Id]);
  });

  it("an entry added to the trip after a document was scanned is still offered to it", async () => {
    const docId = await keep(
      {
        domain: "flight",
        flights: [{ flightNumber: "TP 777", departureTime: "2026-06-05T09:00:00" }],
      },
      { type: "trip", id: tripId }
    );
    await runDocumentLinkPass(userId);
    expect(await rows(docId)).toEqual([]);
    const late = await prisma.flight.create({
      data: flightData({ flightNumber: "TP 777", departureTime: new Date("2026-06-05T09:00:00Z") }),
    });
    await runDocumentLinkPass(userId);
    expect((await rows(docId)).map((r) => r.entryId)).toEqual([late.id]);
  });

  it("a suggestion decided meanwhile cannot be accepted afterwards, and links nothing", async () => {
    const docId = await keep(
      {
        domain: "flight",
        flights: [{ flightNumber: "TP 888", departureTime: "2026-06-06T09:00:00" }],
      },
      { type: "trip", id: tripId }
    );
    const target = await prisma.flight.create({
      data: flightData({ flightNumber: "TP 888", departureTime: new Date("2026-06-06T09:00:00Z") }),
    });
    await runDocumentLinkPass(userId);
    const [row] = await rows(docId);
    await post(`/document-link-suggestions/${docId}/dismiss`, { suggestionIds: [row.id] });
    const late = await post(`/document-link-suggestions/${docId}/accept`, {
      suggestionIds: [row.id],
    });
    expect(late.status).toBe(404);
    expect(
      await prisma.documentLink.count({ where: { documentId: docId, flightId: target.id } })
    ).toBe(0);
  });

  it("shows nothing to another account, and refuses its decisions", async () => {
    const list = await get("/document-link-suggestions", strangerCookie);
    expect(list.body.data.suggestions).toEqual([]);
    const any = await prisma.documentLinkSuggestion.findFirstOrThrow({
      where: { userId, status: "pending" },
    });
    const refused = await post(
      `/document-link-suggestions/${any.documentId}/accept`,
      {},
      strangerCookie
    );
    expect(refused.status).toBe(404);
    expect(
      (await prisma.documentLinkSuggestion.findUniqueOrThrow({ where: { id: any.id } })).status
    ).toBe("pending");
  });
});
