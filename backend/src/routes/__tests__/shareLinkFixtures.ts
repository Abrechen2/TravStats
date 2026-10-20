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
  "PRIVATE standalone note",
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
  // A standalone note on the trip's days that was never marked shareable
  // (forgejo#146): it must not appear whatever the link offers.
  await prisma.note.create({
    data: {
      userId: ownerId,
      body: "PRIVATE standalone note",
      occurredAt: new Date("2030-06-03T12:00:00Z"),
      occurredZone: "America/New_York",
      placeName: "PRIVATE standalone note place",
    },
  });
  return trip;
}

/** Values on itinerary entries that must never reach a public view (forgejo#302). */
export const NEVER_ON_ITINERARY = [
  "STAY-BOOKING-REF-77",
  "ROOM-1408",
  "PRIVATE stay note",
  "CABIN-8123",
  "CRUISE-BOOKING-REF-55",
  "PRIVATE cruise note",
  "RAIL-SEAT-42D",
  "RAIL-PNR-Q7W8E9",
  "PRIVATE rail note",
  "BUS-SEAT-17",
  "BUS-BOOKING-REF-31",
  "FERRY-TICKET-REF-66",
  "FERRY-PLATE-B-XY-123",
  "RENTAL-CONF-90210",
  "RENTAL-PLATE-NY-4455",
  "PRIVATE rental note",
  "PRIVATE visit note",
  "PRIVATE stop note",
  "Coraline Copassenger",
  // Prices: no amount of any entry may travel.
  "1234.5",
  "4321.75",
  "88.4",
  "543.21",
];

/**
 * A trip with one entry of every kind the itinerary lists, each carrying the
 * private values of `NEVER_ON_ITINERARY`, plus a cancelled flight and a
 * cancelled stay that must not be listed. The trip runs 1–8 June 2030 (New York).
 */
