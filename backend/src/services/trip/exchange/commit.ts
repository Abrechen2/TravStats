/**
 * Writing a `.travstats` file — the proposal, rebuilt from the file, in ONE
 * transaction: trip, bookings, places, lodgings and stays, flights, cruises
 * with their stops, rail rides, rentals, visits, stops, journal and photo
 * rows. A failure half-way leaves no row behind, and the photo bytes written
 * for it are removed again.
 *
 * Documents are filed after the transaction through `createDocument`, the
 * one path that writes a document (format check, idempotency per sha256 and
 * target); a document whose bytes the user already holds is not filed twice.
 *
 * What it never does, like the package commit: overwrite. An attached row
 * keeps its booking; a row on another trip stays where it is.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { prisma, type DbTransaction } from "../../../db";
import { getTripPhotoDir } from "../../../middleware/upload";
import { TRIP_COLORS } from "../../../schemas/trip";
import logger from "../../../utils/logger";
import { checkAndUpdateAchievements } from "../../../utils/achievements";
import { createDocument, type EntryRef } from "../../documents/documentService";
import { sha256Hex } from "../../documents/documentStore";
import { DOCUMENT_KINDS, type DocumentKind } from "../../documents/documentFormats";
import { normalizeLodgingName } from "../../lodging/lodgingImportPreview";
import { removeDisplayRendition, writeDisplayRendition } from "../../photos/displayRendition";
import { recomputeTripStatus } from "../../tripStatusService";
import { lodgingIndex } from "../package/matching";
import {
  cruiseRow,
  flightRow,
  lodgingRow,
  railRow,
  rentalRow,
  resolveContext,
  stayRow,
  tripRow,
  IMPORT_SOURCE,
} from "./commitRows";
import type { EntityKind, TripFile } from "./format";
import { buildTripFileProposal, journalIdentity, photoIdentity } from "./proposal";
import type { TripArchive } from "./readArchive";
import type { TripFileChoices, TripFileEntryProposal, TripFileProposal } from "./types";

export interface TripFileCommitResult {
  tripId: string;
  created: number;
  attached: number;
  skipped: number;
  documents: { filed: number; skipped: number; refused: number };
  photos: number;
  proposal: TripFileProposal;
}

const PHOTO_TYPES: { mimetype: string; ext: string; test: (b: Buffer) => boolean }[] = [
  {
    mimetype: "image/jpeg",
    ext: "jpg",
    test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  {
    mimetype: "image/png",
    ext: "png",
    test: (b) =>
      b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  },
  {
    mimetype: "image/gif",
    ext: "gif",
    test: (b) => b.subarray(0, 4).toString("latin1") === "GIF8",
  },
  {
    mimetype: "image/webp",
    ext: "webp",
    test: (b) =>
      b.subarray(0, 4).toString("latin1") === "RIFF" &&
      b.subarray(8, 12).toString("latin1") === "WEBP",
  },
  {
    mimetype: "image/heic",
    ext: "heic",
    test: (b) =>
      b.subarray(4, 8).toString("latin1") === "ftyp" &&
      /^(heic|heix|mif1|msf1|heif)$/.test(b.subarray(8, 12).toString("latin1")),
  },
];

/** The photo's type from its bytes — the name inside the file is never trusted. */
export function photoTypeOf(bytes: Buffer): { mimetype: string; ext: string } | null {
  return PHOTO_TYPES.find((t) => t.test(bytes)) ?? null;
}

interface WrittenPhoto {
  filename: string;
  mimetype: string;
  size: number;
  index: number;
}

/** Writes the new photos' bytes before the transaction; their rows go in with it. */
async function writePhotos(archive: TripArchive, skip: Set<string>): Promise<WrittenPhoto[]> {
  const dir = getTripPhotoDir();
  const written: WrittenPhoto[] = [];
  try {
    for (const [index, p] of archive.file.photos.entries()) {
      const bytes = archive.blobs.get(p.file)!;
      if (skip.has(photoIdentity(bytes.length, p.takenAt))) continue;
      const type = photoTypeOf(bytes);
      if (!type) {
        logger.warn({ operation: "trip_import_photo_refused", entry: p.file });
        continue;
      }
      const filename = `${Date.now()}-${crypto.randomBytes(6).toString("hex")}-import.${type.ext}`;
      await fs.promises.writeFile(path.join(dir, filename), bytes, { flag: "wx" });
      written.push({ filename, mimetype: type.mimetype, size: bytes.length, index });
      if (type.ext === "heic") await writeDisplayRendition(dir, filename, bytes);
    }
  } catch (error) {
    removePhotos(written);
    throw error;
  }
  return written;
}

