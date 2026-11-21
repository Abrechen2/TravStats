import type { Document, DocumentLink } from "../../prisma";

import { prisma, type DbTransaction } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import type { RentalDocumentCategory } from "./documentFormats";
import {
  LINK_TARGETS,
  assertEntryOwnedIn,
  entryOfColumns,
  inLinkTransaction,
  lockDocument,
  projectPrimary,
  targetColumns,
  type EntryRef,
  type LinkProvenance,
  type LinkRole,
} from "./documentLinks";
import { autoAssignInTx } from "./documentCompanions";
import { describeEntries, entryKey, type EntryInfo } from "./entryRefs";

/**
 * Reading and hand-editing a document's links — phase D2 of
 * docs/superpowers/specs/2026-11-21-document-links.md.
 *
 * The writes here are the manual ones (`user` provenance, `covers` role unless
 * the document has no primary yet). They never grant access: every target is
 * proven the document's account's own inside the transaction (rule 6), and a
 * link to an entry never changes who may read the document — `getOwnDocument`
 * still asks only for the owner.
 */

/** Where a document's evidence comes from, as an entry's list shows it ("Beleg aus: …"). */
export interface EvidenceFrom {
  type: EntryRef["type"];
  id: string;
  label: string;
  parentId: string | null;
}

export interface EntryLinkInfo {
  linkRole: LinkRole;
  /** The primary entry of a `covers` document; null when this entry IS the primary. */
  evidenceFrom: EvidenceFrom | null;
  /** How many entries the document is linked to, this one included. */
  linkCount: number;
  /** Plan D7: who it is for at THIS entry; null = the owner / the whole group. */
  forCompanion: { id: string; displayName: string; source: "user" | "auto" | null } | null;
  forSource: "user" | "auto" | null;
}

export interface LinkView {
  id: string;
  role: LinkRole;
  provenance: LinkProvenance;
  rentalCategory: string | null;
  createdAt: string;
  entry: EntryInfo;
  /** Plan D7: the person this link is for; null = the owner / the whole group. */
  companion: { id: string; displayName: string } | null;
  companionSource: "user" | "auto" | null;
}

function targetWhere(entry: EntryRef): Record<string, string> {
  return { [LINK_TARGETS[entry.type].column]: entry.id };
}

function toEvidence(info: EntryInfo | undefined): EvidenceFrom | null {
  return info ? { type: info.type, id: info.id, label: info.label, parentId: info.parentId } : null;
}

/**
 * Every document linked to the entry, as primary OR covers, oldest first, each
 * with the role it has here. A document whose old owner column names the entry
 * but has no link row yet (written by a writer that predates the table) counts
 * as its primary — the projection is read too, so nothing disappears from a
 * list because a link was never written.
 */
export async function listEntryDocuments(
  userId: string,
  entry: EntryRef
): Promise<Array<{ document: Document; link: EntryLinkInfo }>> {
  await assertEntryOwnedIn(prisma, userId, entry);
  const column = LINK_TARGETS[entry.type].column;
  const documents = await prisma.document.findMany({
    where: { userId, OR: [{ [column]: entry.id }, { links: { some: { [column]: entry.id } } }] },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      links: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: { companion: { select: { id: true, displayName: true } } },
      },
    },
  });

  const primaries = new Map<string, EntryRef>();
  for (const doc of documents) {
    const here = doc.links.find((l) => l[column] === entry.id);
    const role: LinkRole = here ? (here.role as LinkRole) : "primary";
    if (role === "covers") {
      const primary = doc.links.find((l) => l.role === "primary");
      const ref = primary ? entryOfColumns(primary) : entryOfColumns(doc);
      if (ref) primaries.set(doc.id, ref);
    }
  }
  const info = await describeEntries(userId, [...primaries.values()]);

  return documents.map(({ links, ...document }) => {
    const here = links.find((l) => l[column] === entry.id);
    const role: LinkRole = here ? (here.role as LinkRole) : "primary";
    const primaryRef = primaries.get(document.id);
    return {
      // The category belongs to the link for THIS entry, not to the primary the
      // row's projection mirrors: a document covering a second rental shows that rental's.
      document: here
        ? {
            ...document,
            rentalCategory: entry.type === "rentalBooking" ? here.rentalCategory : null,
          }
        : document,
      link: {
        linkRole: role,
        evidenceFrom: primaryRef ? toEvidence(info.get(entryKey(primaryRef))) : null,
        linkCount: Math.max(links.length, 1),
        forCompanion:
          here?.companion != null
            ? { ...here.companion, source: here.companionSource as "user" | "auto" | null }
            : null,
        forSource: (here?.companionSource as "user" | "auto" | null | undefined) ?? null,
      },
    };
  });
}

