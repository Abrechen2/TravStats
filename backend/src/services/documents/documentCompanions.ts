import type { DbTransaction } from "../../db";

import { AppError } from "../../middleware/errorHandler";
import logger from "../../utils/logger";
import {
  factFields,
  isTravellerEntry,
  writeFactsInTx,
  type FactsPatch,
} from "../companions/travellerFacts";
import {
  LINK_TARGETS,
  entryOfColumns,
  inLinkTransaction,
  lockDocument,
  type EntryRef,
} from "./documentLinks";
import { extractPassengerNames, matchPassengers } from "./passengerMatch";
import { storedReading, type StoredReading } from "./storedReading";

/**
 * A document FOR a person — phase D7 of
 * docs/superpowers/specs/2026-11-21-document-links.md.
 *
 * The person lives on the LINK (`document_links.companion_id`), not on the
 * document: a boarding pass is one traveller's on the entry it covers, while a
 * package booking filed on the trip covers several people and may be "for"
 * different ones on different entries. `companion_id` null = the owner or the
 * whole group. `companion_source`: `user` (picked, or explicitly left on "me")
 * or `auto` (a parsed passenger name matched). A `user` decision is never
 * overwritten by a parse.
 *
 * Nothing here widens access: the companion must be the document's own
 * account's, and a link still grants nobody the document.
 */

export interface LinkCompanion {
  companionId: string | null;
  companionSource: "user" | "auto" | null;
}

/** Sets or clears the person of the document's link to ONE entry. */
export async function assignLinkCompanion(
  userId: string,
  documentId: string,
  entry: EntryRef,
  companionId: string | null
): Promise<LinkCompanion> {
  return inLinkTransaction(async (tx) => {
    if (!(await lockDocument(tx, userId, documentId))) {
      throw new AppError("Document not found", 404, "DOCUMENT_NOT_FOUND");
    }
    const link = await tx.documentLink.findFirst({
      where: { documentId, [LINK_TARGETS[entry.type].column]: entry.id },
      select: { id: true },
    });
    if (!link) {
      throw new AppError("Document is not linked to this entry", 404, "DOCUMENT_LINK_NOT_FOUND");
    }
    if (companionId) {
      const companion = await tx.companion.findFirst({
        where: { id: companionId, userId },
        select: { id: true },
      });
      if (!companion) throw new AppError("Companion not found", 404, "COMPANION_NOT_FOUND");
    }
    // `user` even on null: "this one is mine" is a decision a parse must keep.
    await tx.documentLink.update({
      where: { id: link.id },
      data: { companionId, companionSource: "user" },
    });
    return { companionId, companionSource: "user" };
  });
}

/** What the facts of a stored reading are, for the entry they are being put on. */
async function factsFor(
  tx: DbTransaction,
  reading: StoredReading,
  entry: EntryRef
): Promise<FactsPatch> {
  const values = reading.values;
  if (!values || !isTravellerEntry(entry.type)) return {};
  const allowed = new Set(factFields(entry.type));
  const wanted: FactsPatch = {};
  if (allowed.has("bookingReference")) wanted.bookingReference = values.bookingReference;
  if (entry.type === "flight") {
    wanted.seatNumber = values.seatNumber;
    wanted.seatClass = values.seatClass;
  }
  void tx;
  return Object.fromEntries(Object.entries(wanted).filter(([, v]) => v != null));
}

/** A flight's leg hints, so a multi-leg booking gives the seat of THIS leg. */
async function legHints(tx: DbTransaction, entry: EntryRef) {
  if (entry.type !== "flight") return {};
  const flight = await tx.flight.findUnique({
    where: { id: entry.id },
    select: { flightNumber: true, departureTime: true },
  });
  return {
    flightNumber: flight?.flightNumber ?? undefined,
    departureDate: flight?.departureTime
      ? flight.departureTime.toISOString().slice(0, 10)
      : undefined,
  };
}

export interface AutoAssignResult {
  /** Links given a person (or "me"). */
  assigned: number;
  /** Per-person facts written. */
  facts: number;
}

/**
 * Reads the passenger name off the document's stored reading and, when exactly
 * one person fits, assigns every still-undecided link of the document to them
 * and fills their EMPTY facts on the entries they are on. Never touches a link
 * the user decided, never overwrites a value. Abstains when the reading names
 * nobody, several people, or a name that fits no one or two.
 * Caller holds the document lock or runs in the transaction that wrote the link.
 */
export async function autoAssignInTx(
  tx: DbTransaction,
  userId: string,
  documentId: string
): Promise<AutoAssignResult> {
  const none: AutoAssignResult = { assigned: 0, facts: 0 };
  const document = await tx.document.findFirst({
    where: { id: documentId, userId },
    select: { id: true, parsedPayload: true },
  });
  if (!document || document.parsedPayload == null) return none;
  const names = extractPassengerNames(document.parsedPayload);
  if (names.length === 0) return none;
  const links = await tx.documentLink.findMany({
    where: { documentId, companionSource: null },
  });
  if (links.length === 0) return none;

  const [user, companions] = await Promise.all([
    tx.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true } }),
    tx.companion.findMany({ where: { userId }, select: { id: true, displayName: true } }),
  ]);
  const owner = [user?.firstName, user?.lastName].filter(Boolean).join(" ") || null;
  const verdict = matchPassengers(
    names,
    owner,
    companions.map((c) => ({ id: c.id, name: c.displayName }))
  );
  if (verdict.kind === "none") return none;

  const companionId = verdict.kind === "companion" ? verdict.companionId : null;
  let facts = 0;
  for (const link of links) {
    await tx.documentLink.update({
      where: { id: link.id },
      data: { companionId, companionSource: "auto" },
    });
    const entry = entryOfColumns(link);
    if (!companionId || !entry || !isTravellerEntry(entry.type)) continue;
    const reading = storedReading(document, await legHints(tx, entry));
    const patch = await factsFor(tx, reading, entry);
    if (Object.keys(patch).length === 0) continue;
    try {
      if (
        await writeFactsInTx(
          tx,
          userId,
          { type: entry.type, id: entry.id },
          companionId,
          patch,
          "auto"
        )
      ) {
        facts += 1;
      }
    } catch (error) {
      // The person is not on this entry (a package covers the trip's whole
      // group): the document is assigned, there is no row to put facts on.
      if (!(error instanceof AppError && error.code === "TRAVELLER_NOT_FOUND")) throw error;
    }
  }
  return { assigned: links.length, facts };
}

/**
 * After a parse was recorded on an existing document: the same pass, in its own
 * transaction. The parse already succeeded, so a failure here is logged, not
 * turned into a failed parse — the links stay unassigned and the user can pick.
 */
export async function autoAssignForDocument(userId: string, documentId: string): Promise<void> {
  try {
    await inLinkTransaction(async (tx) => {
      if (!(await lockDocument(tx, userId, documentId))) return;
      await autoAssignInTx(tx, userId, documentId);
    });
  } catch (error) {
    logger.warn(
      { operation: "document_auto_assign_companion", documentId, err: error },
      "Could not assign the document to a companion from its reading"
    );
  }
}
