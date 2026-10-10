/**
 * `.travstats` file → proposal. Read-only. The decisions are the package
 * proposal's (`../package/proposal.ts`, `decideExisting`): create when nothing
 * matches, attach a match that has no trip (or sits on this trip without its
 * booking), skip a duplicate or a row on another trip — never move it.
 *
 * The trip is matched by any booking reference of the file, else by the one
 * trip overlapping its days, exactly like a package. The commit rebuilds this
 * proposal from the file; it never takes ids from the client.
 */
import { prisma } from "../../../db";
import { toLocal } from "../../../shared/time/instant";
import { sha256Hex } from "../../documents/documentStore";
import { knownPhotoHashes, photoHash } from "./photoIdentity";
import {
  bookingByReference,
  existingCruiseByRef,
  existingFlight,
  lodgingIndex,
  tripById,
  tripOverlapping,
  type ExistingEntry,
} from "../package/matching";
import {
  dayAt,
  existingPlace,
  existingRail,
  existingRental,
  existingStop,
  existingVisit,
  stopDay,
  visitDay,
} from "../package/matchingEntries";
import { decideExisting, type Decision } from "../package/proposal";
import type { ProposalTrip } from "../package/types";
import type { TripFile, TripFileFlight } from "./format";
import type { TripArchive } from "./readArchive";
import type {
  TripFileBookingProposal,
  TripFileChoices,
  TripFileEntryProposal,
  TripFilePlaceProposal,
  TripFileProposal,
} from "./types";

const slice = (iso: string | null): string | null => (iso ? iso.slice(0, 10) : null);

/** The days the file covers: the trip's own, else the span of its entries. */
export function fileSpan(file: TripFile): { first: string; last: string } | null {
  const first = file.trip.startDay ?? slice(file.trip.startDate);
  const last = file.trip.endDay ?? slice(file.trip.endDate);
  if (first && last) return { first, last: last < first ? first : last };
  const days = [
    ...file.flights.map((f) => dayAt(f.departureTime, f.depTimezone)),
    ...file.stays.flatMap((s) => [
      s.checkInDate ?? slice(s.checkIn),
      s.checkOutDate ?? slice(s.checkOut),
    ]),
    ...file.cruises.flatMap((c) => [
      c.startDay ?? slice(c.startDate),
      c.endDay ?? slice(c.endDate),
    ]),
    ...file.rail.map((r) => dayAt(r.departureTime, r.dep.timezone)),
    ...file.rentals.flatMap((r) => [
      dayAt(r.pickupTime, r.pickup.timezone),
      dayAt(r.returnTime, r.return.timezone),
    ]),
  ]
    .filter((d): d is string => d !== null)
    .sort();
  return days.length > 0 ? { first: days[0], last: days[days.length - 1] } : null;
}

async function proposeTrip(
  userId: string,
  file: TripFile,
  choices: TripFileChoices
): Promise<ProposalTrip> {
  const span = fileSpan(file);
  const dates = { startDate: span?.first ?? null, endDate: span?.last ?? null };
  for (const b of file.bookings) {
    if (!b.pnr) continue;
    const booking = await bookingByReference(userId, b.pnr);
    const trip = booking?.tripId ? await tripById(userId, booking.tripId) : null;
    if (trip)
      return {
        action: "attach",
        id: trip.id,
        name: trip.name,
        matchedBy: "bookingReference",
        ...dates,
      };
  }
  const overlapping = await tripOverlapping(userId, span);
  const found = overlapping ? await tripById(userId, overlapping) : null;
  if (found)
    return { action: "attach", id: found.id, name: found.name, matchedBy: "dateOverlap", ...dates };
  return {
    action: "create",
    id: null,
    name: choices.tripName ?? file.trip.name,
    matchedBy: null,
    ...dates,
  };
}

