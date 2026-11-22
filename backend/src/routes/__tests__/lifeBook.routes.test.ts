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

let partial: Awaited<ReturnType<typeof makeUser>>;

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
  // a flight known only to the day shows no clock; a stay known only to the month shows no day
  await prisma.flight.create({
    data: {
      userId: owner.id,
      tripId,
      flightNumber: "DAYONLY 1",
      depIata: "OPO",
      arrIata: "FRA",
      depTimezone: "Europe/Lisbon",
      departureTime: new Date("2025-03-06T12:00:00Z"),
      depPrecision: "day",
      depLat: 41.24,
      depLon: -8.67,
      arrLat: 50.03,
      arrLon: 8.57,
    },
  });
  await prisma.lodgingStay.create({
    data: {
      userId: owner.id,
      tripId,
      lodgingId: lodging.id,
      checkInDate: new Date("2025-03-01T00:00:00Z"),
      datePrecision: "MONTH",
    },
  });
  // a visit without a trip, with a photo of its own
  const looseFile = `lb-loose-${Date.now()}.jpg`;
  fs.writeFileSync(
    path.join(getPlacePhotoDir(), looseFile),
    Buffer.from(
      jpeg.encode({ data: Buffer.alloc(400 * 300 * 4, 90), width: 400, height: 300 }, 80).data
    )
  );
  photoFiles.push(looseFile);
  const loosePlace = await prisma.place.create({
    data: { userId: owner.id, name: "Loose Place", category: "sight", lat: 10, lon: 10 },
  });
  const looseVisit = await prisma.placeVisit.create({
    data: { userId: owner.id, placeId: loosePlace.id, visitedAt: new Date("2024-07-01T00:00:00Z") },
  });
  await prisma.placeVisitPhoto.create({
    data: {
      placeVisitId: looseVisit.id,
      filename: looseFile,
      mimetype: "image/jpeg",
      sizeBytes: 10,
      caption: "Loose photo",
    },
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
  // A separate account: the build endpoint is rate-limited per user.
  partial = await makeUser("partial");
  // Known only to the year (a Jan 1 00:00 UTC placeholder; a zone conversion would make it Dec 2014)
  await prisma.flight.create({
    data: {
      userId: partial.id,
      flightNumber: "YEARONLY 1",
      depIata: "JFK",
      arrIata: "LAX",
      depLat: 1,
      depLon: 2,
      arrLat: 3,
      arrLon: 4,
      departureTime: new Date("2015-01-01T00:00:00Z"),
      depTimezone: "America/New_York",
      depTimeSemantics: "UNKNOWN",
      depPrecision: "year",
    },
  });
  // A stay known only to the month: its rendered day is null
  const monthLodging = await prisma.lodging.create({
    data: { userId: partial.id, name: "MONTHSTAY Inn", city: "Nice", lat: 43.7, lon: 7.26 },
  });
  await prisma.lodgingStay.create({
    data: {
      userId: partial.id,
      lodgingId: monthLodging.id,
      checkIn: new Date("2016-03-01T00:00:00Z"),
      datePrecision: "MONTH",
      status: "completed",
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
    // day-precise flight: on its day, without an invented clock
    const day6 = page.slice(page.indexOf("6. März 2025"), page.indexOf('class="day undated"'));
    expect(day6).toContain("DAYONLY 1");
    expect(day6).not.toMatch(/class="time">1[0-9]:/);
    // a month-precise stay is unknown, with what is known, and not on 1 March
    expect(page.slice(page.indexOf('class="day undated"'))).toContain("Bekannt ist nur 2025-03");
    expect(page).not.toContain("1. März 2025");
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
    // a visit without a trip keeps its photograph in the book
    expect(allPage).toContain("Loose photo");
    expect(all.result.photos).toBe(2);
    const y2025 = (await build(owner.cookie, { scope: "year", year: 2025, lang: "de" })).job;
    const p2025 = await html(owner.cookie, y2025.result.exportId);
    expect(p2025).toContain("Lissabon Frühling");
    expect(p2025).not.toContain("LOOSE 1");
    expect(p2025).not.toContain("Loose photo");
    const y2024 = (await build(owner.cookie, { scope: "year", year: 2024, lang: "de" })).job;
    const p2024 = await html(owner.cookie, y2024.result.exportId);
    expect(p2024).toContain("LOOSE 1");
    expect(p2024).toContain("Loose photo");
    expect(p2024).not.toContain("Lissabon Frühling");
  });

  it("keeps a year-only flight in its own year under 'unknown date', not in December before", async () => {
    const y2015 = (await build(partial.cookie, { scope: "year", year: 2015, lang: "en" })).job;
    expect(y2015.status).toBe("succeeded");
    const p2015 = await html(partial.cookie, y2015.result.exportId);
    expect(p2015).toContain("YEARONLY 1");
    expect(p2015).toContain("2015 · No known date");
    const y2014 = (await build(partial.cookie, { scope: "year", year: 2014, lang: "en" })).job;
    expect(y2014.status).toBe("failed");
    expect(y2014.error.code).toBe("LIFE_BOOK_EMPTY");
  });

  it("includes a month-precision stay in the year book instead of dropping it", async () => {
    const y2016 = (await build(partial.cookie, { scope: "year", year: 2016, lang: "en" })).job;
    expect(y2016.status).toBe("succeeded");
    const page = await html(partial.cookie, y2016.result.exportId);
    expect(page).toContain("MONTHSTAY Inn");
    expect(page).toContain("2016-03 · No known date");
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

  it("refuses to serve a book past its six-hour wait even before the sweep removed it", async () => {
    const { job } = await build(owner.cookie, { scope: "trip", tripId, lang: "de" });
    const real = Date.now();
    const spy = jest.spyOn(Date, "now").mockReturnValue(real + 7 * 60 * 60 * 1000);
    try {
      const res = await request(app)
        .get(`/api/v1/me/life-book/${job.result.exportId}`)
        .set("Cookie", owner.cookie);
      expect(res.status).toBe(404);
    } finally {
      spy.mockRestore();
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