function removePhotos(written: WrittenPhoto[]): void {
  const dir = getTripPhotoDir();
  for (const w of written) {
    fs.rmSync(path.join(dir, path.basename(w.filename)), { force: true });
    removeDisplayRendition(dir, w.filename);
  }
}

type IdMaps = Record<EntityKind | "booking" | "place" | "stop", Map<string, string>>;

async function attach(
  tx: DbTransaction,
  model: "flight" | "lodgingStay" | "cruise" | "railJourney" | "rentalBooking" | "placeVisit",
  userId: string,
  id: string,
  tripId: string,
  bookingId: string | null
): Promise<void> {
  const delegate = tx[model] as unknown as {
    updateMany(args: { where: object; data: object }): Promise<{ count: number }>;
  };
  await delegate.updateMany({ where: { id, userId, tripId: null }, data: { tripId } });
  if (bookingId) {
    await delegate.updateMany({ where: { id, userId, bookingId: null }, data: { bookingId } });
  }
}

const MODEL = {
  flight: "flight",
  stay: "lodgingStay",
  cruise: "cruise",
  rail: "railJourney",
  rental: "rentalBooking",
  visit: "placeVisit",
} as const;

export async function commitTripFile(
  userId: string,
  archive: TripArchive,
  choices: TripFileChoices = {}
): Promise<TripFileCommitResult> {
  const proposal = await buildTripFileProposal(userId, archive, choices);
  const { file } = archive;

  // ---- everything that reads or goes to the network, before the transaction
  const ctx = await resolveContext(userId, file);
  const lodgings = await lodgingIndex(
    userId,
    file.stays.map((s) => s.lodging.name)
  );
  const color =
    proposal.trip.action === "create"
      ? TRIP_COLORS[(await prisma.trip.count({ where: { userId } })) % TRIP_COLORS.length]
      : TRIP_COLORS[0];
  const existingPhotos = proposal.trip.id
    ? await prisma.tripPhoto.findMany({
        where: { tripId: proposal.trip.id },
        select: { sizeBytes: true, takenAt: true },
      })
    : [];
  const photos = await writePhotos(
    archive,
    new Set(existingPhotos.map((p) => photoIdentity(p.sizeBytes, p.takenAt?.toISOString() ?? null)))
  );

  let ids: IdMaps;
  try {
    ids = await prisma.$transaction(
      (tx) => writeAll(tx, userId, archive, proposal, ctx, lodgings.lodgings, color, photos),
      {
        timeout: 60_000,
      }
    );
  } catch (error) {
    removePhotos(photos);
    throw error;
  }

  const documents = await fileDocuments(userId, archive, ids);
  const tripId = ids.trip.get("trip")!;
  await recomputeTripStatus(tripId);
  try {
    await checkAndUpdateAchievements(userId);
  } catch (err) {
    logger.error({ operation: "trip_import_achievements_failed", userId, err });
  }
  const count = (a: TripFileEntryProposal["action"]) =>
    proposal.entries.filter((e) => e.action === a).length;
  logger.info({
    operation: "trip_import_committed",
    userId,
    tripId,
    entries: proposal.entries.length,
  });
  return {
    tripId,
    created: count("create"),
    attached: count("attach"),
    skipped: count("skip"),
    documents,
    photos: photos.length,
    proposal,
  };
}

