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

  it("keeps a note, clears it with blank, and shows it on the document", async () => {
    const doc = await keep("note");
    const set = await api("patch", `/documents/${doc.id}`).send({
      note: "  Zimmer 12, Frühstück inklusive ",
    });
    expect(set.status).toBe(200);
    expect(set.body.data.note).toBe("Zimmer 12, Frühstück inklusive");
    expect((await api("get", `/documents/${doc.id}`)).body.data.note).toBe(
      "Zimmer 12, Frühstück inklusive"
    );
    const cleared = await api("patch", `/documents/${doc.id}`).send({ note: "   " });
    expect(cleared.body.data.note).toBeNull();
  });

  describe("entry search (the picker searched a derived subset)", () => {
    const hits = async (docId: string, q: string) =>
      (
        (await api("get", `/documents/${docId}/link-candidates?q=${encodeURIComponent(q)}`)).body
          .data.otherEntries as { label: string }[]
      ).map((e) => e.label);

    it("finds an entry that sits beyond the 400th row of its type, by text, case-insensitively", async () => {
      const doc = await keep("search");
      await prisma.flight.create({ data: flight("ZZ9999", new Date("2020-01-01T00:00:00Z")) });
      await prisma.flight.createMany({
        data: Array.from({ length: 450 }, (_, i) => flight(`AB${1000 + i}`)),
      });

      const recent = await api("get", `/documents/${doc.id}/link-candidates`);
      const labels = (recent.body.data.otherEntries as { label: string }[]).map((e) => e.label);
      expect(labels.some((l) => l.includes("ZZ9999"))).toBe(false);

      const found = await hits(doc.id, "zz9999");
      expect(found).toHaveLength(1);
      expect(found[0]).toContain("ZZ9999");
    });

    it("matches every term, and a year or month term against the entry's date", async () => {
      const doc = await keep("terms");
      await prisma.flight.create({
        data: { ...flight("QQ1111"), departureTime: new Date("2019-03-15T08:00:00Z") },
      });
      await prisma.flight.create({
        data: { ...flight("QQ2222"), departureTime: new Date("2018-03-15T08:00:00Z") },
      });
      expect(await hits(doc.id, "QQ 2019")).toEqual([expect.stringContaining("QQ1111")]);
      expect(await hits(doc.id, "qq 2019-03")).toEqual([expect.stringContaining("QQ1111")]);
      expect(await hits(doc.id, "QQ 2020")).toEqual([]);
    });
  });

  it("files with the entry the request created, not with another of the same domain created at the same time", async () => {
    const doc = await keep("exact");
    const body = (day: string, extra: object = {}) => ({
      departure: { iata: "MUC", lat: 48.35, lon: 11.79 },
      arrival: { iata: "CGN", lat: 50.87, lon: 7.14 },
      departureLocal: `${day}T08:25`,
      depTimezone: "Europe/Berlin",
      arrivalLocal: `${day}T09:30`,
      arrTimezone: "Europe/Berlin",
      status: "flown",
      ...extra,
    });
    // Two creates of the same domain in flight together: only one carries the document.
    const [other, mine] = await Promise.all([
      api("post", "/flights").send(body("2011-05-01")),
      api("post", "/flights").send(body("2011-05-02", { documentIds: [doc.id] })),
    ]);
    expect(other.status).toBe(201);
    expect(mine.status).toBe(201);
    expect(await prisma.document.findUnique({ where: { id: doc.id } })).toMatchObject({
      flightId: mine.body.flight.id,
      unlinkedAt: null,
    });
    expect(mine.body.flight.id).not.toBe(other.body.flight.id);
  });
});
