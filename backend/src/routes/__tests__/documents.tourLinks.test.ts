import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import fs from "fs";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { documentPath } from "../../services/documents/documentStore";
import { createDocument } from "../../services/documents/documentService";

/**
 * GitHub #415: a roadtrip / tour can carry documents (a ride app's screenshot, a GPX
 * export). Link, list, unlink, the cascade when the tour goes, and another account's
 * tour is refused.
 */
const PDF = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n% ${tag}\n%%EOF`);

describe("documents on a roadtrip / tour (GitHub #415)", () => {
  const stamp = Date.now();
  let ownerId: string;
  let otherId: string;
  let ownerCookie: string;
  let otherCookie: string;
  let tourId: string;
  let strangerTourId: string;

  const keep = async (tag: string) =>
    (await createDocument({ userId: ownerId, buffer: PDF(`${stamp}-${tag}`) })).document;
  const get = (path: string, cookie = ownerCookie) =>
    request(app).get(`/api/v1${path}`).set("Cookie", cookie);
  const post = (path: string, body: object, cookie = ownerCookie) =>
    request(app).post(`/api/v1${path}`).set("Cookie", cookie).send(body);
  const del = (path: string, cookie = ownerCookie) =>
    request(app).delete(`/api/v1${path}`).set("Cookie", cookie);

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    ownerId = (
      await prisma.user.create({ data: { username: `tourdoc-owner-${stamp}`, passwordHash } })
    ).id;
    otherId = (
      await prisma.user.create({ data: { username: `tourdoc-other-${stamp}`, passwordHash } })
    ).id;
    ownerCookie = `auth_token=${generateToken(ownerId)}`;
    otherCookie = `auth_token=${generateToken(otherId)}`;
    tourId = (
      await prisma.tripRoute.create({
        data: { userId: ownerId, name: "Alpine day ride", mode: "road" },
      })
    ).id;
    strangerTourId = (
      await prisma.tripRoute.create({ data: { userId: otherId, name: "Not yours", mode: "road" } })
    ).id;
  });

  afterAll(async () => {
    const rows = await prisma.document.findMany({ where: { userId: { in: [ownerId, otherId] } } });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    await prisma.user.deleteMany({ where: { id: { in: [ownerId, otherId] } } });
  });

  it("files a document on a tour at upload, lists it, and unlinks it", async () => {
    const upload = await request(app)
      .post("/api/v1/documents")
      .set("Cookie", ownerCookie)
      .field("entryType", "tour")
      .field("entryId", tourId)
      .attach("file", PDF(`${stamp}-upload`), {
        filename: "ride.pdf",
        contentType: "application/pdf",
      });
    expect(upload.status).toBe(201);
    const docId = upload.body.data.id as string;

    const listed = await get(`/tours/${tourId}/documents`);
    expect(listed.status).toBe(200);
    expect(listed.body.data).toHaveLength(1);
    expect(listed.body.data[0]).toMatchObject({
      id: docId,
      linkRole: "primary",
      entry: { type: "tour", id: tourId },
    });

    const removed = await del(`/documents/${docId}/links?entryType=tour&entryId=${tourId}`);
    expect(removed.status).toBeLessThan(300);
    expect((await get(`/tours/${tourId}/documents`)).body.data).toHaveLength(0);
    // The document itself stays, unfiled.
    expect((await get(`/documents/${docId}`)).status).toBe(200);
  });

  it("links an existing document to a tour as a second link", async () => {
    const doc = await keep("second");
    const linked = await post(`/documents/${doc.id}/links`, {
      links: [{ entry: { type: "tour", id: tourId } }],
    });
    expect(linked.status).toBe(201);
    const listed = await get(`/tours/${tourId}/documents`);
    expect(listed.body.data.map((d: { id: string }) => d.id)).toContain(doc.id);
  });

  it("offers the roadtrip in the link picker", async () => {
    const doc = await keep("picker");
    const res = await get(`/documents/${doc.id}/link-candidates?query=Alpine`);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).toContain(tourId);
  });

  it("refuses another account's tour, on upload and on link", async () => {
    const doc = await keep("stranger");
    const link = await post(`/documents/${doc.id}/links`, {
      links: [{ entry: { type: "tour", id: strangerTourId } }],
    });
    expect(link.status).toBe(404);
    const upload = await request(app)
      .post("/api/v1/documents")
      .set("Cookie", ownerCookie)
      .field("entryType", "tour")
      .field("entryId", strangerTourId)
      .attach("file", PDF(`${stamp}-stranger-up`), {
        filename: "x.pdf",
        contentType: "application/pdf",
      });
    expect(upload.status).toBe(404);
    // And the stranger's own list is not readable by the owner.
    expect((await get(`/tours/${strangerTourId}/documents`)).body.data ?? []).toHaveLength(0);
    expect((await get(`/tours/${tourId}/documents`, otherCookie)).body.data ?? []).toHaveLength(0);
  });

  it("keeps the document, unfiled with its grace clock, when the tour is deleted", async () => {
    const route = await prisma.tripRoute.create({
      data: { userId: ownerId, name: "Doomed", mode: "road" },
    });
    const doc = await keep("cascade");
    await post(`/documents/${doc.id}/links`, {
      links: [{ entry: { type: "tour", id: route.id } }],
    });
    await prisma.tripRoute.delete({ where: { id: route.id } });
    expect(await prisma.documentLink.count({ where: { documentId: doc.id } })).toBe(0);
    const after = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(after.tripRouteId).toBeNull();
    expect(after.unlinkedAt).not.toBeNull();
  });

  it("hands a removed roadtrip's documents to its trip instead of dropping them", async () => {
    const trip = await prisma.trip.create({ data: { userId: ownerId, name: "Alps" } });
    const route = await prisma.tripRoute.create({
      data: { userId: ownerId, tripId: trip.id, name: "Day", mode: "road" },
    });
    const doc = await keep("handover");
    await post(`/documents/${doc.id}/links`, {
      links: [{ entry: { type: "tour", id: route.id } }],
    });
    const gone = await del(`/tours/${route.id}`);
    expect(gone.status).toBeLessThan(300);
    const onTrip = await get(`/trips/${trip.id}/documents`);
    expect(onTrip.body.data.map((d: { id: string }) => d.id)).toContain(doc.id);
    expect(
      (await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).unlinkedAt
    ).toBeNull();
  });
});