async function writeAll(
  tx: DbTransaction,
  userId: string,
  archive: TripArchive,
  proposal: TripFileProposal,
  ctx: Awaited<ReturnType<typeof resolveContext>>,
  lodgingByName: Map<string, string>,
  color: string,
  photos: WrittenPhoto[]
): Promise<IdMaps> {
  const { file } = archive;
  const ids: IdMaps = {
    trip: new Map(),
    flight: new Map(),
    stay: new Map(),
    cruise: new Map(),
    rail: new Map(),
    rental: new Map(),
    visit: new Map(),
    booking: new Map(),
    place: new Map(),
    stop: new Map(),
  };
  const tripId =
    proposal.trip.id ??
    (
      await tx.trip.create({
        data: tripRow(userId, file.trip, proposal.trip.name, color, ctx),
        select: { id: true },
      })
    ).id;
  ids.trip.set("trip", tripId);

  for (const b of proposal.bookings) {
    const src = file.bookings.find((x) => x.key === b.key)!;
    if (b.id) {
      await tx.booking.updateMany({ where: { id: b.id, userId, tripId: null }, data: { tripId } });
      ids.booking.set(b.key, b.id);
    } else {
      const fx = ctx.fx.get(`b:${b.key}`) ?? {};
      const created = await tx.booking.create({
        data: { userId, tripId, pnr: src.pnr, price: src.price, currency: src.currency, ...fx },
        select: { id: true },
      });
      ids.booking.set(b.key, created.id);
    }
  }
  for (const p of proposal.places) {
    if (p.id) {
      ids.place.set(p.key, p.id);
      continue;
    }
    const src = file.places.find((x) => x.key === p.key)!;
    const { key: _key, ...place } = src;
    const created = await tx.place.create({
      data: { userId, ...place, visited: true, dataSource: IMPORT_SOURCE },
      select: { id: true },
    });
    ids.place.set(p.key, created.id);
  }

  const bookingOf = (key: string | null) => (key ? (ids.booking.get(key) ?? null) : null);
  const lodgingCreated = new Map<string, string>();
  for (const entry of proposal.entries) {
    if (entry.kind === "stop") continue;
    const map = ids[entry.kind];
    if (entry.action === "skip") {
      if (entry.id) map.set(entry.key, entry.id);
      continue;
    }
    const bookingId = bookingOfEntry(file, entry, bookingOf);
    if (entry.action === "attach" && entry.id) {
      await attach(tx, MODEL[entry.kind], userId, entry.id, tripId, bookingId);
      map.set(entry.key, entry.id);
      continue;
    }
    map.set(
      entry.key,
      await createEntry(
        tx,
        userId,
        file,
        entry,
        ctx,
        { tripId, bookingId },
        ids,
        lodgingByName,
        lodgingCreated
      )
    );
  }

  for (const entry of proposal.entries.filter((e) => e.kind === "stop")) {
    if (entry.action !== "create") {
      if (entry.id) ids.stop.set(entry.key, entry.id);
      continue;
    }
    const s = file.stops.find((x) => x.key === entry.key)!;
    const created = await tx.tripStop.create({
      data: {
        tripId,
        orderIdx: s.orderIdx,
        title: s.title,
        description: s.description,
        startDate: s.startDate ? new Date(s.startDate) : null,
        endDate: s.endDate ? new Date(s.endDate) : null,
        startUtc: s.startUtc ? new Date(s.startUtc) : null,
        endUtc: s.endUtc ? new Date(s.endUtc) : null,
        stopZone: s.stopZone,
        precision: s.precision,
        lat: s.lat,
        lon: s.lon,
        overnight: s.overnight,
        placeId: s.placeKey ? (ids.place.get(s.placeKey) ?? null) : null,
        lodgingStayId: s.stayKey ? (ids.stay.get(s.stayKey) ?? null) : null,
        ...(s.private ? { notes: s.private.notes } : {}),
      },
      select: { id: true },
    });
    ids.stop.set(entry.key, created.id);
  }

  await writeJournal(tx, tripId, file, proposal.trip.id !== null);
  for (const w of photos) {
    const p = file.photos[w.index];
    await tx.tripPhoto.create({
      data: {
        tripId,
        filename: w.filename,
        mimetype: w.mimetype,
        sizeBytes: w.size,
        caption: p.caption,
        takenAt: p.takenAt ? new Date(p.takenAt) : null,
        lat: p.lat,
        lon: p.lon,
        sortIdx: p.sortIdx,
        stopId: p.stopKey ? (ids.stop.get(p.stopKey) ?? null) : null,
      },
    });
  }
  return ids;
}

function bookingOfEntry(
  file: TripFile,
  entry: TripFileEntryProposal,
  bookingOf: (key: string | null) => string | null
): string | null {
  const list =
    entry.kind === "flight"
      ? file.flights
      : entry.kind === "stay"
        ? file.stays
        : entry.kind === "cruise"
          ? file.cruises
          : entry.kind === "rail"
            ? file.rail
            : [];
  return bookingOf(list.find((e) => e.key === entry.key)?.bookingKey ?? null);
}