/** Every link of one document, with its entry described. Used by the picker and the delete dialog. */
export async function listDocumentLinks(userId: string, documentId: string): Promise<LinkView[]> {
  const document = await prisma.document.findFirst({
    where: { id: documentId, userId },
    include: {
      links: {
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        include: { companion: { select: { id: true, displayName: true } } },
      },
    },
  });
  if (!document) throw new AppError("Document not found", 404, "DOCUMENT_NOT_FOUND");
  const refs = document.links.flatMap((l) => {
    const ref = entryOfColumns(l);
    return ref ? [ref] : [];
  });
  const info = await describeEntries(userId, refs);
  return document.links.flatMap((link) => {
    const ref = entryOfColumns(link);
    const entry = ref ? info.get(entryKey(ref)) : undefined;
    return entry
      ? [
          {
            id: link.id,
            role: link.role as LinkRole,
            provenance: link.provenance as LinkProvenance,
            rentalCategory: link.rentalCategory,
            createdAt: link.createdAt.toISOString(),
            entry,
            companion: link.companion,
            companionSource: link.companionSource as "user" | "auto" | null,
          },
        ]
      : [];
  });
}

export interface NewLink {
  entry: EntryRef;
  /** Absent: `covers`, or `primary` when the document has none yet. */
  role?: LinkRole;
  provenance?: LinkProvenance;
  rentalCategory?: RentalDocumentCategory | null;
}

/**
 * Adds links, all or none. A duplicate (the document already has that entry)
 * answers 409 `DOCUMENT_LINK_EXISTS` and a gone or foreign entry 404
 * `DOCUMENT_ENTRY_NOT_FOUND`, so the caller can say which and refresh its list.
 */
export async function addLinks(
  userId: string,
  documentId: string,
  items: readonly NewLink[]
): Promise<Document> {
  return inLinkTransaction(async (tx) => {
    if (!(await lockDocument(tx, userId, documentId))) {
      throw new AppError("Document not found", 404, "DOCUMENT_NOT_FOUND");
    }
    await adoptLegacyPrimary(tx, documentId);
    const seen = new Set<string>();
    for (const item of items) {
      const key = entryKey(item.entry);
      if (seen.has(key)) {
        throw new AppError("The same entry was named twice", 400, "DOCUMENT_LINK_DUPLICATE_INPUT");
      }
      seen.add(key);
      await assertEntryOwnedIn(tx, userId, item.entry);
      const existing = await tx.documentLink.findFirst({
        where: { documentId, ...targetWhere(item.entry) },
        select: { id: true },
      });
      if (existing) {
        throw new AppError("Document is already linked to this entry", 409, "DOCUMENT_LINK_EXISTS");
      }
    }
    for (const item of items) await insertLink(tx, documentId, item);
    const projected = await projectPrimary(tx, documentId);
    await autoAssignInTx(tx, userId, documentId);
    return projected;
  });
}

/**
 * Links a document to entries inside the caller's transaction, skipping any it
 * is linked to already — so a retried import adds only what is missing. Never
 * moves the primary: a document with none takes the first as its primary.
 * Returns how many links were written.
 */
