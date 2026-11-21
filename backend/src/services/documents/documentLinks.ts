import type { Document, DocumentLink } from "../../prisma";

import { Prisma } from "../../prisma";
import { prisma, type DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { DomainKey } from "../../shared/domains";
import { ENTRY_TYPES, type EntryType, type RentalDocumentCategory } from "./documentFormats";

/**
 * One document, many entries — phase D1 of
 * docs/superpowers/specs/2026-11-21-document-links.md.
 *
 * A document's links live in `document_links`; the owner columns on
 * `documents` (`flightId` … `tripExpenseId`, `rentalCategory`, `linkedAt`,
 * `unlinkedAt`) are the PROJECTION of its one `primary` link, kept for every
 * reader that still speaks the single-owner shape — installed Companion
 * versions, the sync feed, the current routes. Every write goes through this
 * file, which writes the link first and the projection from it, in one
 * transaction, so the two cannot disagree.
 *
 * A link never grants access (plan rule 6): the target is checked to belong to
 * the document's account inside the transaction that writes the link.
 *
 * Deleting an entry is the database's half: the link cascades, the owner column
 * is `SET NULL`, and the trigger `document_links_after_delete` promotes the
 * next link or makes the document unfiled with its 30-day grace.
 */

export interface EntryRef {
  type: EntryType;
  id: string;
}

export const LINK_ROLES = ["primary", "covers"] as const;
export type LinkRole = (typeof LINK_ROLES)[number];

/** How a link came to be (plan rule 3). Each also a CHECK in the database. */
export const LINK_PROVENANCES = ["user", "parser", "suggestion", "legacy"] as const;
export type LinkProvenance = (typeof LINK_PROVENANCES)[number];

type TargetColumn = keyof DocumentLink & keyof Document & `${string}Id`;

/**
 * The registry of link targets. A column here is a real foreign key on both
 * `document_links` and (as the projection) `documents`;
 * `documentLinks.registry.test.ts` holds it against the database.
 */
export const LINK_TARGETS = {
  flight: { column: "flightId" },
  cruise: { column: "cruiseId" },
  lodgingStay: { column: "lodgingStayId" },
  trip: { column: "tripId" },
  placeVisit: { column: "placeVisitId" },
  railJourney: { column: "railJourneyId" },
  rentalBooking: { column: "rentalBookingId" },
  busJourney: { column: "busJourneyId" },
  ferryJourney: { column: "ferryJourneyId" },
  tripExpense: { column: "tripExpenseId" },
} as const satisfies Record<EntryType, { column: TargetColumn }>;

/**
 * Every domain names the entry type its documents link to, or says why it has
 * none. A domain added to `shared/domains.ts` without a line here is a type
 * error, and `documentLinks.registry.test.ts` fails on a reason left empty.
 */
export const DOMAIN_LINK_TARGETS: Readonly<Record<DomainKey, EntryType | { notLinked: string }>> = {
  flight: "flight",
  cruise: "cruise",
  lodging: "lodgingStay",
  poi: "placeVisit",
  rail: "railJourney",
  rental: "rentalBooking",
  bus: "busJourney",
  ferry: "ferryJourney",
  roadtrip: {
    notLinked:
      "A roadtrip is a section (TripRoute) of a trip, not an entry of its own; its documents link to the trip, its rental or its expenses.",
  },
  tour: {
    notLinked:
      "A day tour is a TripRoute section of a trip, not an entry of its own; its documents link to the trip or its expenses.",
  },
};

export type OwnerColumns = Record<TargetColumn, string | null>;

/** The ten target columns with exactly `entry`'s set — the shape of a link's target and of the projection. */
export function targetColumns(entry: EntryRef | null): OwnerColumns {
  const columns = {} as OwnerColumns;
  for (const type of ENTRY_TYPES) {
    columns[LINK_TARGETS[type].column] = entry?.type === type ? entry.id : null;
  }
  return columns;
}

/** The entry a row (a document's projection or a link) points at, or null. */
export function entryOfColumns(row: Pick<Document, TargetColumn>): EntryRef | null {
  for (const type of ENTRY_TYPES) {
    const id = row[LINK_TARGETS[type].column];
    if (id) return { type, id };
  }
  return null;
}

function sameEntry(a: EntryRef | null, b: EntryRef | null): boolean {
  return !!a && !!b && a.type === b.type && a.id === b.id;
}

type EntryReader = Pick<
  DbTransaction,
  | "flight"
  | "cruise"
  | "lodgingStay"
  | "trip"
  | "placeVisit"
  | "railJourney"
  | "rentalBooking"
  | "busJourney"
  | "ferryJourney"
  | "tripExpense"
>;

/** 404 unless the entry exists AND belongs to the user — a stranger's entry is not an entry. */
export async function assertEntryOwnedIn(
  db: EntryReader,
  userId: string,
  entry: EntryRef
): Promise<void> {
  const args = { where: { id: entry.id, userId }, select: { id: true } } as const;
  let found: { id: string } | null;
  switch (entry.type) {
    case "flight":
      found = await db.flight.findFirst(args);
      break;
    case "cruise":
      found = await db.cruise.findFirst(args);
      break;
    case "lodgingStay":
      found = await db.lodgingStay.findFirst(args);
      break;
    case "trip":
      found = await db.trip.findFirst(args);
      break;
    case "placeVisit":
      found = await db.placeVisit.findFirst(args);
      break;
    case "railJourney":
      found = await db.railJourney.findFirst(args);
      break;
    case "rentalBooking":
      found = await db.rentalBooking.findFirst(args);
      break;
    case "busJourney":
      found = await db.busJourney.findFirst(args);
      break;
    case "ferryJourney":
      found = await db.ferryJourney.findFirst(args);
      break;
    case "tripExpense":
      found = await db.tripExpense.findFirst(args);
      break;
  }
  if (!found) throw new AppError("Entry not found", 404, "DOCUMENT_ENTRY_NOT_FOUND");
}

/**
 * Locks the document row for the rest of the transaction. A link insert holds a
 * key-share lock on the same row, so the sweep (which locks before it deletes)
 * and a linker can never both act on what they read before the other committed.
 */
export async function lockDocument(
  tx: DbTransaction,
  userId: string,
  documentId: string
): Promise<boolean> {
  const rows = await tx.$queryRaw<{ id: string }[]>(
    Prisma.sql`SELECT id FROM "documents" WHERE id = ${documentId} AND user_id = ${userId} FOR UPDATE`
  );
  return rows.length > 0;
}

/**
 * `lockDocument` for several rows, always in id order, and always BEFORE any
 * link row is touched — the order every writer here keeps, so two of them
 * (a merge and a filing, two sweeps) cannot each hold what the other waits for.
 */
export async function lockDocuments(tx: DbTransaction, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  await tx.$queryRaw(
    Prisma.sql`SELECT id FROM "documents" WHERE id IN (${Prisma.join([...ids])}) ORDER BY id FOR UPDATE`
  );
}

/**
 * Writes the owner columns of `documents` from its links: the primary's target
 * and category, `linkedAt` when that target changed, and `unlinkedAt` stamped
 * on the transition to zero links and cleared on the first.
 */
export async function projectPrimary(tx: DbTransaction, documentId: string): Promise<Document> {
  const [document, links] = await Promise.all([
    tx.document.findUniqueOrThrow({ where: { id: documentId } }),
    tx.documentLink.findMany({
      where: { documentId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    }),
  ]);
  const primary = links.find((l) => l.role === "primary") ?? null;
  const target = primary ? entryOfColumns(primary) : null;
  const now = new Date();
  return tx.document.update({
    where: { id: documentId },
    data: {
      ...targetColumns(target),
      rentalCategory: primary?.rentalCategory ?? null,
      linkedAt: target
        ? sameEntry(entryOfColumns(document), target)
          ? (document.linkedAt ?? now)
          : now
        : null,
      unlinkedAt: links.length > 0 ? null : (document.unlinkedAt ?? now),
    },
  });
}

export interface PrimaryLinkOptions {
  provenance: LinkProvenance;
  /** A rental's evidence category; null clears it; absent keeps it. Ignored off a rental. */
  rentalCategory?: RentalDocumentCategory | null;
}

/**
 * Makes `entry` the document's primary link (null removes the primary), then
 * re-projects. The caller decides whether a move is allowed; this only does it.
 * 404 when the document is not the user's or the entry is not.
 */
export async function setPrimaryLink(
  tx: DbTransaction,
  userId: string,
  documentId: string,
  entry: EntryRef | null,
  options: PrimaryLinkOptions
): Promise<Document> {
  if (!(await lockDocument(tx, userId, documentId))) {
    throw new AppError("Document not found", 404);
  }
  const primary = await tx.documentLink.findFirst({ where: { documentId, role: "primary" } });
  if (!entry) {
    // The trigger hands the role to the next link, or unfiles the document.
    if (primary) await tx.documentLink.delete({ where: { id: primary.id } });
    return projectPrimary(tx, documentId);
  }

  await assertEntryOwnedIn(tx, userId, entry);
  const column = LINK_TARGETS[entry.type].column;
  const category = entry.type === "rentalBooking" ? options.rentalCategory : null;
  if (primary && primary[column] === entry.id) {
    if (category !== undefined && primary.rentalCategory !== category) {
      await tx.documentLink.update({
        where: { id: primary.id },
        data: { rentalCategory: category },
      });
    }
    return projectPrimary(tx, documentId);
  }

  const twin = await tx.documentLink.findFirst({ where: { documentId, [column]: entry.id } });
  if (primary) {
    // A `covers` link to the new target folds into the moved primary.
    if (twin) await tx.documentLink.delete({ where: { id: twin.id } });
    await tx.documentLink.update({
      where: { id: primary.id },
      data: {
        ...targetColumns(entry),
        provenance: options.provenance,
        rentalCategory: category ?? null,
        createdAt: new Date(),
      },
    });
  } else if (twin) {
    await tx.documentLink.update({
      where: { id: twin.id },
      data: { role: "primary", ...(category !== undefined && { rentalCategory: category }) },
    });
  } else {
    await tx.documentLink.create({
      data: {
        documentId,
        ...targetColumns(entry),
        role: "primary",
        provenance: options.provenance,
        rentalCategory: category ?? null,
      },
    });
  }
  return projectPrimary(tx, documentId);
}

/**
 * Files a document that has no link yet; false (and nothing written) when it
 * is filed already or is not the user's. The check runs under the row lock, so
 * two concurrent filings cannot both win.
 */
export async function fileIfUnfiled(
  tx: DbTransaction,
  userId: string,
  documentId: string,
  entry: EntryRef,
  options: PrimaryLinkOptions
): Promise<boolean> {
  if (!(await lockDocument(tx, userId, documentId))) return false;
  if ((await tx.documentLink.count({ where: { documentId } })) > 0) return false;
  // Filed by a writer that still sets only the old columns: filed all the same.
  const document = await tx.document.findUniqueOrThrow({ where: { id: documentId } });
  if (entryOfColumns(document)) return false;
  await setPrimaryLink(tx, userId, documentId, entry, options);
  return true;
}

/**
 * Moves every link from some entries of one type to another entry (a merge of
 * duplicates, a trip merge, a flight converted to a ride), folding a link into
 * one the document already has with the target, then re-projects each
 * document touched. The caller has proved all entries are the same account's.
 */
export async function repointLinks(
  tx: DbTransaction,
  from: { type: EntryType; ids: readonly string[] },
  to: EntryRef
): Promise<number> {
  if (from.ids.length === 0) return 0;
  const fromColumn = LINK_TARGETS[from.type].column;
  const toColumn = LINK_TARGETS[to.type].column;
  const where = { [fromColumn]: { in: [...from.ids] } };
  // Every document this move will touch is locked before any link row is: a
  // filing committed after the first look shows up on the next and is locked
  // too, until a look finds nothing new.
  const locked = new Set<string>();
  for (;;) {
    const [linked, projected] = await Promise.all([
      tx.documentLink.findMany({ where, select: { documentId: true } }),
      tx.document.findMany({ where, select: { id: true } }),
    ]);
    const fresh = [
      ...new Set([...linked.map((l) => l.documentId), ...projected.map((d) => d.id)]),
    ].filter((id) => !locked.has(id));
    if (fresh.length === 0) break;
    await lockDocuments(tx, fresh);
    for (const id of fresh) locked.add(id);
  }
  await adoptUnlinkedOwners(tx, fromColumn, from.ids, locked);
  const links = await tx.documentLink.findMany({
    where: { ...where, documentId: { in: [...locked] } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  const touched = new Set<string>();
  for (const link of links) {
    touched.add(link.documentId);
    const twin = await tx.documentLink.findFirst({
      where: { documentId: link.documentId, [toColumn]: to.id, id: { not: link.id } },
    });
    if (twin && link.role !== "primary") {
      await tx.documentLink.delete({ where: { id: link.id } });
      continue;
    }
    if (twin) await tx.documentLink.delete({ where: { id: twin.id } });
    await tx.documentLink.update({
      where: { id: link.id },
      data: {
        ...targetColumns(to),
        ...(to.type !== "rentalBooking" && { rentalCategory: null }),
      },
    });
  }
  for (const documentId of touched) await projectPrimary(tx, documentId);
  return touched.size;
}

/**
 * Gives a document whose old owner column names one of `ids` but which has no
 * link the primary link that column describes (provenance `legacy`), so a move
 * carries it. The backfill made one for every filed document; this covers a
 * row written since by anything that still sets only the old column.
 */
async function adoptUnlinkedOwners(
  tx: DbTransaction,
  column: TargetColumn,
  ids: readonly string[],
  locked: ReadonlySet<string>
): Promise<void> {
  const orphans = await tx.document.findMany({
    where: { [column]: { in: [...ids] }, id: { in: [...locked] }, links: { none: {} } },
  });
  for (const document of orphans) {
    await tx.documentLink.create({
      data: {
        documentId: document.id,
        ...targetColumns(entryOfColumns(document)),
        role: "primary",
        provenance: "legacy",
        rentalCategory: document.rentalBookingId ? document.rentalCategory : null,
      },
    });
  }
}

/** Removes the named links and re-projects their documents. */
export async function removeLinks(tx: DbTransaction, linkIds: readonly string[]): Promise<number> {
  if (linkIds.length === 0) return 0;
  const links = await tx.documentLink.findMany({
    where: { id: { in: [...linkIds] } },
    select: { id: true, documentId: true },
  });
  await tx.documentLink.deleteMany({ where: { id: { in: links.map((l) => l.id) } } });
  for (const documentId of new Set(links.map((l) => l.documentId))) {
    await projectPrimary(tx, documentId);
  }
  return links.length;
}

/** `prisma.$transaction` for callers outside one. */
export function inLinkTransaction<T>(fn: (tx: DbTransaction) => Promise<T>): Promise<T> {
  return prisma.$transaction(fn);
}