async function createEntry(
  tx: DbTransaction,
  userId: string,
  file: TripFile,
  entry: TripFileEntryProposal,
  ctx: Awaited<ReturnType<typeof resolveContext>>,
  link: { tripId: string; bookingId: string | null },
  ids: IdMaps,
  lodgingByName: Map<string, string>,
  lodgingCreated: Map<string, string>
): Promise<string> {
  const select = { id: true } as const;
  const byKey = <T extends { key: string }>(list: T[]) => list.find((e) => e.key === entry.key)!;
  switch (entry.kind) {
    case "flight":
      return (
        await tx.flight.create({ data: flightRow(userId, byKey(file.flights), ctx, link), select })
      ).id;
    case "stay": {
      const s = byKey(file.stays);
      const name = normalizeLodgingName(s.lodging.name);
      let lodgingId = lodgingByName.get(name) ?? lodgingCreated.get(name);
      if (!lodgingId) {
        lodgingId = (await tx.lodging.create({ data: lodgingRow(userId, s), select })).id;
        lodgingCreated.set(name, lodgingId);
      }
      return (
        await tx.lodgingStay.create({
          data: stayRow(userId, s, ctx, { ...link, lodgingId }),
          select,
        })
      ).id;
    }
    case "cruise":
      return (
        await tx.cruise.create({ data: cruiseRow(userId, byKey(file.cruises), ctx, link), select })
      ).id;
    case "rail":
      return (
        await tx.railJourney.create({ data: railRow(userId, byKey(file.rail), ctx, link), select })
      ).id;
    case "rental":
      return (
        await tx.rentalBooking.create({
          data: rentalRow(userId, byKey(file.rentals), ctx, link.tripId),
          select,
        })
      ).id;
    case "visit": {
      const v = byKey(file.visits);
      return (
        await tx.placeVisit.create({
          data: {
            userId,
            tripId: link.tripId,
            placeId: ids.place.get(v.placeKey)!,
            visitedAt: v.visitedAt ? new Date(v.visitedAt) : null,
            visitedAtUtc: v.visitedAtUtc ? new Date(v.visitedAtUtc) : null,
            visitedZone: v.visitedZone,
            visitedPrecision: v.visitedPrecision,
            orderIdx: v.orderIdx,
            ...(v.private ? { notes: v.private.notes, rating: v.private.rating } : {}),
          },
          select,
        })
      ).id;
    }
    default:
      throw new Error(`unexpected entry kind ${entry.kind}`);
  }
}

async function writeJournal(
  tx: DbTransaction,
  tripId: string,
  file: TripFile,
  attached: boolean
): Promise<void> {
  const journal = file.journal ?? [];
  if (journal.length === 0) return;
  const existing = attached
    ? new Set(
        (
          await tx.tripJournalEntry.findMany({
            where: { tripId },
            select: { date: true, body: true },
          })
        ).map((j) => journalIdentity(j.date.toISOString(), j.body))
      )
    : new Set<string>();
  for (const j of journal) {
    if (existing.has(journalIdentity(j.date, j.body))) continue;
    await tx.tripJournalEntry.create({
      data: {
        tripId,
        date: new Date(j.date),
        day: j.day ? new Date(`${j.day}T00:00:00.000Z`) : null,
        title: j.title,
        body: j.body,
        mood: j.mood,
        weather: j.weather,
      },
    });
  }
}

const ENTRY_TYPE: Record<Exclude<EntityKind, "trip">, EntryRef["type"]> = {
  flight: "flight",
  stay: "lodgingStay",
  cruise: "cruise",
  rail: "railJourney",
  rental: "rentalBooking",
  visit: "placeVisit",
};

/**
 * Files the documents on the rows they belonged to. A document whose bytes
 * the user already holds anywhere is skipped (that is what makes a re-import
 * write nothing); one this server refuses (format, size) is counted, logged
 * and left out — the trip itself is already written.
 */
async function fileDocuments(
  userId: string,
  archive: TripArchive,
  ids: IdMaps
): Promise<TripFileCommitResult["documents"]> {
  const result = { filed: 0, skipped: 0, refused: 0 };
  for (const d of archive.file.documents) {
    const bytes = archive.blobs.get(d.file)!;
    const known = await prisma.document.findFirst({
      where: { userId, sha256: sha256Hex(bytes) },
      select: { id: true },
    });
    if (known) {
      result.skipped += 1;
      continue;
    }
    const id =
      d.entity.kind === "trip" ? ids.trip.get("trip") : ids[d.entity.kind].get(d.entity.key ?? "");
    const entry: EntryRef | null = id
      ? { type: d.entity.kind === "trip" ? "trip" : ENTRY_TYPE[d.entity.kind], id }
      : null;
    try {
      await createDocument({
        userId,
        buffer: bytes,
        originalName: d.originalName ?? undefined,
        source: "upload",
        kind: DOCUMENT_KINDS.includes(d.kind as DocumentKind) ? (d.kind as DocumentKind) : null,
        issuedOn: d.issuedOn ? new Date(`${d.issuedOn}T00:00:00.000Z`) : null,
        // An entry the import skipped without a row still has a trip to go on.
        entry: entry ?? { type: "trip", id: ids.trip.get("trip")! },
      });
      result.filed += 1;
    } catch (error) {
      result.refused += 1;
      logger.warn({
        operation: "trip_import_document_refused",
        entry: d.file,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}