async function proposeBookings(
  userId: string,
  file: TripFile,
  tripId: string | null
): Promise<TripFileBookingProposal[]> {
  const out: TripFileBookingProposal[] = [];
  for (const b of file.bookings) {
    let match: { id: string } | null = b.pnr ? await bookingByReference(userId, b.pnr) : null;
    // A booking without a reference is the same booking only on the same trip
    // and at the same price — anything looser would merge strangers.
    if (!match && !b.pnr && tripId) {
      match = await prisma.booking.findFirst({
        where: { userId, tripId, pnr: null, price: b.price, currency: b.currency },
        select: { id: true },
      });
    }
    out.push({
      key: b.key,
      action: match ? "attach" : "create",
      id: match?.id ?? null,
      reference: b.pnr,
      price: b.price,
      currency: b.currency,
    });
  }
  return out;
}

function decide(existing: ExistingEntry | null, tripId: string | null, booked: boolean): Decision {
  return existing ? decideExisting(existing, tripId, booked) : { action: "create", id: null };
}

const flightLabel = (f: TripFileFlight): string =>
  `${f.flightNumber ?? "?"} ${f.depIata ?? f.depName ?? "?"}–${f.arrIata ?? f.arrName ?? "?"}`;

/** The `HH:MM` of an instant at a zone, for the package flight matcher. */
const wallTime = (iso: string, zone: string | null): string =>
  toLocal(iso, zone ?? "UTC").local.slice(11, 16);

async function matchFlight(userId: string, f: TripFileFlight): Promise<ExistingEntry | null> {
  if (f.externalRef) {
    const byRef = await prisma.flight.findFirst({
      where: { userId, externalRef: f.externalRef },
      select: { id: true, tripId: true, bookingId: true },
    });
    if (byRef) return byRef;
  }
  const day = dayAt(f.departureTime, f.depTimezone);
  if (!f.flightNumber || !day || !f.departureTime) return null;
  return existingFlight(
    userId,
    { flightNumber: f.flightNumber, date: day, depTime: wallTime(f.departureTime, f.depTimezone) },
    f.depIata,
    f.arrIata
  );
}

async function proposeEntries(
  userId: string,
  file: TripFile,
  tripId: string | null,
  placeIds: Map<string, string | null>
): Promise<TripFileEntryProposal[]> {
  const entries: TripFileEntryProposal[] = [];
  for (const f of file.flights) {
    entries.push({
      key: f.key,
      kind: "flight",
      ...decide(await matchFlight(userId, f), tripId, f.bookingKey !== null),
      label: flightLabel(f),
      day: dayAt(f.departureTime, f.depTimezone),
    });
  }
  const index = await lodgingIndex(
    userId,
    file.stays.map((s) => s.lodging)
  );
  for (const s of file.stays) {
    const day = s.checkInDate ?? slice(s.checkIn);
    const existing = index.resolve(s.lodging, day).stay;
    entries.push({
      key: s.key,
      kind: "stay",
      ...decide(existing, tripId, s.bookingKey !== null),
      label: s.lodging.name,
      day,
    });
  }
  for (const c of file.cruises) {
    const existing = await existingCruiseByRef(userId, {
      externalRef: c.externalRef,
      bookingReference: c.bookingReference,
    });
    entries.push({
      key: c.key,
      kind: "cruise",
      ...decide(existing, tripId, c.bookingKey !== null),
      label: c.ship?.name ?? c.shipNameOverride ?? c.routeName ?? "?",
      day: c.startDay ?? slice(c.startDate),
    });
  }
  for (const r of file.rail) {
    const day = dayAt(r.departureTime, r.dep.timezone)!;
    const existing = await existingRail(userId, {
      externalRef: r.externalRef,
      operator: r.operator,
      trainNumber: r.trainNumber,
      depName: r.dep.name,
      arrName: r.arr.name,
      day,
    });
    entries.push({
      key: r.key,
      kind: "rail",
      ...decide(existing, tripId, r.bookingKey !== null),
      label:
        `${[r.trainCategory, r.trainNumber].filter(Boolean).join(" ") || (r.operator ?? "")} ${r.dep.name}–${r.arr.name}`.trim(),
      day,
    });
  }
  for (const r of file.rentals) {
    const day = dayAt(r.pickupTime, r.pickup.timezone)!;
    const existing = await existingRental(userId, {
      externalRef: r.externalRef,
      provider: r.provider,
      day,
    });
    entries.push({
      key: r.key,
      kind: "rental",
      ...decide(existing, tripId, false),
      label: `${r.provider} · ${r.pickup.stationName}`,
      day,
    });
  }
  const placeName = new Map(file.places.map((p) => [p.key, p.name]));
  for (const v of file.visits) {
    const day = visitDay(v);
    const placeId = placeIds.get(v.placeKey) ?? null;
    const existing = placeId ? await existingVisit(userId, placeId, day) : null;
    entries.push({
      key: v.key,
      kind: "visit",
      ...decide(existing, tripId, false),
      label: placeName.get(v.placeKey) ?? "?",
      day,
    });
  }
  for (const s of file.stops) {
    const day = stopDay(s);
    const placeId = s.placeKey ? (placeIds.get(s.placeKey) ?? null) : null;
    // A stop belongs to its trip: on a new trip nothing can match it, and a
    // place the file brings new is a stop the trip cannot have yet.
    const matched =
      tripId && (s.placeKey === null || placeId)
        ? await existingStop(tripId, { placeId, title: s.title, day })
        : null;
    entries.push({
      key: s.key,
      kind: "stop",
      ...(matched
        ? { action: "skip" as const, id: matched, reason: "duplicate" as const }
        : { action: "create" as const, id: null }),
      label: s.title,
      day,
    });
  }
  return entries;
}

