import { prisma } from "../db";
import { AppError } from "../middleware/errorHandler";
import { revertLodgingImportBatch } from "./lodging/lodgingImportBatches";

/**
 * Import batches across every domain.
 *
 * Stays had this since 2.6.0; flights and cruises wrote their rows and left no
 * trace, so "undo this import" existed for one area out of three. The record
 * is the same for all of them — only the reversal differs, because what a row
 * drags along when it goes differs per domain.
 */

export const IMPORT_DOMAINS = ["flight", "cruise", "lodging", "poi"] as const;
export type ImportDomain = (typeof IMPORT_DOMAINS)[number];

export const IMPORT_SOURCES = ["csv", "email", "pdf"] as const;
export type ImportSource = (typeof IMPORT_SOURCES)[number];

export interface ImportBatchSummary {
  id: string;
  domain: ImportDomain;
  source: ImportSource;
  fileName: string | null;
  createdAt: string;
  /** How many rows this batch still owns, per kind. */
  counts: { lodgings: number; stays: number; flights: number; cruises: number; places: number };
}

/**
 * A stored domain string, or the safest wrong answer.
 *
 * The fallback is `"lodging"` and it is load-bearing in the wrong direction: an
 * unknown domain silently became a lodging batch, which then took the lodging
 * REVERT path. That was harmless only because nothing wrote a domain outside
 * the list. `"poi"` is the first addition since, so the fallback is now a real
 * hazard rather than a theoretical one — a POI batch written by a newer build
 * and read by an older one would be reverted as lodging.
 *
 * Kept as a fallback rather than a throw because a listing must not fail over
 * one unreadable row, but every caller that ACTS on the domain (see
 * `revertImportBatch`) now refuses an unrecognised one instead of guessing.
 */
function asDomain(value: string): ImportDomain {
  return (IMPORT_DOMAINS as readonly string[]).includes(value) ? (value as ImportDomain) : "lodging";
}

function asSource(value: string): ImportSource {
  return (IMPORT_SOURCES as readonly string[]).includes(value) ? (value as ImportSource) : "csv";
}

export async function createImportBatch(
  userId: string,
  domain: ImportDomain,
  source: ImportSource,
  fileName: string | null,
): Promise<{ id: string }> {
  const batch = await prisma.importBatch.create({
    data: { userId, domain, source, fileName },
    select: { id: true },
  });
  return batch;
}

/**
 * An import that imported nothing is not an import.
 *
 * A batch is opened when a document is read, before anyone knows whether it
 * will produce rows — and a mail read a second time produces none, because
 * every flight in it is already here. Listing that as a run would invite the
 * user to "undo" an import that never happened, and would fill the log with
 * entries that say nothing. The record stays in the database (it costs a row
 * and keeps the id stable if something else ever references it); it simply is
 * not a run worth showing.
 */
