/**
 * A trip with one of everything a `.travstats` file carries — the source of
 * the round-trip tests in `trips.exchange.test.ts`.
 */
import fs from "fs";
import path from "path";
import { prisma } from "../../db";
import { getTripPhotoDir } from "../../middleware/upload";
import { createDocument } from "../../services/documents/documentService";

/** A 1×1 PNG — a real image, so the document and photo format checks pass. */
export const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
/** A second, different PNG (other bytes, other hash) for the document. */
export const PNG_DOC = Buffer.concat([PNG, Buffer.from("trailing-doc-bytes")]);

export interface SeededTrip {
  tripId: string;
  flightRef: string;
  photoFile: string;
  portId: number;
}

export async function seedFullTrip(userId: string, stamp: number): Promise<SeededTrip> {
  const port = await prisma.port.create({
    data: {
      name: `Testhafen ${stamp}`,
      unlocode: `ZT${String(stamp).slice(-3)}`,
      lat: 38.7,
      lon: -9.1,
      isUserAdded: true,
    },
  });
  const trip = await prisma.trip.create({
    data: {
      userId,
      name: "Lissabon & Atlantik",
      color: "#818cf8",
      startDate: new Date("2026-05-01T00:00:00Z"),
      endDate: new Date("2026-05-12T00:00:00Z"),
      startDay: new Date("2026-05-01T00:00:00Z"),
      endDay: new Date("2026-05-12T00:00:00Z"),
      startZone: "Europe/Berlin",
      endZone: "Europe/Lisbon",
      notes: "Trip notes (private)",
      countries: ["PT"],
    },
  });
  const booking = await prisma.booking.create({
    data: {
      userId,
      tripId: trip.id,
      pnr: `TSX${stamp}`.slice(0, 12),
      price: 1800,
      currency: "EUR",
    },
  });
  const flightRef = `test:flight:${stamp}`;
  await prisma.flight.create({
    data: {
      userId,
      tripId: trip.id,
      bookingId: booking.id,
      externalRef: flightRef,
      flightNumber: "TP579",
      airlineIata: "TP",
      depIata: "FRA",
      depName: "Frankfurt",
      depLat: 50.03,
      depLon: 8.57,
      arrIata: "LIS",
      arrName: "Lisbon",
      arrLat: 38.77,
      arrLon: -9.13,
      departureTime: new Date("2026-05-01T06:35:00Z"),
      arrivalTime: new Date("2026-05-01T09:20:00Z"),
      depTimezone: "Europe/Berlin",
      arrTimezone: "Europe/Lisbon",
      status: "scheduled",
      seatNumber: "12A",
      price: 240,
      currency: "EUR",
      notes: "aisle please",
    },
  });
  const lodging = await prisma.lodging.create({
    data: {
      userId,
      name: `Hotel Tejo ${stamp}`,
      city: "Lisboa",
      country: "Portugal",
      lat: 38.71,
      lon: -9.14,
    },
  });
  await prisma.lodgingStay.create({
    data: {
      userId,
      lodgingId: lodging.id,
      tripId: trip.id,
      bookingId: booking.id,
      checkIn: new Date("2026-05-01T00:00:00Z"),
      checkOut: new Date("2026-05-04T00:00:00Z"),
      checkInDate: new Date("2026-05-01T00:00:00Z"),
      checkOutDate: new Date("2026-05-04T00:00:00Z"),
      stayZone: "Europe/Lisbon",
      nights: 3,
      status: "scheduled",
      board: "breakfast",
      roomNumber: "404",
      ratingOverall: 4.5,
    },
  });
  await prisma.cruise.create({
    data: {
      userId,
      tripId: trip.id,
      bookingId: booking.id,
      shipNameOverride: "MS Testschiff",
      bookingReference: `CRZ${stamp}`.slice(0, 14),
      startDate: new Date("2026-05-04T00:00:00Z"),
      endDate: new Date("2026-05-08T00:00:00Z"),
      startDay: new Date("2026-05-04T00:00:00Z"),
      endDay: new Date("2026-05-08T00:00:00Z"),
      status: "scheduled",
      cabinNumber: "8123",
      stops: {
        create: [
          { dayNumber: 1, portId: port.id, isAtSea: false },
          { dayNumber: 2, isAtSea: true },
          { dayNumber: 3, isAtSea: false, unresolvedPortName: "Atlantis" },
        ],
      },
    },
  });
  await prisma.railJourney.create({
    data: {
      userId,
      tripId: trip.id,
      operator: "CP",
      trainNumber: "AP 133",
      depStationName: "Lisboa Santa Apolónia",
      depLat: 38.71,
      depLon: -9.12,
      depTimezone: "Europe/Lisbon",
      arrStationName: "Porto Campanhã",
      arrLat: 41.15,
      arrLon: -8.59,
      arrTimezone: "Europe/Lisbon",
      departureTime: new Date("2026-05-09T08:00:00Z"),
      arrivalTime: new Date("2026-05-09T11:00:00Z"),
      seat: "61",
    },
  });
  await prisma.rentalBooking.create({
    data: {
      userId,
      tripId: trip.id,
      provider: "Sixt",
      pickupStationName: "Porto Airport",
      pickupLat: 41.24,
      pickupLon: -8.68,
      pickupTimezone: "Europe/Lisbon",
      returnStationName: "Porto Airport",
      returnLat: 41.24,
      returnLon: -8.68,
      returnTimezone: "Europe/Lisbon",
      pickupTime: new Date("2026-05-10T09:00:00Z"),
      returnTime: new Date("2026-05-12T09:00:00Z"),
      licensePlate: "AA-00-BB",
    },
  });
  const place = await prisma.place.create({
    data: { userId, name: "Torre de Belém", category: "sight", lat: 38.6916, lon: -9.216 },
  });
  await prisma.placeVisit.create({
    data: {
      userId,
      placeId: place.id,
      tripId: trip.id,
      visitedAtUtc: new Date("2026-05-02T10:00:00Z"),
      visitedZone: "Europe/Lisbon",
      rating: 5,
      notes: "windy",
    },
  });
  const stop = await prisma.tripStop.create({
    data: {
      tripId: trip.id,
      title: "Belém",
      placeId: place.id,
      startDate: new Date("2026-05-02T00:00:00Z"),
      lat: 38.6916,
      lon: -9.216,
    },
  });
  await prisma.tripJournalEntry.create({
    data: { tripId: trip.id, date: new Date("2026-05-02T20:00:00Z"), body: "Pastéis de nata." },
  });
  await createDocument({
    userId,
    buffer: PNG_DOC,
    originalName: "ticket.png",
    entry: { type: "trip", id: trip.id },
  });
  const photoFile = `${stamp}-exchange-test.png`;
  fs.writeFileSync(path.join(getTripPhotoDir(), photoFile), PNG);
  await prisma.tripPhoto.create({
    data: {
      tripId: trip.id,
      filename: photoFile,
      mimetype: "image/png",
      sizeBytes: PNG.length,
      takenAt: new Date("2026-05-02T11:00:00Z"),
      stopId: stop.id,
    },
  });
  return { tripId: trip.id, flightRef, photoFile, portId: port.id };
}
