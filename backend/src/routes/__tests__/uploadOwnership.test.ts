import * as fs from "fs";
import * as path from "path";

import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { getUploadDir } from "../../middleware/upload";

/**
 * Knowing a file's URL is not the same as being allowed to read it.
 *
 * Ownership used to be derived from a reference: "does this caller own a flight
 * or a stay whose receiptUrl is this file". A caller writes their own flights,
 * so the check answered yes to anyone who typed the URL into one — B created a
 * flight pointing at A's receipt and could then fetch, and delete, A's file
 * (audit finding AUD-019). The reference proved only that B had typed the URL.
 *
 * The file now carries its owner, written at upload time from the session.
 */
const A = "uploadOwnerA";
const B = "uploadOwnerB";

// A 68-byte PNG: the smallest thing the magic-number validation accepts.
const PNG = Buffer.from(
  "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de" +
    "0000000c4944415408d763f8cfc0000003010100b5a1a0210000000049454e44ae426082",
  "hex"
);

const cookiesOf = (res: request.Response): string[] =>
  (res.headers["set-cookie"] as unknown as string[]) ?? [];

async function makeUser(username: string): Promise<void> {
  await prisma.user.deleteMany({ where: { username } });
  await prisma.user.create({
    data: { username, passwordHash: await hashPassword("password123") },
  });
}

async function login(username: string): Promise<string[]> {
  const res = await request(app)
    .post("/api/v1/auth/login")
    .send({ username, password: "password123" });
  return cookiesOf(res);
}

describe("receipt uploads belong to whoever uploaded them", () => {
  let cookieA: string[];
  let cookieB: string[];
  let filename: string;
  let receiptUrl: string;

  beforeAll(async () => {
    await makeUser(A);
    await makeUser(B);
    cookieA = await login(A);
    cookieB = await login(B);

    const upload = await request(app)
      .post("/api/v1/uploads/receipt")
      .set("Cookie", cookieA)
      .attach("receipt", PNG, { filename: "receipt.png", contentType: "image/png" });

    expect(upload.status).toBe(201);
    filename = upload.body.filename;
    receiptUrl = upload.body.receiptUrl;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { in: [A, B] } } });
    if (filename) {
      const onDisk = path.join(getUploadDir(), filename);
      if (fs.existsSync(onDisk)) fs.rmSync(onDisk, { force: true });
    }
  });

  it("records the uploader as the owner", async () => {
    const row = await prisma.receiptUpload.findUnique({ where: { filename } });
    const owner = await prisma.user.findUnique({ where: { username: A } });
    expect(row?.userId).toBe(owner?.id);
  });

  it("serves the file to its owner", async () => {
    const res = await request(app).get(receiptUrl).set("Cookie", cookieA);
    expect(res.status).toBe(200);
  });

  // The reproduction, exactly as the audit ran it.
  it("refuses another account that points its own flight at the file", async () => {
    const before = await request(app).get(receiptUrl).set("Cookie", cookieB);
    expect(before.status).toBe(404);

    const flight = await request(app)
      .post("/api/v1/flights")
      .set("Cookie", cookieB)
      .send({
        flightNumber: "LH400",
        departure: { iata: "FRA", lat: 50.0379, lon: 8.5622 },
        arrival: { iata: "JFK", lat: 40.6413, lon: -73.7781 },
        departureLocal: "2026-08-14T14:35",
        depTimezone: "Europe/Berlin",
        arrivalLocal: "2026-08-14T16:50",
        arrTimezone: "America/New_York",
        receiptUrl,
      });

    // The flight MUST be created for this test to mean anything. A rejected
    // payload would leave B with no reference at all, and the 404 below would
    // then prove nothing — the test would pass against the very bug it exists
    // to catch.
    expect(flight.status).toBe(201);
    const stored = await prisma.flight.findUnique({
      where: { id: flight.body.flight.id },
      select: { receiptUrl: true },
    });
    expect(stored?.receiptUrl).toBe(receiptUrl);

    const after = await request(app).get(receiptUrl).set("Cookie", cookieB);
    expect(after.status).toBe(404);
  });

  it("refuses another account trying to delete the file", async () => {
    const res = await request(app)
      .delete(`/api/v1/uploads/receipts/${filename}`)
      .set("Cookie", cookieB);
    expect(res.status).toBe(404);

    // And it is still there for its owner.
    expect((await request(app).get(receiptUrl).set("Cookie", cookieA)).status).toBe(200);
  });
});
