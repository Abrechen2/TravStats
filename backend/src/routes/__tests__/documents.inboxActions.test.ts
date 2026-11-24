import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { createDocument } from "../../services/documents/documentService";

/**
 * The inbox's unfiled-documents section (forgejo#425 follow-up, 2026-11-24):
 * rename, find ANY entry by text, and file a document with the entry created
 * from it.
 */
const PDF = (tag: string): Buffer => Buffer.from(`%PDF-1.4\n% ${tag}\n%%EOF`);

describe("documents — inbox actions", () => {
  const stamp = Date.now();
  let userId: string;
  let otherId: string;
  let cookie: string;
  let otherCookie: string;

  const flight = (flightNumber: string, createdAt?: Date) => ({
    userId,
    flightNumber,
    depIata: "FRA",
    depLat: 50.03,
    depLon: 8.56,
    arrIata: "JFK",
    arrLat: 40.64,
    arrLon: -73.78,
    departureTime: new Date("2024-05-01T08:00:00Z"),
    status: "flown",
    ...(createdAt && { createdAt }),
  });
  const keep = async (tag: string) =>
    (await createDocument({ userId, buffer: PDF(`${stamp}-${tag}`) })).document;
  const api = (method: "get" | "post" | "patch", path: string, c = cookie) =>
    request(app)[method](`/api/v1${path}`).set("Cookie", c);

  beforeAll(async () => {
    const passwordHash = await hashPassword("test-password");
    userId = (await prisma.user.create({ data: { username: `inboxact-${stamp}`, passwordHash } }))
      .id;
    otherId = (
      await prisma.user.create({ data: { username: `inboxact-other-${stamp}`, passwordHash } })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    otherCookie = `auth_token=${generateToken(otherId)}`;
  });

  afterAll(async () => {
    await prisma.document.deleteMany({ where: { userId: { in: [userId, otherId] } } });
    await prisma.flight.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
  });

  it("renames a document through PATCH displayName and refuses an empty name", async () => {
    const doc = await keep("rename");
    const ok = await api("patch", `/documents/${doc.id}`).send({
      displayName: "  Hotel Lissabon.pdf ",
    });
    expect(ok.status).toBe(200);
    expect(ok.body.data.displayName).toBe("Hotel Lissabon.pdf");
    const empty = await api("patch", `/documents/${doc.id}`).send({ displayName: "   " });
    expect(empty.status).toBe(400);
    const row = await prisma.document.findUniqueOrThrow({ where: { id: doc.id } });
    expect(row.originalName).toBe("Hotel Lissabon.pdf");
  });

  it("finds an entry older than the recent-40 cap by searching its label (picker searched a derived subset)", async () => {
    const doc = await keep("search");
    const old = new Date("2020-01-01T00:00:00Z");
    await prisma.flight.create({ data: flight("ZZ9999", old) });
    await prisma.flight.createMany({
      data: Array.from({ length: 45 }, (_, i) => flight(`AB${1000 + i}`)),
    });

    const capped = await api("get", `/documents/${doc.id}/link-candidates`);
    const labels = (capped.body.data.otherEntries as { label: string }[]).map((e) => e.label);
    expect(labels.some((l) => l.includes("ZZ9999"))).toBe(false);

    const found = await api("get", `/documents/${doc.id}/link-candidates?q=zz9999`);
    expect(found.status).toBe(200);
    const hits = found.body.data.otherEntries as { label: string; type: string }[];
    expect(hits).toHaveLength(1);
    expect(hits[0].label).toContain("ZZ9999");
  });

  it("files a document with the entry created since the dialog opened, and reports null when none", async () => {
    const doc = await keep("new-entry");
    const before = new Date();
    const none = await api("post", `/documents/${doc.id}/file-with-new-entry`).send({
      domain: "flight",
      openedAt: new Date(Date.now() + 60_000).toISOString(),
    });
    expect(none.status).toBe(200);
    expect(none.body.data.entry).toBeNull();

    const created = await prisma.flight.create({ data: flight("NE0001") });
    const filed = await api("post", `/documents/${doc.id}/file-with-new-entry`).send({
      domain: "flight",
      openedAt: before.toISOString(),
    });
    expect(filed.status).toBe(200);
    expect(filed.body.data.entry).toEqual({ type: "flight", id: created.id });
    expect(await prisma.document.findUnique({ where: { id: doc.id } })).toMatchObject({
      flightId: created.id,
      unlinkedAt: null,
    });
  });

  it("does not file somebody else's document", async () => {
    const doc = await keep("foreign");
    const res = await api("post", `/documents/${doc.id}/file-with-new-entry`, otherCookie).send({
      domain: "flight",
      openedAt: new Date(0).toISOString(),
    });
    expect(res.status).toBe(404);
  });
});