export async function addMissingLinksInTx(
  tx: DbTransaction,
  userId: string,
  documentId: string,
  entries: readonly {
    entry: EntryRef;
    provenance: LinkProvenance;
    rentalCategory?: RentalDocumentCategory | null;
  }[]
): Promise<number> {
  if (!(await lockDocument(tx, userId, documentId))) {
    throw new AppError("Document not found", 404, "DOCUMENT_NOT_FOUND");
  }
  await adoptLegacyPrimary(tx, documentId);
  let written = 0;
  const seen = new Set<string>();
  for (const { entry, provenance, rentalCategory } of entries) {
    const key = entryKey(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    await assertEntryOwnedIn(tx, userId, entry);
    const existing = await tx.documentLink.findFirst({
      where: { documentId, ...targetWhere(entry) },
      select: { id: true },
    });
    if (existing) continue;
    await insertLink(tx, documentId, { entry, role: "covers", provenance, rentalCategory });
    written += 1;
  }
  await projectPrimary(tx, documentId);
  if (written > 0) await autoAssignInTx(tx, userId, documentId);
  return written;
}

/**
 * A document written by something that still sets only the old owner column has
 * no link row yet. Give it the primary link that column describes (`legacy`)
 * before another link is added or one removed, or `projectPrimary` would
 * overwrite its original filing. Caller holds the document lock.
 */
async function adoptLegacyPrimary(tx: DbTransaction, documentId: string): Promise<void> {
  if ((await tx.documentLink.count({ where: { documentId } })) > 0) return;
  const document = await tx.document.findUniqueOrThrow({ where: { id: documentId } });
  const owner = entryOfColumns(document);
  if (!owner) return;
  await tx.documentLink.create({
    data: {
      documentId,
      ...targetColumns(owner),
      role: "primary",
      provenance: "legacy",
      rentalCategory: owner.type === "rentalBooking" ? document.rentalCategory : null,
    },
  });
}

async function insertLink(tx: DbTransaction, documentId: string, item: NewLink): Promise<void> {
  const primary = await tx.documentLink.findFirst({ where: { documentId, role: "primary" } });
  // A document with no primary takes the first link as its primary whatever was asked: a
  // document linked only as `covers` would show no entry and lose its unfiled clock.
  const role: LinkRole = primary ? (item.role ?? "covers") : "primary";
  if (role === "primary" && primary) {
    // A restored primary takes the role back; the one promoted meanwhile steps down.
    await tx.documentLink.update({ where: { id: primary.id }, data: { role: "covers" } });
  }
  await tx.documentLink.create({
    data: {
      documentId,
      ...targetColumns(item.entry),
      role,
      provenance: item.provenance ?? "user",
      rentalCategory: item.entry.type === "rentalBooking" ? (item.rentalCategory ?? null) : null,
    },
  });
}

export interface RemovedLink {
  role: LinkRole;
  provenance: LinkProvenance;
  rentalCategory: string | null;
  entry: EntryRef;
}

/**
 * Removes the document's link to ONE entry and nothing else. When it was the
 * primary, the database trigger hands the role to the next link (or unfiles the
 * document with its grace period). Returns what was removed, so a client can
 * offer to put exactly that back.
 */
export async function unlinkFromEntry(
  userId: string,
  documentId: string,
  entry: EntryRef
): Promise<RemovedLink> {
  return inLinkTransaction(async (tx) => {
    if (!(await lockDocument(tx, userId, documentId))) {
      throw new AppError("Document not found", 404, "DOCUMENT_NOT_FOUND");
    }
    await adoptLegacyPrimary(tx, documentId);
    const link: DocumentLink | null = await tx.documentLink.findFirst({
      where: { documentId, ...targetWhere(entry) },
    });
    if (!link)
      throw new AppError("Document is not linked to this entry", 404, "DOCUMENT_LINK_NOT_FOUND");
    await tx.documentLink.delete({ where: { id: link.id } });
    await projectPrimary(tx, documentId);
    return {
      role: link.role as LinkRole,
      provenance: link.provenance as LinkProvenance,
      rentalCategory: link.rentalCategory,
      entry,
    };
  });
}

export interface LinkCandidates {
  /** Entries of the trip(s) the document is already linked to, first. */
  tripEntries: EntryInfo[];
  /** The rest of the account's recent entries, capped per type. */
  otherEntries: EntryInfo[];
}

const OTHER_PER_TYPE = 40;

type Reader = { findMany(args: object): Promise<Array<{ id: string }>> };

/**
 * The entries a document may still be linked to: everything of the account it
 * is not linked to yet, those that share a trip with one of its links first.
 * Capped — a picker is not an export — and the client filters the rest by text.
 */
export async function listLinkCandidates(
  userId: string,
  documentId: string
): Promise<LinkCandidates> {
  const links = await listDocumentLinks(userId, documentId);
  const linked = new Set(links.map((l) => entryKey(l.entry)));
  const tripIds = [...new Set(links.flatMap((l) => (l.entry.tripId ? [l.entry.tripId] : [])))];

  const refs: EntryRef[] = [];
  const tripRefs: EntryRef[] = [];
  const recent = { orderBy: { createdAt: "desc" }, take: OTHER_PER_TYPE } as const;
  const select = { id: true } as const;
  const inTrips = { userId, tripId: { in: tripIds } };
  // One reader per type; the entry models share no common Prisma type.
  const readers: Array<[EntryRef["type"], Reader]> = [
    ["flight", prisma.flight],
    ["cruise", prisma.cruise],
    ["lodgingStay", prisma.lodgingStay],
    ["railJourney", prisma.railJourney],
    ["rentalBooking", prisma.rentalBooking],
    ["busJourney", prisma.busJourney],
    ["ferryJourney", prisma.ferryJourney],
    ["placeVisit", prisma.placeVisit],
    ["tripExpense", prisma.tripExpense],
  ] as Array<[EntryRef["type"], unknown]> as Array<[EntryRef["type"], Reader]>;
  for (const [type, model] of readers) {
    if (tripIds.length > 0) {
      for (const r of await model.findMany({ where: inTrips, select })) {
        tripRefs.push({ type, id: r.id });
      }
    }
    for (const r of await model.findMany({ where: { userId }, select, ...recent })) {
      refs.push({ type, id: r.id });
    }
  }
  for (const r of await prisma.trip.findMany({ where: { userId }, select, ...recent })) {
    refs.push({ type: "trip", id: r.id });
  }
  for (const id of tripIds) tripRefs.push({ type: "trip", id });

  const info = await describeEntries(userId, [...refs, ...tripRefs]);
  const taken = new Set(linked);
  const take = (list: EntryRef[]): EntryInfo[] =>
    list.flatMap((ref) => {
      const key = entryKey(ref);
      const found = info.get(key);
      if (!found || taken.has(key)) return [];
      taken.add(key);
      return [found];
    });
  return { tripEntries: take(tripRefs), otherEntries: take(refs) };
}

/**
 * The documents of the entry's own trip that are not linked to the entry yet —
 * what "Dokument aus der Reise verknüpfen" offers. Empty when the entry sits in
 * no trip; 404 when the entry is not the caller's.
 */
export async function listTripDocumentsFor(userId: string, entry: EntryRef): Promise<Document[]> {
  await assertEntryOwnedIn(prisma, userId, entry);
  const info = (await describeEntries(userId, [entry])).get(entryKey(entry));
  const tripId = entry.type === "trip" ? null : (info?.tripId ?? null);
  if (!tripId) return [];
  const column = LINK_TARGETS[entry.type].column;
  return prisma.document.findMany({
    where: {
      userId,
      links: { some: { tripId } },
      NOT: { links: { some: { [column]: entry.id } } },
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
}
