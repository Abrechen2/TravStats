import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import fs from "fs";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";
import { documentPath } from "../../services/documents/documentStore";

/**
 * forgejo#239: a rental's hand-over evidence filed by what it shows (pickup,
 * return, damage, fuel, odometer) — a label on the EXISTING document, so no
 * file is copied and every attachment kept before stays as it was
 * (uncategorised). Every value is invented.
 */
const JPEG = (tag: number): Buffer =>
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, tag]);

describe("rental document categories", () => {
  const stamp = Date.now();
  let userId: string;
  let cookie: string;
  let rentalId: string;
  let flightId: string;

  const upload = (fields: Record<string, string>, tag: number) => {
    let req = request(app).post("/api/v1/documents").set("Cookie", cookie);
    for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
    return req.attach("file", JPEG(tag), {
      filename: `foto-${tag}.jpg`,
      contentType: "image/jpeg",
    });
  };
  const patch = (id: string, body: Record<string, unknown>) =>
    request(app).patch(`/api/v1/documents/${id}`).set("Cookie", cookie).send(body);

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: {
          username: `docs-rental-cat-${stamp}`,
          passwordHash: await hashPassword("test-password"),
        },
      })
    ).id;
    cookie = `auth_token=${generateToken(userId)}`;
    const created = await request(app)
      .post("/api/v1/rentals")
      .set("Cookie", cookie)
      .send({
        provider: "Testcar",
        pickupStation: { iata: "FRA", name: "Frankfurt Flughafen" },
        pickupLocal: "2026-07-01T10:00",
        returnLocal: "2026-07-05T09:30",
      });
    rentalId = created.body.data.id;
    flightId = (
      await prisma.flight.create({
        data: {
          userId,
          depIata: "FRA",
          depLat: 50.03,
          depLon: 8.56,
          arrIata: "MUC",
          arrLat: 48.35,
          arrLon: 11.78,
          departureTime: new Date("2024-05-01T08:00:00Z"),
          status: "flown",
        },
      })
    ).id;
  });

  afterAll(async () => {
    const rows = await prisma.document.findMany({ where: { userId } });
    for (const row of rows) fs.rmSync(documentPath(row.storedName), { force: true });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  it("files an upload under its category and lists it so", async () => {
    const res = await upload(
      { entryType: "rentalBooking", entryId: rentalId, rentalCategory: "damage" },
      1
    );
    expect(res.status).toBe(201);
    expect(res.body.data.rentalCategory).toBe("damage");
    const list = await request(app)
      .get(`/api/v1/rentals/${rentalId}/documents`)
      .set("Cookie", cookie);
    expect(list.body.data.map((d: { rentalCategory: string }) => d.rentalCategory)).toContain(
      "damage"
    );
  });

  it("keeps an attachment without a category uncategorised (null), and recategorises it in place", async () => {
    const res = await upload({ entryType: "rentalBooking", entryId: rentalId }, 2);
    expect(res.body.data.rentalCategory).toBeNull();
    const before = await prisma.document.count({ where: { userId } });
    const moved = await patch(res.body.data.id, { rentalCategory: "odometer" });
    expect(moved.status).toBe(200);
    expect(moved.body.data).toMatchObject({ id: res.body.data.id, rentalCategory: "odometer" });
    // A label, not a copy: the same document, no new row.
    expect(await prisma.document.count({ where: { userId } })).toBe(before);
    const cleared = await patch(res.body.data.id, { rentalCategory: null });
    expect(cleared.body.data.rentalCategory).toBeNull();
  });

  it("files a re-sent, still uncategorised copy under the chosen category, and keeps a chosen one", async () => {
    const first = await upload({ entryType: "rentalBooking", entryId: rentalId }, 9);
    expect(first.body.data.rentalCategory).toBeNull();
    const again = await upload(
      { entryType: "rentalBooking", entryId: rentalId, rentalCategory: "damage" },
      9
    );
    expect(again.status).toBe(200);
    expect(again.body.data).toMatchObject({ id: first.body.data.id, rentalCategory: "damage" });
    const third = await upload(
      { entryType: "rentalBooking", entryId: rentalId, rentalCategory: "fuel" },
      9
    );
    expect(third.body.data.rentalCategory).toBe("damage");
  });

  it("files an unfiled copy of the same bytes under the chosen category, not uncategorised", async () => {
    const first = await upload({ entryType: "rentalBooking", entryId: rentalId }, 11);
    await patch(first.body.data.id, { entry: null });
    const again = await upload(
      { entryType: "rentalBooking", entryId: rentalId, rentalCategory: "fuel" },
      11
    );
    expect(again.body.data).toMatchObject({
      id: first.body.data.id,
      rentalCategory: "fuel",
      entry: { type: "rentalBooking", id: rentalId },
    });
  });

  it("refuses a category on a document filed with anything but a rental", async () => {
    const res = await upload({ entryType: "flight", entryId: flightId, rentalCategory: "fuel" }, 3);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: "DOCUMENT_CATEGORY_NOT_RENTAL",
      field: "rentalCategory",
    });
  });

  it("drops the category when the document leaves the rental", async () => {
    const res = await upload(
      { entryType: "rentalBooking", entryId: rentalId, rentalCategory: "fuel" },
      4
    );
    const unfiled = await patch(res.body.data.id, { entry: null });
    expect(unfiled.status).toBe(200);
    expect(unfiled.body.data.rentalCategory).toBeNull();
  });

  it("refuses an unknown category", async () => {
    const res = await upload(
      { entryType: "rentalBooking", entryId: rentalId, rentalCategory: "windscreen" },
      5
    );
    expect(res.status).toBe(400);
  });

  it("holds the rule in the database too", async () => {
    const doc = await prisma.document.findFirstOrThrow({
      where: { userId, rentalBookingId: null },
    });
    await expect(
      prisma.document.update({ where: { id: doc.id }, data: { rentalCategory: "fuel" } })
    ).rejects.toThrow();
  });
});