export async function listImportBatches(userId: string): Promise<ImportBatchSummary[]> {
  const batches = await prisma.importBatch.findMany({
    where: {
      userId,
      OR: [
        { lodgings: { some: {} } },
        { stays: { some: {} } },
        { flights: { some: {} } },
        { cruises: { some: {} } },
        // Without this a POI batch existed and was invisible in the log — the
        // user could neither see nor undo an import that had happened.
        { places: { some: {} } },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: {
      _count: { select: { lodgings: true, stays: true, flights: true, cruises: true, places: true } },
    },
  });

  return batches.map((b) => ({
    id: b.id,
    domain: asDomain(b.domain),
    source: asSource(b.source),
    fileName: b.fileName,
    createdAt: b.createdAt.toISOString(),
    counts: {
      lodgings: b._count.lodgings,
      stays: b._count.stays,
      flights: b._count.flights,
      cruises: b._count.cruises,
      places: b._count.places,
    },
  }));
}

/** One row an import brought in, flattened across the domains. */
export interface ImportBatchItem {
  kind: "flight" | "cruise" | "lodging" | "stay" | "place";
  id: string;
  /** What to call it on screen: flight number, ship, hotel name. */
  label: string;
  /** The date the row is about — departure, sailing, check-in. Null when the
   *  row carries no date at all, which a lodging may not. */
  date: string | null;
  /** A second line of context: route, ports, city. Empty when there is none. */
  detail: string | null;
}

export interface ImportBatchItems {
  items: ImportBatchItem[];
  /** Rows this batch owns, before the cap below. */
  total: number;
  /** True when `items` is a prefix of `total` — an import of thousands of rows
   *  must not turn one panel into a thousand-row page. */
  truncated: boolean;
}

/**
 * The rows themselves, so "undo this import" stops being a decision made blind.
 *
 * The log has always been able to say "12 flights" — the counts are `_count`
 * aggregates — but never WHICH twelve. The only way to find out was to revert
 * and look at what disappeared.
 *
 * Both column names are queried on purpose: flights and cruises reference the
 * batch as `importBatchId`, lodgings and stays as `batchId`. A route that knew
 * only one of them would report half of a mixed import as empty, which reads
 * exactly like an import that failed.
 */
const ITEM_CAP = 50;

export async function listImportBatchItems(
  userId: string,
  batchId: string,
): Promise<ImportBatchItems> {
  // Ownership first: a batch belonging to someone else must be indistinguishable
  // from one that does not exist.
  const batch = await prisma.importBatch.findFirst({
    where: { id: batchId, userId },
    select: { id: true },
  });
  if (!batch) throw new AppError("Import batch not found", 404);

  const [flights, cruises, lodgings, stays, places] = await Promise.all([
    prisma.flight.findMany({
      where: { userId, importBatchId: batchId },
      select: {
        id: true,
        flightNumber: true,
        airline: true,
        depIata: true,
        arrIata: true,
        departureTime: true,
      },
      orderBy: { departureTime: "asc" },
      take: ITEM_CAP,
    }),
    prisma.cruise.findMany({
      where: { userId, importBatchId: batchId },
      select: { id: true, cruiseLine: true, startDate: true, ship: { select: { name: true } } },
      orderBy: { startDate: "asc" },
      take: ITEM_CAP,
    }),
    prisma.lodging.findMany({
      where: { userId, batchId },
      select: { id: true, name: true, city: true, country: true },
      orderBy: { name: "asc" },
      take: ITEM_CAP,
    }),
    prisma.lodgingStay.findMany({
      where: { userId, batchId },
      select: {
        id: true,
        checkIn: true,
        nights: true,
        lodging: { select: { name: true, city: true } },
      },
      orderBy: { checkIn: "asc" },
      take: ITEM_CAP,
    }),
    prisma.place.findMany({
      where: { userId, batchId },
      select: { id: true, name: true, city: true, country: true },
      orderBy: { name: "asc" },
      take: ITEM_CAP,
    }),
  ]);

  const counts = await prisma.importBatch.findFirst({
    where: { id: batchId, userId },
    select: {
      _count: {
        select: { flights: true, cruises: true, lodgings: true, stays: true, places: true },
      },
    },
  });
  const total =
    (counts?._count.flights ?? 0) +
    (counts?._count.cruises ?? 0) +
    (counts?._count.lodgings ?? 0) +
    (counts?._count.stays ?? 0) +
    (counts?._count.places ?? 0);

  const items: ImportBatchItem[] = [
    ...flights.map((f) => ({
      kind: "flight" as const,
      id: f.id,
      label: f.flightNumber ?? f.airline ?? "—",
      date: f.departureTime ? f.departureTime.toISOString() : null,
      detail: f.depIata && f.arrIata ? `${f.depIata} → ${f.arrIata}` : null,
    })),
    ...cruises.map((c) => ({
      kind: "cruise" as const,
      id: c.id,
      label: c.ship?.name ?? c.cruiseLine ?? "—",
      date: c.startDate ? c.startDate.toISOString() : null,
      detail: c.ship?.name ? c.cruiseLine : null,
    })),
    ...lodgings.map((l) => ({
      kind: "lodging" as const,
      id: l.id,
      label: l.name,
      date: null,
      detail: [l.city, l.country].filter(Boolean).join(", ") || null,
    })),
    ...stays.map((s) => ({
      kind: "stay" as const,
      id: s.id,
      label: s.lodging?.name ?? "—",
      date: s.checkIn ? s.checkIn.toISOString() : null,
      detail: s.lodging?.city ?? null,
    })),
    ...places.map((p) => ({
      kind: "place" as const,
      id: p.id,
      label: p.name,
      // A place carries no date of its own — a VISIT does. Showing nothing is
      // honest; showing the row's creation date would read as "when I was
      // there", which is a different fact.
      date: null,
      detail: [p.city, p.country].filter(Boolean).join(", ") || null,
    })),
  ];

  return { items, total, truncated: items.length < total };
}

export interface RevertSummary {
  domain: ImportDomain;
  deleted: number;
  /** Lodging only: rows that survived because something else still needs them. */
  detached?: number;
}

/**
 * Takes an import back as a unit.
 *
 * Ownership is checked here rather than by the caller: `batchId` arrives from
 * the client, and a plain existence check would let one user revert another's
 * import. A batch that is not theirs is simply not found.
 *
 * Flights and cruises are deleted outright — that is what undo means, and the
 * rows they own (companion links, stops, legs) go with them by cascade. An
 * auto-created trip left empty behind them is deliberately NOT deleted: it may
 * carry a name, photos or a journal the user wrote, and there is already a
 * tool for clearing empty ones. Stays keep their own, more careful reversal,
 * which refuses to cascade-delete a hotel that other stays still hang from.
 */
export async function revertImportBatch(userId: string, batchId: string): Promise<RevertSummary> {
  const batch = await prisma.importBatch.findFirst({
    where: { id: batchId, userId },
    select: { id: true, domain: true },
  });
  if (!batch) throw new AppError("Import batch not found", 404);

  // Deliberately NOT `asDomain` here. That falls back to "lodging" for anything
  // it does not recognise, which is tolerable when listing and dangerous when
  // deleting: a batch written by a newer build would be reverted down the wrong
  // path. Undo is the one operation that must refuse rather than guess.
  if (!(IMPORT_DOMAINS as readonly string[]).includes(batch.domain)) {
    throw new AppError(`Cannot revert an import of unknown kind "${batch.domain}"`, 409);
  }
  const domain = batch.domain as ImportDomain;

  if (domain === "poi") {
    /**
     * Places are deleted, and the batch with them.
     *
     * Without this branch a POI batch fell through to the cruise arm below and
     * did something much worse than nothing: it deleted zero places, deleted
     * the batch, and `Place.batch` being `onDelete: SetNull` then cleared every
     * `batchId` — so the undo appeared to work, changed nothing the user could
     * see, and destroyed the only link that would have let them try again.
     *
     * Note the column: `Place` names it `batchId`, while flights and cruises
     * use `importBatchId`. Reusing the `where` below would have matched nothing
     * and looked like an empty batch.
     */
    return await prisma.$transaction(async (tx) => {
      const deleted = (await tx.place.deleteMany({ where: { userId, batchId } })).count;
      await tx.importBatch.delete({ where: { id: batchId } });
      return { domain, deleted };
    });
  }

  if (domain === "lodging") {
    const result = await revertLodgingImportBatch(userId, batchId);
    return {
      domain,
      deleted: result.deletedLodgings + result.deletedStays,
      detached: result.detachedLodgings,
    };
  }

  return await prisma.$transaction(async (tx) => {
    // Scoped by userId as well as the batch: the batch was already proven to
    // belong to this user, and the second condition keeps that true even if a
    // row were ever stamped with someone else's batch.
    const where = { userId, importBatchId: batchId };
    const deleted =
      domain === "flight"
        ? (await tx.flight.deleteMany({ where })).count
        : (await tx.cruise.deleteMany({ where })).count;
    await tx.importBatch.delete({ where: { id: batchId } });
    return { domain, deleted };
  });
}
