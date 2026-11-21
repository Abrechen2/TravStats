import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { describeEntries, entryKey } from "../entryRefs";
import { inLinkTransaction, type EntryRef } from "../documentLinks";
import { addMissingLinksInTx } from "../documentEntryLinks";
import type { EntryType } from "../documentFormats";
import { SUGGESTABLE_TYPES } from "./match";

export interface SuggestedEntry {
  suggestionId: string;
  entry: EntryRef;
  label: string;
  /** Which field matched: bookingReference | flightNumber | trainNumber | lineName | hotelDates | dateRange. */
  reason: string;
}

export interface DocumentSuggestion {
  documentId: string;
  displayName: string;
  kind: string | null;
  entries: SuggestedEntry[];
}

const isSuggestable = (t: string): t is (typeof SUGGESTABLE_TYPES)[number] =>
  (SUGGESTABLE_TYPES as readonly string[]).includes(t);

/**
 * The account's pending proposals, grouped by document. A proposal whose entry
 * is gone (or no longer the account's) or already linked is deleted here and
 * left out — the list never shows what cannot be accepted.
 */
export async function listDocumentSuggestions(userId: string): Promise<DocumentSuggestion[]> {
  const rows = await prisma.documentLinkSuggestion.findMany({
    where: { userId, status: "pending", document: { userId } },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      document: { select: { id: true, originalName: true, storedName: true, kind: true } },
    },
  });
  if (rows.length === 0) return [];
  const refs = rows
    .filter((r) => isSuggestable(r.entryType))
    .map((r) => ({
      type: r.entryType as EntryType,
      id: r.entryId,
    }));
  const info = await describeEntries(userId, refs);
  const links = await prisma.documentLink.findMany({
    where: { documentId: { in: [...new Set(rows.map((r) => r.documentId))] } },
    select: {
      documentId: true,
      flightId: true,
      railJourneyId: true,
      busJourneyId: true,
      ferryJourneyId: true,
      lodgingStayId: true,
      rentalBookingId: true,
    },
  });
  const linked = new Set(
    links.flatMap((l) =>
      [
        l.flightId,
        l.railJourneyId,
        l.busJourneyId,
        l.ferryJourneyId,
        l.lodgingStayId,
        l.rentalBookingId,
      ]
        .filter((id): id is string => !!id)
        .map((id) => `${l.documentId}|${id}`)
    )
  );

  const stale: string[] = [];
  const groups = new Map<string, DocumentSuggestion>();
  for (const row of rows) {
    const known = isSuggestable(row.entryType)
      ? info.get(entryKey({ type: row.entryType, id: row.entryId }))
      : undefined;
    if (!known || linked.has(`${row.documentId}|${row.entryId}`)) {
      stale.push(row.id);
      continue;
    }
    let group = groups.get(row.documentId);
    if (!group) {
      group = {
        documentId: row.documentId,
        displayName: row.document.originalName ?? row.document.storedName,
        kind: row.document.kind,
        entries: [],
      };
      groups.set(row.documentId, group);
    }
    group.entries.push({
      suggestionId: row.id,
      entry: { type: known.type, id: known.id },
      label: known.label,
      reason: row.reason,
    });
  }
  if (stale.length > 0) {
    await prisma.documentLinkSuggestion.deleteMany({ where: { id: { in: stale }, userId } });
  }
  return [...groups.values()];
}

async function pendingFor(userId: string, documentId: string, ids?: readonly string[]) {
  const rows = await prisma.documentLinkSuggestion.findMany({
    where: {
      userId,
      documentId,
      status: "pending",
      document: { userId },
      ...(ids ? { id: { in: [...ids] } } : {}),
    },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
  });
  if (rows.length === 0) {
    throw new AppError(
      "This suggestion no longer exists",
      404,
      "DOCUMENT_LINK_SUGGESTION_NOT_FOUND"
    );
  }
  return rows;
}

/**
 * Accepts the ticked entries (all of the document's pending ones when `ids` is
 * absent) as `covers` links with provenance `suggestion`, in one transaction.
 * An entry that vanished meanwhile is dropped from the answer, not linked.
 */
export async function acceptDocumentSuggestions(
  userId: string,
  documentId: string,
  ids?: readonly string[]
): Promise<{ linked: number; skipped: number }> {
  const rows = await pendingFor(userId, documentId, ids);
  const info = await describeEntries(
    userId,
    rows
      .filter((r) => isSuggestable(r.entryType))
      .map((r) => ({ type: r.entryType as EntryType, id: r.entryId }))
  );
  const live = rows.filter((r) => info.has(`${r.entryType}:${r.entryId}`));
  const gone = rows.filter((r) => !info.has(`${r.entryType}:${r.entryId}`));
  const linked = await inLinkTransaction(async (tx) => {
    // Claim the rows first: a concurrent accept or dismiss that got there
    // already has them, and then nothing here may link.
    const claimed = await tx.documentLinkSuggestion.updateMany({
      where: { id: { in: live.map((r) => r.id) }, status: "pending" },
      data: { status: "accepted" },
    });
    if (claimed.count !== live.length) {
      throw new AppError(
        "This suggestion was decided meanwhile",
        404,
        "DOCUMENT_LINK_SUGGESTION_NOT_FOUND"
      );
    }
    const written = await addMissingLinksInTx(
      tx,
      userId,
      documentId,
      live.map((r) => ({
        entry: { type: r.entryType as EntryType, id: r.entryId },
        provenance: "suggestion" as const,
      }))
    );
    return written;
  });
  if (gone.length > 0) {
    await prisma.documentLinkSuggestion.deleteMany({
      where: { id: { in: gone.map((r) => r.id) } },
    });
  }
  return { linked, skipped: gone.length };
}

/** Remembers a "no" — by content key, so a re-imported entry is not proposed again. */
export async function dismissDocumentSuggestions(
  userId: string,
  documentId: string,
  ids?: readonly string[]
): Promise<number> {
  const rows = await pendingFor(userId, documentId, ids);
  const { count } = await prisma.documentLinkSuggestion.updateMany({
    where: { id: { in: rows.map((r) => r.id) }, userId, status: "pending" },
    data: { status: "dismissed" },
  });
  return count;
}
