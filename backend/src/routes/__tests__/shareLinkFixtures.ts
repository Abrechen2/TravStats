/**
 * Test helpers for the public share-link suites (forgejo#281): a slim app,
 * accounts with a session cookie, and a flight and a trip whose private
 * columns are filled with values that must NEVER reach a public view — so a
 * suite can search the response for them.
 */
import fs from "fs";
import path from "path";

import cookieParser from "cookie-parser";
import express from "express";

import { prisma } from "../../db";
import { errorHandler } from "../../middleware/errorHandler";
import { getTripPhotoDir } from "../../middleware/upload";
import { generateToken } from "../../utils/jwt";
import publicShareLinkRoutes from "../publicShareLinks";
import shareLinkRoutes from "../shareLinks";
import sharePageRouter from "../sharePage";

export const SHARE_LINK_TEST_PREFIX = "sharelink-test-";

/**
 * Mounted slim, like the export suite: importing `index.ts` boots the
 * schedulers and their Prisma clients. `trust proxy: loopback`, as in the
 * container, so a test can give itself an address via X-Forwarded-For.
 */
export function shareLinkApp(extra?: (app: express.Express) => void): express.Express {
  const app = express();
  app.set("trust proxy", "loopback");
  app.use(cookieParser());
  app.use(express.json());
  extra?.(app);
  app.use("/api/v1/share-links", shareLinkRoutes);
  app.use("/api/v1/public/share-links", publicShareLinkRoutes);
  app.use("/share", sharePageRouter);
  app.use(errorHandler);
  return app;
}

export interface TestAccount {
  id: string;
  cookie: string;
}

export async function makeAccount(
  name: string,
  extra: { isDemo?: boolean; username?: string } = {}
) {
  const user = await prisma.user.create({
    data: {
      username: extra.username ?? `${SHARE_LINK_TEST_PREFIX}${name}`,
      passwordHash: "x",
      firstName: name,
      lastName: "Secretlastname",
      isDemo: extra.isDemo ?? false,
    },
  });
  return { id: user.id, cookie: `auth_token=${generateToken(user.id)}` } satisfies TestAccount;
}

export async function wipeShareLinkAccounts(): Promise<void> {
  await prisma.user.deleteMany({
    where: { OR: [{ username: { startsWith: SHARE_LINK_TEST_PREFIX } }, { username: "demo" }] },
  });
  const dir = getTripPhotoDir();
  if (fs.existsSync(dir)) {
    for (const name of fs.readdirSync(dir)) {
      if (name.startsWith(SHARE_LINK_TEST_PREFIX)) fs.unlinkSync(path.join(dir, name));
    }
  }
}

/** Values that may not appear in any public view, whatever is chosen. */
export const NEVER_PUBLIC = [
  "SEAT-14C",
  "PNR-XYZ123",
  "TICKET-2201234567",
  "PRIVATE flight note",
  "PRIVATE trip note",
  "Coraline Copassenger",
  "D-AIXA-REG",
  "FF-MILES-998877",
  "Secretlastname",
  "private-tag",
  "PRIVATE journal text",
  "PRIVATE caption",
];

/** A flight with every private column filled, at the pinned clock's future. */
export async function makeFlight(ownerId: string, tripId: string | null = null) {
  return prisma.flight.create({
    data: {
      userId: ownerId,
      tripId,
      airline: "Lufthansa",
      flightNumber: "LH400",
      aircraft: "Airbus A350-900",
      aircraftRegistration: "D-AIXA-REG",
      depIata: "FRA",
      depName: "Frankfurt",
      depLat: 50.0379,
      depLon: 8.5622,
      depTimezone: "Europe/Berlin",
      arrIata: "JFK",
      arrName: "New York JFK",
      arrLat: 40.6413,
      arrLon: -73.7781,
      arrTimezone: "America/New_York",
      departureTime: new Date("2030-06-01T12:00:00Z"),
      arrivalTime: new Date("2030-06-01T20:00:00Z"),
      depTimeSemantics: "UTC",
      arrTimeSemantics: "UTC",
      status: "scheduled",
      seatNumber: "SEAT-14C",
      bookingReference: "PNR-XYZ123",
      ticketNumber: "TICKET-2201234567",
      frequentFlyerNumber: "FF-MILES-998877",
      notes: "PRIVATE flight note",
      price: 987.65,
      coPassengers: ["Coraline Copassenger"],
      companions: ["Coraline Copassenger"],
      tags: ["private-tag"],
    },
  });
}

export async function makeTrip(ownerId: string) {
  const trip = await prisma.trip.create({
    data: {
      userId: ownerId,
      name: "New York 2030",
      startDay: new Date("2030-06-01T00:00:00Z"),
      endDay: new Date("2030-06-08T00:00:00Z"),
      startZone: "Europe/Berlin",
      endZone: "America/New_York",
      notes: "PRIVATE trip note",
      tags: ["private-tag"],
      companions: ["Gina Guest"],
    },
  });
  await prisma.tripJournalEntry.create({
    data: { tripId: trip.id, date: new Date("2030-06-02T00:00:00Z"), body: "PRIVATE journal text" },
  });
  return trip;
}

/** A JPEG with an Exif block (orientation 6 plus a planted GPS marker) and a comment. */
export function jpegWithExif(): Buffer {
  const tiff = Buffer.alloc(8 + 2 + 12 + 4);
  tiff.write("MM", 0, "latin1");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(1, 8);
  tiff.writeUInt16BE(0x0112, 10);
  tiff.writeUInt16BE(3, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(6, 18);
  tiff.writeUInt32BE(0, 22);
  const exifPayload = Buffer.concat([
    Buffer.from("Exif\0\0", "latin1"),
    tiff,
    Buffer.from("GPS-SECRET-48.137N-11.575E", "latin1"),
  ]);
  const segment = (marker: number, payload: Buffer) => {
    const head = Buffer.from([0xff, marker, 0, 0]);
    head.writeUInt16BE(payload.length + 2, 2);
    return Buffer.concat([head, payload]);
  };
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    segment(0xe0, Buffer.from("JFIF\0\x01\x01\0\0\x01\0\x01\0\0", "latin1")),
    segment(0xe1, exifPayload),
    segment(0xed, Buffer.from("Photoshop 3.0\0IPTC-SECRET-BYLINE", "latin1")),
    segment(0xfe, Buffer.from("CAMERA-SERIAL-SECRET", "latin1")),
    segment(0xdb, Buffer.alloc(65, 1)),
    segment(0xda, Buffer.from([1, 1, 0, 0, 0x3f, 0])),
    Buffer.from([0x12, 0x34, 0x56, 0x78]),
    Buffer.from([0xff, 0xd9]),
  ]);
}

/** A photo file on disk and its row, with a caption and coordinates that must stay private. */
export async function addTripPhoto(
  tripId: string,
  sortIdx: number,
  bytes: Buffer | null = jpegWithExif(),
  mimetype = "image/jpeg"
) {
  const filename = `${SHARE_LINK_TEST_PREFIX}${tripId}-${sortIdx}.jpg`;
  fs.mkdirSync(getTripPhotoDir(), { recursive: true });
  if (bytes) fs.writeFileSync(path.join(getTripPhotoDir(), filename), bytes);
  return prisma.tripPhoto.create({
    data: {
      tripId,
      filename,
      mimetype,
      sizeBytes: bytes?.length ?? 0,
      sortIdx,
      caption: "PRIVATE caption",
      lat: 48.137,
      lon: 11.575,
    },
  });
}