async function proposeFiles(
  userId: string,
  archive: TripArchive,
  tripId: string | null
): Promise<Pick<TripFileProposal, "journal" | "documents" | "photos">> {
  const { file, blobs } = archive;
  const hashes = file.documents.map((d) => sha256Hex(blobs.get(d.file)!));
  const known = new Set(
    (
      await prisma.document.findMany({
        where: { userId, sha256: { in: hashes } },
        select: { sha256: true },
      })
    ).map((d) => d.sha256)
  );
  const newDocs = hashes.filter((h) => !known.has(h)).length;
  const incoming = file.photos.map((p) => blobs.get(p.file)!);
  const knownPhotos = await knownPhotoHashes(tripId, incoming);
  const newPhotos = incoming.filter((b) => !knownPhotos.has(photoHash(b))).length;
  const journal = file.journal ?? [];
  const journalKeys = new Set(
    tripId
      ? (
          await prisma.tripJournalEntry.findMany({
            where: { tripId },
            select: { date: true, body: true },
          })
        ).map((j) => journalIdentity(j.date.toISOString(), j.body))
      : []
  );
  const newJournal = journal.filter(
    (j) => !journalKeys.has(journalIdentity(j.date, j.body))
  ).length;
  return {
    documents: { create: newDocs, skip: hashes.length - newDocs },
    photos: { create: newPhotos, skip: file.photos.length - newPhotos },
    journal: { create: newJournal, skip: journal.length - newJournal },
  };
}

export const journalIdentity = (date: string, body: string): string =>
  `${new Date(date).toISOString()}|${body}`;

export async function buildTripFileProposal(
  userId: string,
  archive: TripArchive,
  choices: TripFileChoices = {}
): Promise<TripFileProposal> {
  const { file, manifest } = archive;
  const trip = await proposeTrip(userId, file, choices);
  const places: TripFilePlaceProposal[] = [];
  const placeIds = new Map<string, string | null>();
  for (const p of file.places) {
    const id = await existingPlace(userId, p);
    placeIds.set(p.key, id);
    places.push({ key: p.key, action: id ? "reuse" : "create", id, name: p.name });
  }
  return {
    trip,
    options: manifest.options,
    exportedAt: manifest.exportedAt,
    appVersion: manifest.appVersion,
    bookings: await proposeBookings(userId, file, trip.id),
    places,
    entries: await proposeEntries(userId, file, trip.id, placeIds),
    ...(await proposeFiles(userId, archive, trip.id)),
  };
}
