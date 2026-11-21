import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import fs from "fs";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { documentPath } from "../../services/documents/documentStore";
import { createDocument } from "../../services/documents/documentService";
import { scopeFileForRemoteMember } from "../../services/trip/exchange/memberScope";
import type { TripFile } from "../../services/trip/exchange/format";
import { visitDocumentCounts } from "../../services/places/visitDocumentCounts";

/**
 * Plan D2 (docs/superpowers/specs/2026-11-21-document-links.md): entry lists
 * read primary AND covers links, a covers document names where it was filed,
 * counts are distinct documents, links are made and removed by hand, and a link
 * never shows a document to anyone but its own account.
 */
const PDF = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n% ${tag}\n%%EOF`);

describe("document links — reads and manual link/unlink (D2)", () => {
  const stamp = Date.now();
  let ownerId: string;
  let memberId: string;
  let ownerCookie: string;
  let memberCookie: string;
  let tripId: string;
  let otherTripId: string;
  let flightId: string;
  let flight2Id: string;
  let memberFlightId: string;
  let visitId: string;
  let memberTripId: string;
  let groupId: string;

  const flightData = (userId: string, extra: object = {}) => ({
    userId,
    flightNumber: "LH400",
    depIata: "FRA",
    depLat: 50.03,
    depLon: 8.56,
    arrIata: "JFK",
    arrLat: 40.64,
    arrLon: -73.78,
    departureTime: new Date("2024-05-01T08:00:00Z"),
    status: "flown",
    ...extra,
  });
  const keep = async (tag: string, entry?: { type: "trip" | "flight"; id: string }) =>
    (await createDocument({ userId: ownerId, buffer: PDF(`${stamp}-${tag}`), entry })).document;
  const get = (path: string, cookie = ownerCookie) =>
    request(app).get(`/api/v1${path}`).set("Cookie", cookie);
  const post = (path: string, body: object, cookie = ownerCookie) =>
    request(app).post(`/api/v1${path}`).set("Cookie", cookie).send(body);
  const del = (path: string, cookie = ownerCookie) =>
    request(app).delete(`/api/v1${path}`).set("Cookie", cookie);

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    ownerId = (
      await prisma.user.create({ data: { username: `doclinks-owner-${stamp}`, passwordHash } })
    ).id;
    memberId = (
      await prisma.user.create({ data: { username: `doclinks-member-${stamp}`, passwordHash } })
    ).id;
    ownerCookie = `auth_token=${generateToken(ownerId)}`;
    memberCookie = `auth_token=${generateToken(memberId)}`;
    groupId = (await prisma.tripShareGroup.create({ data: { createdById: ownerId } })).id;
    tripId = (
      await prisma.trip.create({
        data: { userId: ownerId, name: "Rundreise USA", shareGroupId: groupId },
      })
    ).id;
    otherTripId = (await prisma.trip.create({ data: { userId: ownerId, name: "Andere" } })).id;
    memberTripId = (
      await prisma.trip.create({
        data: { userId: memberId, name: "Rundreise USA", shareGroupId: groupId },
      })
    ).id;
    flightId = (await prisma.flight.create({ data: flightData(ownerId, { tripId }) })).id;
    flight2Id = (await prisma.flight.create({ data: flightData(ownerId, { tripId }) })).id;
    memberFlightId = (
      await prisma.flight.create({ data: flightData(memberId, { tripId: memberTripId }) })
    ).id;
    const place = await prisma.place.create({
      data: { userId: ownerId, name: "Hoover Dam", lat: 36, lon: -114, category: "other" },
    });
    visitId = (
      await prisma.placeVisit.create({ data: { userId: ownerId, placeId: place.id, tripId } })
    ).id;
  });

  afterAll(async () => {
    const rows = await prisma.document.findMany({ where: { userId: { in: [ownerId, memberId] } } });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, memberId] } } });
    await prisma.tripShareGroup.delete({ where: { id: groupId } });
  });

  it("lists a covers document on the flight with 'evidence from' the trip it is filed at, and once on the trip", async () => {
    const doc = await keep("rundreise", { type: "trip", id: tripId });
    const linked = await post(`/documents/${doc.id}/links`, {
      links: [{ entry: { type: "flight", id: flightId } }],
    });
    expect(linked.status).toBe(201);
    expect(linked.body.data.map((l: { role: string }) => l.role).sort()).toEqual([
      "covers",
      "primary",
    ]);

    const onFlight = await get(`/flights/${flightId}/documents`);
    expect(onFlight.body.data).toHaveLength(1);
    expect(onFlight.body.data[0]).toMatchObject({
      id: doc.id,
      linkRole: "covers",
      linkCount: 2,
      evidenceFrom: { type: "trip", id: tripId, label: "Rundreise USA" },
      // The old field keeps its meaning: the document's primary entry.
      entry: { type: "trip", id: tripId },
    });
    const onTrip = await get(`/trips/${tripId}/documents`);
    expect(onTrip.body.data.filter((d: { id: string }) => d.id === doc.id)).toHaveLength(1);
    expect(onTrip.body.data.find((d: { id: string }) => d.id === doc.id)).toMatchObject({
      linkRole: "primary",
      evidenceFrom: null,
    });
  });

  it("counts a document once per scope however many entries it covers", async () => {
    const doc = await keep("visit-count", { type: "trip", id: tripId });
    await post(`/documents/${doc.id}/links`, {
      links: [
        { entry: { type: "placeVisit", id: visitId } },
        { entry: { type: "flight", id: flight2Id } },
      ],
    });
    expect((await visitDocumentCounts(ownerId, [visitId])).get(visitId)).toBe(1);
    const list = await get("/documents?limit=500");
    const rows = list.body.data.documents.filter((d: { id: string }) => d.id === doc.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].linkCount).toBe(3);
    const total = await prisma.document.count({ where: { userId: ownerId } });
    expect(list.body.data.total).toBe(total);
  });

  it("pages the account list over documents, not link rows", async () => {
    const doc = await keep("paging", { type: "trip", id: tripId });
    await post(`/documents/${doc.id}/links`, {
      links: [
        { entry: { type: "flight", id: flightId } },
        { entry: { type: "flight", id: flight2Id } },
      ],
    });
    const total = await prisma.document.count({ where: { userId: ownerId } });
    const seen: string[] = [];
    for (let offset = 0; offset < total; offset += 2) {
      const page = await get(`/documents?limit=2&offset=${offset}`);
      seen.push(...page.body.data.documents.map((d: { id: string }) => d.id));
    }
    expect(seen).toHaveLength(total);
    expect(new Set(seen).size).toBe(total);
  });

  it("answers 409 DOCUMENT_LINK_EXISTS for a duplicate and writes nothing of the batch", async () => {
    const doc = await keep("dup", { type: "flight", id: flightId });
    const res = await post(`/documents/${doc.id}/links`, {
      links: [
        { entry: { type: "flight", id: flight2Id } },
        { entry: { type: "flight", id: flightId } },
      ],
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("DOCUMENT_LINK_EXISTS");
    expect(await prisma.documentLink.count({ where: { documentId: doc.id } })).toBe(1);
  });

  it("answers 404 DOCUMENT_ENTRY_NOT_FOUND for a foreign entry and for one that is gone", async () => {
    const doc = await keep("foreign", { type: "flight", id: flightId });
    const foreign = await post(`/documents/${doc.id}/links`, {
      links: [{ entry: { type: "flight", id: memberFlightId } }],
    });
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe("DOCUMENT_ENTRY_NOT_FOUND");
    const gone = await prisma.flight.create({ data: flightData(ownerId) });
    await prisma.flight.delete({ where: { id: gone.id } });
    const missing = await post(`/documents/${doc.id}/links`, {
      links: [{ entry: { type: "flight", id: gone.id } }],
    });
    expect(missing.status).toBe(404);
    expect(missing.body.code).toBe("DOCUMENT_ENTRY_NOT_FOUND");
    expect(await prisma.documentLink.count({ where: { documentId: doc.id } })).toBe(1);
  });

  it("removes only the one link; removing the primary hands the role to a covers link; restore puts it back", async () => {
    const doc = await keep("unlink", { type: "trip", id: tripId });
    await post(`/documents/${doc.id}/links`, {
      links: [
        { entry: { type: "flight", id: flightId } },
        { entry: { type: "flight", id: flight2Id } },
      ],
    });
    const gone = await del(`/documents/${doc.id}/links?entryType=flight&entryId=${flight2Id}`);
    expect(gone.status).toBe(200);
    expect(gone.body.data).toMatchObject({ role: "covers", provenance: "user" });
    expect(await prisma.documentLink.count({ where: { documentId: doc.id } })).toBe(2);

    const primaryGone = await del(`/documents/${doc.id}/links?entryType=trip&entryId=${tripId}`);
    expect(primaryGone.body.data.role).toBe("primary");
    const links = await prisma.documentLink.findMany({ where: { documentId: doc.id } });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ flightId, role: "primary" });
    expect(await prisma.document.findUnique({ where: { id: doc.id } })).toMatchObject({
      flightId,
      tripId: null,
      unlinkedAt: null,
    });

    const restored = await post(`/documents/${doc.id}/links`, {
      links: [{ entry: primaryGone.body.data.entry, role: "primary", provenance: "user" }],
    });
    expect(restored.status).toBe(201);
    const roles = Object.fromEntries(
      restored.body.data.map((l: { entry: { type: string }; role: string }) => [
        l.entry.type,
        l.role,
      ])
    );
    expect(roles).toEqual({ trip: "primary", flight: "covers" });
  });

  it("answers 404 DOCUMENT_LINK_NOT_FOUND when the entry carries no link, and DOCUMENT_NOT_FOUND for a stranger's document", async () => {
    const doc = await keep("nolink", { type: "flight", id: flightId });
    const none = await del(`/documents/${doc.id}/links?entryType=flight&entryId=${flight2Id}`);
    expect(none.status).toBe(404);
    expect(none.body.code).toBe("DOCUMENT_LINK_NOT_FOUND");
    const stranger = await del(
      `/documents/${doc.id}/links?entryType=flight&entryId=${flightId}`,
      memberCookie
    );
    expect(stranger.status).toBe(404);
    expect(stranger.body.code).toBe("DOCUMENT_NOT_FOUND");
  });

  it("offers the trip's documents to an entry that lacks them, and the picker lists trip entries first", async () => {
    const doc = await keep("trip-offer", { type: "trip", id: tripId });
    const offer = await get(`/documents/trip-candidates?entryType=flight&entryId=${flight2Id}`);
    expect(offer.status).toBe(200);
    expect(offer.body.data.map((d: { id: string }) => d.id)).toContain(doc.id);
    await post(`/documents/${doc.id}/links`, {
      links: [{ entry: { type: "flight", id: flight2Id } }],
    });
    const after = await get(`/documents/trip-candidates?entryType=flight&entryId=${flight2Id}`);
    expect(after.body.data.map((d: { id: string }) => d.id)).not.toContain(doc.id);

    const other = await prisma.flight.create({
      data: flightData(ownerId, { tripId: otherTripId }),
    });
    const picker = await get(`/documents/${doc.id}/link-candidates`);
    expect(picker.status).toBe(200);
    const tripIds = picker.body.data.tripEntries.map((e: { id: string }) => e.id);
    expect(tripIds).toContain(flightId);
    expect(tripIds).not.toContain(flight2Id); // already linked
    expect(picker.body.data.otherEntries.map((e: { id: string }) => e.id)).toContain(other.id);
    expect(picker.body.data.otherEntries.map((e: { id: string }) => e.id)).not.toContain(
      memberFlightId
    );
  });

  describe("no new visibility (plan rule 6)", () => {
    it("shows a trip member nothing of a covers-linked document: no row, no name, no link", async () => {
      const doc = await keep("secret-booking", { type: "trip", id: tripId });
      await post(`/documents/${doc.id}/links`, {
        links: [{ entry: { type: "flight", id: flightId } }],
      });
      // The member's own copy of the shared trip carries no document.
      for (const path of [
        `/trips/${memberTripId}/documents`,
        `/flights/${memberFlightId}/documents`,
      ]) {
        const res = await get(path, memberCookie);
        expect(res.status).toBe(200);
        expect(res.body.data).toEqual([]);
      }
      // The owner's rows are another account's: 404, never 403, never a body.
      for (const path of [
        `/trips/${tripId}/documents`,
        `/flights/${flightId}/documents`,
        `/documents/${doc.id}`,
        `/documents/${doc.id}/file`,
        `/documents/${doc.id}/links`,
        `/documents/${doc.id}/link-candidates`,
      ]) {
        const res = await get(path, memberCookie);
        expect(res.status).toBe(404);
        expect(JSON.stringify(res.body)).not.toContain("secret-booking");
        expect(JSON.stringify(res.body)).not.toContain(doc.id);
      }
      const account = await get("/documents?limit=500", memberCookie);
      expect(account.body.data.documents).toEqual([]);
      // Nor can the member link their own flight to it, or take its link away.
      const tryLink = await post(
        `/documents/${doc.id}/links`,
        { links: [{ entry: { type: "flight", id: memberFlightId } }] },
        memberCookie
      );
      expect(tryLink.status).toBe(404);
      expect(await prisma.documentLink.count({ where: { documentId: doc.id } })).toBe(2);
    });

    it("keeps the remote-member strip: a file's documents never reach a guest", () => {
      const file = {
        trip: { private: {} },
        stays: [],
        ferry: [],
        roadtrips: [],
        documents: [{ key: "d1", file: "documents/d1.pdf", name: "secret-booking.pdf" }],
      } as unknown as TripFile;
      expect(scopeFileForRemoteMember(file).documents).toEqual([]);
    });
  });
});
