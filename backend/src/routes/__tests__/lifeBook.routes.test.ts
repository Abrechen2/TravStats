import fs from "fs";
import os from "os";
import path from "path";
import jpeg from "jpeg-js";
import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { getPlacePhotoDir } from "../../middleware/upload";
import { clearJobs, settleAllJobs } from "../../services/jobs/jobRegistry";
import { setClockForTests } from "../../shared/time/clock";
import { generateToken } from "../../utils/jwt";

/**
 * The life book's HTTP surface and its output, against a seeded account: a job
 * writes ONE offline HTML file that only its owner can download, that makes no
 * external request, that shows unknown dates as unknown, and that stops with a
 * clear code when it would be too large.
 */

const made: string[] = [];
const photoFiles: string[] = [];
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "lb-routes-"));
process.env.ACCOUNT_ARCHIVE_DIR = workDir;

async function makeUser(label: string) {
  const user = await prisma.user.create({
    data: {
      username: `lb-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      passwordHash: "x",
    },
  });
  made.push(user.id);
  await prisma.userSettings.create({ data: { userId: user.id, data: {} } });
  return { id: user.id, username: user.username, cookie: `auth_token=${generateToken(user.id)}` };
}

async function build(cookie: string, body: Record<string, unknown>) {
  const started = await request(app).post("/api/v1/me/life-book").set("Cookie", cookie).send(body);
  if (started.status !== 202) return { started, job: null };
  await settleAllJobs();
  const job = (
    await request(app).get(`/api/v1/jobs/${started.body.data.jobId}`).set("Cookie", cookie)
  ).body.data;
  return { started, job };
}

async function html(cookie: string, exportId: string): Promise<string> {
  const res = await request(app)
    .get(`/api/v1/me/life-book/${exportId}`)
    .set("Cookie", cookie)
    .buffer(true)
    .parse((r, cb) => {
      let data = "";
      r.setEncoding("utf8");
      r.on("data", (c) => (data += c));
      r.on("end", () => cb(null, data));
    });
  expect(res.status).toBe(200);
  expect(res.headers["content-type"]).toContain("text/html");
  return res.body as string;
}

let owner: Awaited<ReturnType<typeof makeUser>>;
let tripId: string;

beforeAll(async () => {
  setClockForTests("2026-11-22T10:00:00Z");
  owner = await makeUser("owner");
  const trip = await prisma.trip.create({
    data: {
      userId: owner.id,
      name: "Lissabon Frühling",
      startDay: new Date("2025-03-03T00:00:00Z"),
      endDay: new Date("2025-03-06T00:00:00Z"),
      countries: ["PT"],
      notes: "Wetter gut.",
    },
  });
  tripId = trip.id;
  const flight = await prisma.flight.create({
    data: {
      userId: owner.id,
      tripId,
      flightNumber: "TP 571",
      depIata: "FRA",
      arrIata: "LIS",
      depTimezone: "Europe/Berlin",
      arrTimezone: "Europe/Lisbon",
      // 23:30 UTC is 00:30 the NEXT day in Berlin: the book uses the local day
      departureTime: new Date("2025-03-02T23:30:00Z"),
      arrivalTime: new Date("2025-03-03T03:10:00Z"),
      depLat: 50.03,
      depLon: 8.57,
      arrLat: 38.77,
      arrLon: -9.13,
    },
  });
  await prisma.flight.create({
    data: {
      userId: owner.id,
      tripId,
      flightNumber: "XX 000",
      depIata: "LIS",
      arrIata: "OPO",
      depLat: 38.77,
      depLon: -9.13,
      arrLat: 41.24,
      arrLon: -8.67,
    },
  });
  const lodging = await prisma.lodging.create({
    data: {
      userId: owner.id,
      type: "hotel",
      name: "Hotel Avenida",
      city: "Lissabon",
      country: "PT",
      lat: 38.72,
      lon: -9.14,
    },
  });
  await prisma.lodgingStay.create({
    data: {
      userId: owner.id,
      tripId,
      lodgingId: lodging.id,
      checkInDate: new Date("2025-03-03T00:00:00Z"),
      checkOutDate: new Date("2025-03-06T00:00:00Z"),
      nights: 3,
    },
  });
  const place = await prisma.place.create({
    data: { userId: owner.id, name: "Torre de Belém", category: "sight", lat: 38.69, lon: -9.216 },
  });
  const visit = await prisma.placeVisit.create({
    data: {
      userId: owner.id,
      tripId,
      placeId: place.id,
      visitedAt: new Date("2025-03-04T00:00:00Z"),
      notes: "Lange Schlange.",
    },
  });
  const file = `lb-${Date.now()}.jpg`;
  const pixels = Buffer.alloc(1600 * 1000 * 4, 180);
  fs.writeFileSync(
    path.join(getPlacePhotoDir(), file),
    Buffer.from(jpeg.encode({ data: pixels, width: 1600, height: 1000 }, 80).data)
  );
  photoFiles.push(file);
  await prisma.placeVisitPhoto.create({
    data: {
      placeVisitId: visit.id,
      filename: file,
      mimetype: "image/jpeg",
      sizeBytes: 1000,
      caption: "Turm",
    },
  });
  await prisma.placeVisitPhoto.create({
    data: {
      placeVisitId: visit.id,
      filename: "missing.jpg",
      mimetype: "image/jpeg",
      sizeBytes: 10,
    },
  });
  const doc = await prisma.document.create({
    data: {
      userId: owner.id,
      storedName: "x.pdf",
      originalName: "secret-name.pdf",
      mimetype: "application/pdf",
      sizeBytes: 1,
      format: "pdf",
      kind: "boardingPass",
      source: "upload",
      sha256: "0".repeat(64),
    },
  });
  await prisma.documentLink.create({
    data: { documentId: doc.id, flightId: flight.id, role: "primary", provenance: "user" },
  });
  await prisma.tripJournalEntry.create({
    data: { tripId, date: new Date("2025-03-05T00:00:00Z"), body: "Pastéis de nata." },
  });
  // loose entry with a date and one without
  await prisma.flight.create({
    data: {
      userId: owner.id,
      flightNumber: "LOOSE 1",
      depIata: "FRA",
      arrIata: "MUC",
      depLat: 1,
      depLon: 2,
      arrLat: 3,
      arrLon: 4,
      departureTime: new Date("2024-06-01T10:00:00Z"),
      depTimezone: "UTC",
    },
  });
});

afterAll(async () => {
  setClockForTests(null);
  await prisma.user.deleteMany({ where: { id: { in: made } } });
  for (const f of photoFiles) fs.rmSync(path.join(getPlacePhotoDir(), f), { force: true });
  clearJobs();
  fs.rmSync(workDir, { recursive: true, force: true });
  delete process.env.LIFE_BOOK_MAX_BYTES;
});

describe("life book routes", () => {
  it("refuses an anonymous caller", async () => {
    expect((await request(app).post("/api/v1/me/life-book").send({ scope: "all" })).status).toBe(
      401
    );
  });

  it("rejects a malformed scope", async () => {
    const res = await request(app)
      .post("/api/v1/me/life-book")
      .set("Cookie", owner.cookie)
      .send({ scope: "year" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("LIFE_BOOK_INVALID");
  });

  it("builds one offline file for a trip: facts, map, local-day entries, evidence, a downscaled photo", async () => {
    const { job } = await build(owner.cookie, { scope: "trip", tripId, lang: "de" });
    expect(job.status).toBe("succeeded");
    expect(job.result).toMatchObject({ trips: 1, photos: 1, photosSkipped: 1 });
    const page = await html(owner.cookie, job.result.exportId);

    // no external request, no script
    expect(page).not.toMatch(/<script|<link[\s>]|@import/i);
    expect(page).not.toMatch(/\b(?:src|href)=["']\s*(?:https?:)?\/\//i);
    expect(page).not.toMatch(/url\(\s*["']?\s*(?:https?:)?\/\//i);
    for (const m of page.matchAll(/\bsrc="([^"]*)"/g))
      expect(m[1]).toMatch(/^data:image\/jpeg;base64,/);

    // header facts
    expect(page).toContain("Lissabon Frühling");
    expect(page).toContain("🇵🇹 Portugal");
    expect(page).toContain(owner.username);
    expect(page).toContain("<svg");
    // the 23:30Z departure is 00:30 on 3 March in Berlin: a local day, not the UTC day
    const day3 = page.slice(page.indexOf("3. März 2025"), page.indexOf("4. März 2025"));
    expect(day3).toContain("TP 571 FRA → LIS");
    expect(day3).toContain("00:30");
    expect(day3).toContain("Hotel Avenida");
    expect(page).toContain("Beleg: Bordkarte");
    expect(page).not.toContain("secret-name"); // kinds only, never file names
    expect(page).toContain("Torre de Belém");
    expect(page).toContain("Pastéis de nata.");
    // the flight without a departure time is "unknown", not on any day
    const undated = page.slice(page.indexOf('class="day undated"'));
    expect(undated).toContain("XX 000");
    expect(page.slice(0, page.indexOf('class="day undated"'))).not.toContain("XX 000");
    // the photo was embedded smaller than the 1600 px original
    const uri = /src="data:image\/jpeg;base64,([^"]+)"/.exec(page)![1];
    expect(jpeg.decode(Buffer.from(uri, "base64"), { useTArray: true }).width).toBe(900);
    // loose entries do not belong to a trip-scope book
    expect(page).not.toContain("LOOSE 1");
  });

  it("is reproducible: two builds of the same data are the same bytes", async () => {
    const a = (await build(owner.cookie, { scope: "trip", tripId, lang: "en" })).job;
    const b = (await build(owner.cookie, { scope: "trip", tripId, lang: "en" })).job;
    const pa = await html(owner.cookie, a.result.exportId);
    const pb = await html(owner.cookie, b.result.exportId);
    expect(pa).toBe(pb);
    expect(pa).toContain('<html lang="en">');
    expect(pa).toContain("Evidence: Boarding pass");
  });

  it("puts entries without a trip into a closing chapter in the 'all' book, filtered by year in a year book", async () => {
    const all = (await build(owner.cookie, { scope: "all", lang: "de" })).job;
    const allPage = await html(owner.cookie, all.result.exportId);
    expect(allPage).toContain('id="no-trip"');
    expect(allPage).toContain("LOOSE 1");
    const y2025 = (await build(owner.cookie, { scope: "year", year: 2025, lang: "de" })).job;
    const p2025 = await html(owner.cookie, y2025.result.exportId);
    expect(p2025).toContain("Lissabon Frühling");
    expect(p2025).not.toContain("LOOSE 1");
    const y2024 = (await build(owner.cookie, { scope: "year", year: 2024, lang: "de" })).job;
    const p2024 = await html(owner.cookie, y2024.result.exportId);
    expect(p2024).toContain("LOOSE 1");
    expect(p2024).not.toContain("Lissabon Frühling");
  });

  it("fails with LIFE_BOOK_EMPTY when the scope holds nothing", async () => {
    const { job } = await build(owner.cookie, { scope: "year", year: 1999, lang: "de" });
    expect(job.status).toBe("failed");
    expect(job.error.code).toBe("LIFE_BOOK_EMPTY");
  });

  it("stops with LIFE_BOOK_TOO_LARGE past the size limit and leaves no file behind", async () => {
    const before = fs.readdirSync(workDir).sort();
    process.env.LIFE_BOOK_MAX_BYTES = "2000";
    try {
      const { job } = await build(owner.cookie, { scope: "all", lang: "de" });
      expect(job.status).toBe("failed");
      expect(job.error).toEqual({ code: "LIFE_BOOK_TOO_LARGE", status: 413 });
      expect(fs.readdirSync(workDir).sort()).toEqual(before);
    } finally {
      delete process.env.LIFE_BOOK_MAX_BYTES;
    }
  });

  it("serves a book only to its owner, and refuses another account's trip", async () => {
    const other = await makeUser("other");
    const { job } = await build(owner.cookie, { scope: "trip", tripId, lang: "de" });
    const mine = await request(app)
      .get(`/api/v1/me/life-book/${job.result.exportId}`)
      .set("Cookie", other.cookie);
    expect(mine.status).toBe(404);

    const foreign = await request(app)
      .post("/api/v1/me/life-book")
      .set("Cookie", other.cookie)
      .send({ scope: "trip", tripId, lang: "de" });
    expect(foreign.status).toBe(404);
    expect(foreign.body.code).toBe("TRIP_NOT_FOUND");

    // another account's all-book holds none of this account's data
    const theirs = (await build(other.cookie, { scope: "all", lang: "de" })).job;
    expect(theirs.status).toBe("failed");
    expect(theirs.error.code).toBe("LIFE_BOOK_EMPTY");
  });
});
