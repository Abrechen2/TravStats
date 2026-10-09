import fs from "fs";
import path from "path";
import request from "supertest";
import { unzipSync, zipSync, strToU8 } from "fflate";
import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { getTripPhotoDir } from "../../middleware/upload";
import { readTripArchive } from "../../services/trip/exchange/readArchive";
import { TRIP_FILE_LIMITS } from "../../services/trip/exchange/format";
import { seedFullTrip, type SeededTrip } from "./tripExchange.fixture";

/**
 * One trip as a `.travstats` file, end to end (spec 2026-10-09 S3): export,
 * import into another account, re-import, partial overlap, and every refusal
 * a hostile or broken file meets.
 */
const stamp = Date.now();

const binary = (res: request.Response, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

interface TestUser {
  id: string;
  cookie: string;
}

async function user(name: string): Promise<TestUser> {
  const u = await prisma.user.create({ data: { username: `${name}-${stamp}`, passwordHash: "x" } });
  return { id: u.id, cookie: `auth_token=${generateToken(u.id)}` };
}

describe("trip export / import (.travstats)", () => {
  let owner: TestUser;
  let friend: TestUser;
  let plain: TestUser;
  let overlap: TestUser;
  let stranger: TestUser;
  let seeded: SeededTrip;
  let fullFile: Buffer;
  const users = (): TestUser[] => [owner, friend, plain, overlap, stranger];

  const exportTrip = (u: TestUser, query: string) =>
    request(app)
      .get(`/api/v1/trips/${seeded.tripId}/export${query}`)
      .set("Cookie", u.cookie)
      .buffer(true)
      .parse(binary);
  const send = (u: TestUser, step: "preview" | "commit", file: Buffer, name = "trip.travstats") =>
    request(app)
      .post(`/api/v1/trips/import/${step}`)
      .set("Cookie", u.cookie)
      .attach("file", file, name);

  beforeAll(async () => {
    owner = await user("tx-owner");
    friend = await user("tx-friend");
    plain = await user("tx-plain");
    overlap = await user("tx-overlap");
    stranger = await user("tx-stranger");
    seeded = await seedFullTrip(owner.id, stamp);
    const res = await exportTrip(owner, "?documents=1&photos=1&private=1");
    expect(res.status).toBe(200);
    fullFile = res.body as Buffer;
  });

  afterAll(async () => {
    const ids = users().map((u) => u.id);
    const photos = await prisma.tripPhoto.findMany({
      where: { trip: { userId: { in: ids } } },
      select: { filename: true },
    });
    for (const p of photos) fs.rmSync(path.join(getTripPhotoDir(), p.filename), { force: true });
    await prisma.document.deleteMany({ where: { userId: { in: ids } } });
    await prisma.user.deleteMany({ where: { id: { in: ids } } });
    await prisma.port.deleteMany({ where: { id: seeded.portId } });
    await prisma.$disconnect();
  });

  it("refuses another user's trip as not found", async () => {
    const res = await exportTrip(stranger, "");
    expect(res.status).toBe(404);
  });

  it("writes manifest and facts only by default — no private field, no files", async () => {
    const res = await exportTrip(owner, "");
    expect(res.status).toBe(200);
    expect(res.headers["content-disposition"]).toMatch(/\.travstats"$/);
    const entries = unzipSync(new Uint8Array(res.body as Buffer));
    expect(Object.keys(entries).sort()).toEqual(["manifest.json", "trip.json"]);
    const manifest = JSON.parse(Buffer.from(entries["manifest.json"]).toString());
    expect(manifest).toMatchObject({
      format: "travstats-trip",
      formatVersion: 1,
      options: { documents: false, photos: false, private: false },
    });
    const text = Buffer.from(entries["trip.json"]).toString();
    expect(text).not.toContain('"private"');
    expect(text).not.toContain("12A");
    expect(text).not.toContain("aisle please");
    const trip = JSON.parse(text);
    expect(trip.flights[0]).toMatchObject({
      departureTime: "2026-05-01T06:35:00.000Z",
      depTimezone: "Europe/Berlin",
    });
    expect(trip.bookings[0].price).toBe(1800);
    expect(trip.journal).toBeUndefined();
  });

  it("carries documents, photos and private fields when asked", () => {
    const { file, blobs } = readTripArchive(fullFile);
    expect(file.flights[0].private).toMatchObject({ seatNumber: "12A", price: 240 });
    expect(file.documents).toHaveLength(1);
    expect(file.photos).toHaveLength(1);
    expect(file.journal).toHaveLength(1);
    expect(blobs.size).toBe(2);
  });

  it("imports into a second account with the same facts", async () => {
    const preview = await send(friend, "preview", fullFile);
    expect(preview.status).toBe(200);
    const proposal = preview.body.data.proposal;
    expect(proposal.trip.action).toBe("create");
    expect(new Set(proposal.entries.map((e: { action: string }) => e.action))).toEqual(
      new Set(["create"])
    );
    expect(proposal.entries.map((e: { kind: string }) => e.kind).sort()).toEqual(
      ["cruise", "flight", "rail", "rental", "stay", "stop", "visit"].sort()
    );

    const commit = await send(friend, "commit", fullFile);
    expect(commit.status).toBe(201);
    expect(commit.body.data.documents).toEqual({ filed: 1, skipped: 0, refused: 0 });
    expect(commit.body.data.photos).toBe(1);

    const trip = await prisma.trip.findUniqueOrThrow({
      where: { id: commit.body.data.tripId },
      include: {
        flights: true,
        lodgingStays: { include: { lodging: true } },
        cruises: { include: { stops: { orderBy: { dayNumber: "asc" } } } },
        railJourneys: true,
        rentalBookings: true,
        placeVisits: { include: { place: true } },
        stops: true,
        journalEntries: true,
        photos: true,
        bookings: true,
        documents: true,
      },
    });
    expect(trip.userId).toBe(friend.id);
    expect(trip.name).toBe("Lissabon & Atlantik");
    expect(trip.flights[0]).toMatchObject({
      flightNumber: "TP579",
      departureTime: new Date("2026-05-01T06:35:00Z"),
      depTimezone: "Europe/Berlin",
      seatNumber: "12A",
      bookingId: trip.bookings[0].id,
    });
    expect(trip.bookings[0]).toMatchObject({ price: 1800, currency: "EUR" });
    expect(trip.lodgingStays[0]).toMatchObject({
      roomNumber: "404",
      nights: 3,
      stayZone: "Europe/Lisbon",
    });
    expect(trip.lodgingStays[0].checkInDate?.toISOString().slice(0, 10)).toBe("2026-05-01");
    expect(
      trip.cruises[0].stops.map((s) => [s.portId !== null, s.isAtSea, s.unresolvedPortName])
    ).toEqual([
      [true, false, null],
      [false, true, null],
      [false, false, "Atlantis"],
    ]);
    expect(trip.railJourneys[0]).toMatchObject({ trainNumber: "AP 133", seat: "61" });
    expect(trip.rentalBookings[0]).toMatchObject({ provider: "Sixt", licensePlate: "AA-00-BB" });
    expect(trip.placeVisits[0]).toMatchObject({ rating: 5, visitedZone: "Europe/Lisbon" });
    expect(trip.placeVisits[0].place.userId).toBe(friend.id);
    expect(trip.stops[0]).toMatchObject({ title: "Belém", placeId: trip.placeVisits[0].placeId });
    expect(trip.journalEntries).toHaveLength(1);
    expect(trip.photos[0]).toMatchObject({ stopId: trip.stops[0].id, mimetype: "image/png" });
    expect(trip.documents).toHaveLength(1);
  });

  it("writes nothing new when the same file is imported again", async () => {
    const count = async () =>
      Promise.all([
        prisma.trip.count({ where: { userId: friend.id } }),
        prisma.flight.count({ where: { userId: friend.id } }),
        prisma.lodgingStay.count({ where: { userId: friend.id } }),
        prisma.cruise.count({ where: { userId: friend.id } }),
        prisma.railJourney.count({ where: { userId: friend.id } }),
        prisma.rentalBooking.count({ where: { userId: friend.id } }),
        prisma.placeVisit.count({ where: { userId: friend.id } }),
        prisma.place.count({ where: { userId: friend.id } }),
        prisma.tripStop.count({ where: { trip: { userId: friend.id } } }),
        prisma.tripJournalEntry.count({ where: { trip: { userId: friend.id } } }),
        prisma.tripPhoto.count({ where: { trip: { userId: friend.id } } }),
        prisma.document.count({ where: { userId: friend.id } }),
        prisma.booking.count({ where: { userId: friend.id } }),
      ]);
    const before = await count();
    const preview = await send(friend, "preview", fullFile);
    expect(preview.body.data.proposal.trip).toMatchObject({
      action: "attach",
      matchedBy: "bookingReference",
    });
    expect(
      preview.body.data.proposal.entries.filter((e: { action: string }) => e.action !== "skip")
    ).toEqual([]);
    const commit = await send(friend, "commit", fullFile);
    expect(commit.status).toBe(201);
    expect(commit.body.data).toMatchObject({ created: 0, attached: 0, photos: 0 });
    expect(await count()).toEqual(before);
  });

  it("leaves private fields out of an import of a default export", async () => {
    const res = await exportTrip(owner, "");
    const commit = await send(plain, "commit", res.body as Buffer);
    expect(commit.status).toBe(201);
    const flight = await prisma.flight.findFirstOrThrow({ where: { userId: plain.id } });
    expect(flight).toMatchObject({
      seatNumber: null,
      price: null,
      notes: null,
      flightNumber: "TP579",
    });
    const stay = await prisma.lodgingStay.findFirstOrThrow({ where: { userId: plain.id } });
    expect(stay).toMatchObject({ roomNumber: null, ratingOverall: null });
    expect(await prisma.tripJournalEntry.count({ where: { trip: { userId: plain.id } } })).toBe(0);
    expect(await prisma.document.count({ where: { userId: plain.id } })).toBe(0);
  });

  it("attaches what the account already holds and creates the rest", async () => {
    const loose = await prisma.flight.create({
      data: {
        userId: overlap.id,
        externalRef: seeded.flightRef,
        flightNumber: "TP579",
        depLat: 50.03,
        depLon: 8.57,
        arrLat: 38.77,
        arrLon: -9.13,
        departureTime: new Date("2026-05-01T06:35:00Z"),
        depTimezone: "Europe/Berlin",
      },
    });
    const preview = await send(overlap, "preview", fullFile);
    const flight = preview.body.data.proposal.entries.find(
      (e: { kind: string }) => e.kind === "flight"
    );
    expect(flight).toMatchObject({ action: "attach", id: loose.id });
    const commit = await send(overlap, "commit", fullFile);
    expect(commit.status).toBe(201);
    expect(commit.body.data).toMatchObject({ attached: 1 });
    const after = await prisma.flight.findMany({ where: { userId: overlap.id } });
    expect(after).toHaveLength(1);
    expect(after[0].tripId).toBe(commit.body.data.tripId);
    expect(after[0].bookingId).not.toBeNull();
  });

  describe("refusals", () => {
    const zip = (entries: Record<string, string | Uint8Array>): Buffer =>
      Buffer.from(
        zipSync(
          Object.fromEntries(
            Object.entries(entries).map(([k, v]) => [k, typeof v === "string" ? strToU8(v) : v])
          )
        )
      );
    const manifest = (over: Record<string, unknown> = {}) =>
      JSON.stringify({
        format: "travstats-trip",
        formatVersion: 1,
        appVersion: "2.7.0",
        exportedAt: "2026-10-09T10:00:00.000Z",
        options: { documents: false, photos: false, private: false },
        ...over,
      });

    const expectCode = async (file: Buffer, status: number, code: string) => {
      const res = await send(stranger, "preview", file);
      expect(res.status).toBe(status);
      expect(res.body.code).toBe(code);
    };

    it("asks for a file", async () => {
      const res = await request(app)
        .post("/api/v1/trips/import/preview")
        .set("Cookie", stranger.cookie);
      expect(res.status).toBe(400);
    });

    it("refuses bytes that are not a ZIP", () =>
      expectCode(Buffer.from("definitely not a zip"), 422, "TRIP_FILE_INVALID"));

    it("refuses a path that climbs out of the archive", () =>
      expectCode(
        zip({ "manifest.json": manifest(), "trip.json": "{}", "../../etc/evil.txt": "x" }),
        422,
        "TRIP_FILE_UNSAFE_PATH"
      ));

    it("refuses an unknown format version by name", async () => {
      const res = await send(
        stranger,
        "preview",
        zip({ "manifest.json": manifest({ formatVersion: 2 }), "trip.json": "{}" })
      );
      expect(res.status).toBe(422);
      expect(res.body).toMatchObject({ code: "TRIP_FILE_VERSION_UNSUPPORTED", formatVersion: 2 });
    });

    it("refuses a trip.json that breaks the schema", () =>
      expectCode(
        zip({ "manifest.json": manifest(), "trip.json": JSON.stringify({ trip: { name: "" } }) }),
        422,
        "TRIP_FILE_INVALID"
      ));

    it("refuses a dangling reference inside trip.json", () => {
      const { file } = readTripArchive(fullFile);
      const broken = {
        ...file,
        documents: [],
        photos: [],
        visits: [{ ...file.visits[0], placeKey: "p99" }],
      };
      return expectCode(
        zip({ "manifest.json": manifest(), "trip.json": JSON.stringify(broken) }),
        422,
        "TRIP_FILE_INVALID"
      );
    });

    it("refuses an archive that inflates past its cap, counted as inflated", () => {
      const bomb = zip({
        "manifest.json": manifest(),
        "trip.json": "x".repeat(2 * 1024 * 1024),
      });
      expect(bomb.length).toBeLessThan(64 * 1024);
      expect(() =>
        readTripArchive(bomb, { ...TRIP_FILE_LIMITS, maxTripJsonBytes: 1024 * 1024 })
      ).toThrow(expect.objectContaining({ statusCode: 413, code: "TRIP_FILE_TOO_LARGE" }));
      expect(() =>
        readTripArchive(bomb, { ...TRIP_FILE_LIMITS, maxTotalBytes: 1024 * 1024 })
      ).toThrow(expect.objectContaining({ code: "TRIP_FILE_TOO_LARGE" }));
    });

    it("does not believe a header that understates the unpacked size", () => {
      const bomb = zip({ "manifest.json": manifest(), "trip.json": "x".repeat(2 * 1024 * 1024) });
      // Rewrite every declared uncompressed size of trip.json to 10 bytes.
      for (let at = 0; at < bomb.length - 4; at++) {
        const sig = bomb.readUInt32LE(at);
        if (sig === 0x04034b50 && bomb.readUInt32LE(at + 22) > 1024)
          bomb.writeUInt32LE(10, at + 22);
        if (sig === 0x02014b50 && bomb.readUInt32LE(at + 24) > 1024)
          bomb.writeUInt32LE(10, at + 24);
      }
      expect(() =>
        readTripArchive(bomb, { ...TRIP_FILE_LIMITS, maxTripJsonBytes: 1024 * 1024 })
      ).toThrow(expect.objectContaining({ code: "TRIP_FILE_TOO_LARGE" }));
    });

    it("refuses more entries than allowed", () => {
      const many: Record<string, string> = { "manifest.json": manifest(), "trip.json": "{}" };
      for (let i = 0; i < 12; i++) many[`photos/p${i}.png`] = "x";
      expect(() => readTripArchive(zip(many), { ...TRIP_FILE_LIMITS, maxEntries: 10 })).toThrow(
        expect.objectContaining({ code: "TRIP_FILE_TOO_LARGE" })
      );
    });

    it("never lets an import write into the stranger's account by accident", async () => {
      expect(await prisma.trip.count({ where: { userId: stranger.id } })).toBe(0);
    });
  });
});