export async function makeItineraryTrip(ownerId: string) {
  const trip = await makeTrip(ownerId);
  const flight = await makeFlight(ownerId, trip.id);
  const cancelledFlight = await prisma.flight.create({
    data: {
      userId: ownerId,
      tripId: trip.id,
      airline: "Lufthansa",
      flightNumber: "LH999-CANCELLED",
      depIata: "FRA",
      depLat: 50.0379,
      depLon: 8.5622,
      arrIata: "JFK",
      arrLat: 40.6413,
      arrLon: -73.7781,
      departureTime: new Date("2030-06-01T08:00:00Z"),
      arrivalTime: new Date("2030-06-01T16:00:00Z"),
      depTimeSemantics: "UTC",
      arrTimeSemantics: "UTC",
      status: "cancelled",
    },
  });
  const lodging = await prisma.lodging.create({
    data: {
      userId: ownerId,
      name: "Hotel Hudson View",
      address: "356 W 58th St",
      city: "New York",
      country: "US",
      notes: "PRIVATE stay note",
    },
  });
  const stay = await prisma.lodgingStay.create({
    data: {
      lodgingId: lodging.id,
      userId: ownerId,
      tripId: trip.id,
      checkIn: new Date("2030-06-01T00:00:00Z"),
      checkOut: new Date("2030-06-04T00:00:00Z"),
      checkInDate: new Date("2030-06-01T00:00:00Z"),
      checkOutDate: new Date("2030-06-04T00:00:00Z"),
      checkInAt: new Date("2030-06-01T22:00:00Z"),
      checkOutAt: new Date("2030-06-04T15:00:00Z"),
      stayZone: "America/New_York",
      status: "scheduled",
      roomNumber: "ROOM-1408",
      bookingReference: "STAY-BOOKING-REF-77",
      totalPrice: 1234.5,
      pricePerNight: 411.5,
      notes: "PRIVATE stay note",
      companions: ["Coraline Copassenger"],
    },
  });
  const cancelledLodging = await prisma.lodging.create({
    data: { userId: ownerId, name: "Cancelled Motel" },
  });
  await prisma.lodgingStay.create({
    data: {
      lodgingId: cancelledLodging.id,
      userId: ownerId,
      tripId: trip.id,
      checkInDate: new Date("2030-06-02T00:00:00Z"),
      checkOutDate: new Date("2030-06-03T00:00:00Z"),
      stayZone: "America/New_York",
      status: "cancelled",
    },
  });
  const rail = await prisma.railJourney.create({
    data: {
      userId: ownerId,
      tripId: trip.id,
      operator: "Amtrak",
      trainCategory: "Acela",
      trainNumber: "2151",
      depStationName: "New York Penn Station",
      depLat: 40.7506,
      depLon: -73.9935,
      depTimezone: "America/New_York",
      arrStationName: "Washington Union Station",
      arrLat: 38.8973,
      arrLon: -77.0063,
      arrTimezone: "America/New_York",
      departureTime: new Date("2030-06-04T16:00:00Z"),
      arrivalTime: new Date("2030-06-04T19:30:00Z"),
      seat: "RAIL-SEAT-42D",
      bookingReference: "RAIL-PNR-Q7W8E9",
      price: 4321.75,
      notes: "PRIVATE rail note",
      companions: ["Coraline Copassenger"],
    },
  });
  const bus = await prisma.busJourney.create({
    data: {
      userId: ownerId,
      tripId: trip.id,
      operator: "Greyhound",
      lineName: "GL 1234",
      depStationName: "Washington Union Station",
      depLat: 38.8973,
      depLon: -77.0063,
      depTimezone: "America/New_York",
      arrStationName: "Port Authority Bus Terminal",
      arrLat: 40.757,
      arrLon: -73.9903,
      arrTimezone: "America/New_York",
      departureTime: new Date("2030-06-05T13:00:00Z"),
      arrivalTime: new Date("2030-06-05T17:30:00Z"),
      seat: "BUS-SEAT-17",
      bookingReference: "BUS-BOOKING-REF-31",
      price: 88.4,
    },
  });
  const ferry = await prisma.ferryJourney.create({
    data: {
      userId: ownerId,
      tripId: trip.id,
      operator: "NYC Ferry",
      vesselName: "Hornblower Hybrid",
      depStationName: "Whitehall Terminal",
      depLat: 40.7013,
      depLon: -74.0131,
      depTimezone: "America/New_York",
      arrStationName: "St. George Terminal",
      arrLat: 40.6437,
      arrLon: -74.0736,
      arrTimezone: "America/New_York",
      departureTime: new Date("2030-06-06T13:00:00Z"),
      arrivalTime: new Date("2030-06-06T13:25:00Z"),
      ticketReference: "FERRY-TICKET-REF-66",
      vehicleRegistration: "FERRY-PLATE-B-XY-123",
      price: 543.21,
    },
  });
  const rental = await prisma.rentalBooking.create({
    data: {
      userId: ownerId,
      tripId: trip.id,
      provider: "Hertz",
      confirmationNumber: "RENTAL-CONF-90210",
      licensePlate: "RENTAL-PLATE-NY-4455",
      pickupStationName: "Hertz Manhattan West",
      pickupLat: 40.77,
      pickupLon: -73.99,
      pickupTimezone: "America/New_York",
      returnStationName: "Hertz JFK Airport",
      returnLat: 40.6413,
      returnLon: -73.7781,
      returnTimezone: "America/New_York",
      pickupTime: new Date("2030-06-06T15:00:00Z"),
      returnTime: new Date("2030-06-07T14:00:00Z"),
      price: 1234.5,
      notes: "PRIVATE rental note",
    },
  });
  const cruise = await prisma.cruise.create({
    data: {
      userId: ownerId,
      tripId: trip.id,
      shipNameOverride: "Harbor Queen",
      cruiseLine: "Circle Line",
      startDay: new Date("2030-06-07T00:00:00Z"),
      endDay: new Date("2030-06-08T00:00:00Z"),
      startZone: "America/New_York",
      endZone: "America/New_York",
      cabinNumber: "CABIN-8123",
      bookingReference: "CRUISE-BOOKING-REF-55",
      price: 4321.75,
      notes: "PRIVATE cruise note",
      companions: ["Coraline Copassenger"],
      stops: {
        create: [
          {
            dayNumber: 1,
            unresolvedPortName: "Pier 83",
            stopDate: new Date("2030-06-07T00:00:00Z"),
            stopZone: "America/New_York",
            departureUtc: new Date("2030-06-07T22:00:00Z"),
            timePrecision: "minute",
          },
          {
            dayNumber: 2,
            isAtSea: true,
            stopDate: new Date("2030-06-08T00:00:00Z"),
            stopZone: "America/New_York",
          },
        ],
      },
    },
  });
  const place = await prisma.place.create({
    data: {
      userId: ownerId,
      name: "Statue of Liberty",
      city: "New York",
      lat: 40.6892,
      lon: -74.0445,
      notes: "PRIVATE visit note",
    },
  });
  const visit = await prisma.placeVisit.create({
    data: {
      placeId: place.id,
      userId: ownerId,
      tripId: trip.id,
      visitedAtUtc: new Date("2030-06-02T14:00:00Z"),
      visitedZone: "America/New_York",
      visitedPrecision: "minute",
      notes: "PRIVATE visit note",
    },
  });
  const stop = await prisma.tripStop.create({
    data: {
      tripId: trip.id,
      title: "Central Park picnic",
      startUtc: new Date("2030-06-03T04:00:00Z"),
      stopZone: "America/New_York",
      precision: "day",
      lat: 40.7829,
      lon: -73.9654,
      notes: "PRIVATE stop note",
    },
  });
  return {
    trip,
    ids: [
      trip.id,
      flight.id,
      cancelledFlight.id,
      lodging.id,
      stay.id,
      rail.id,
      bus.id,
      ferry.id,
      rental.id,
      cruise.id,
      place.id,
      visit.id,
      stop.id,
    ],
  };
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
