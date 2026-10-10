import { Prisma } from "../../prisma";
import { prisma } from "../../db";
import logger from "../../utils/logger";
import { propagateWrite, shareSnapshot } from "../sharing/propagate";
import { resolveFxFields, type FxSnapshotOutcome } from "../../routes/lodging";
import type { StayCandidateFields } from "../../schemas/lodgingImport";
import { stayChanges } from "./lodgingImportPreview";
import { stayTimeColumns, zoneOfLodging } from "../timeModel/stayColumns";
import {
  STORED_DEADLINE_SELECT,
  fillEmptyDeadlines,
  type DeadlineField,
} from "../deadlines/parsedDeadlines";

/**
 * The `update` half of the lodging import commit (forgejo#122): a changed
 * booking moving ONE stored stay. Split out of `lodgingImportCommit.ts` when
 * the deadline fill (forgejo#285) took that file past the size limit.
 */

/** A hotel-local calendar day widened to the UTC-midnight instant the column stores. */
function toDate(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`);
}

/**
 * Thrown when an `update` row names no stay of this user's.
 *
 * `matchedStayId` comes back from the preview the CLIENT controls, and
 * `LodgingStay` carries its own `userId` with no compound FK — so an id that
 * exists proves nothing about whose it is. Same reasoning as
 * `OwnershipMismatchError` one row up; a separate code because "you sent no
 * stay" and "that stay is not yours" are different answers, and the second
 * must not hint that the id was real.
 */
export class MissingStayReferenceError extends Error {
  constructor() {
    super("matchedStayId names no stay of this user");
    this.name = "MissingStayReferenceError";
  }
}

/**
 * Move a stored stay onto the values a CHANGED booking carries.
 *
 * Two rules, both of which the preview already states and neither of which
 * may be taken on the client's word:
 *
 *  - The diff is recomputed HERE from the stored row. The client sends the
 *    action and the fields, not the verdict; trusting a client-sent diff would
 *    let a caller rewrite any field of its own stay through an import, and
 *    would silently write whatever the preview happened to say minutes ago.
 *  - Only the fields `stayChanges` names are written. A parsed mail sets every
 *    field it did not find to null, so writing the whole row would let a
 *    sparse confirmation erase a price, a rating or a note the user typed.
 *
 * The FX snapshot is re-taken only when the money moved, against the same
 * pre-resolved cache the create path uses.
 */
export async function updateStay(
  userId: string,
  stayId: string,
  fields: StayCandidateFields,
  fxOutcome: FxSnapshotOutcome
): Promise<{ filled: DeadlineField[] } | null> {
  const stored = await prisma.lodgingStay.findFirst({
    where: { id: stayId, userId },
    select: {
      id: true,
      lodgingId: true,
      externalRef: true,
      checkIn: true,
      checkOut: true,
      checkInTime: true,
      checkOutTime: true,
      roomCategory: true,
      board: true,
      guests: true,
      totalPrice: true,
      pricePerNight: true,
      currency: true,
      bookingReference: true,
      ...STORED_DEADLINE_SELECT,
    },
  });
  if (!stored) throw new MissingStayReferenceError();

  // The PREVIEW's proof is the external reference — "this is the same
  // booking". The commit demands the same proof rather than trusting the
  // action: without it a client could point `matchedStayId` at any stay of
  // its own account and rewrite it through the import endpoint, with fields
  // that never came from the document. Same capability as a PATCH, but
  // through a route whose whole premise is "this mail is that stay".
  if (!fields.externalRef || fields.externalRef !== stored.externalRef) {
    throw new MissingStayReferenceError();
  }

  const changes = stayChanges(fields, stored);
  if (changes.length === 0) return null;

  const data: Prisma.LodgingStayUpdateInput = {};
  for (const change of changes) {
    switch (change.field) {
      case "checkIn":
        data.checkIn = toDate(fields.checkIn);
        break;
      case "checkOut":
        data.checkOut = toDate(fields.checkOut);
        break;
      case "roomCategory":
        data.roomCategory = fields.roomCategory ?? null;
        break;
      case "board":
        data.board = fields.board ?? null;
        break;
      case "guests":
        data.guests = fields.guests ?? null;
        break;
      case "totalPrice":
        data.totalPrice = fields.totalPrice ?? null;
        break;
      case "pricePerNight":
        data.pricePerNight = fields.pricePerNight ?? null;
        break;
      case "currency":
        data.currency = fields.currency ?? undefined;
        break;
      case "bookingReference":
        data.bookingReference = fields.bookingReference ?? null;
        break;
    }
  }

  // The snapshot is keyed by (currency, check-in) on the create path, so it
  // goes stale when EITHER half moves — a date-only change leaves the stay
  // holding a rate from a day it no longer spans. Both are re-taken; a change
  // that touches neither keeps the rate the booking was made against.
  const moneyMoved = changes.some(
    (c) => c.field === "totalPrice" || c.field === "pricePerNight" || c.field === "currency"
  );
  // ...but only when THIS mail carries a price and its unit, because that is
  // what the pre-pass looked up. Applying an empty outcome would clear a
  // snapshot that is merely stale, and a stay with a price and no snapshot is
  // worse than one whose rate day is a month off.
  const canSnapshot = fields.totalPrice != null && !!fields.currency;
  const rateDayMoved = changes.some((c) => c.field === "checkIn");
  if (canSnapshot && (moneyMoved || rateDayMoved)) {
    Object.assign(data, resolveFxFields(fxOutcome));
  }

  // The new time columns follow the merged days (ADR 0002 phase 2); the
  // stored check-in/-out clocks stay the user's.
  if (changes.some((c) => c.field === "checkIn" || c.field === "checkOut")) {
    const dayMoved = (field: "checkIn" | "checkOut"): boolean =>
      changes.some((c) => c.field === field);
    Object.assign(
      data,
      stayTimeColumns(
        {
          checkIn: dayMoved("checkIn") ? toDate(fields.checkIn) : stored.checkIn,
          checkOut: dayMoved("checkOut") ? toDate(fields.checkOut) : stored.checkOut,
          checkInTime: stored.checkInTime,
          checkOutTime: stored.checkOutTime,
        },
        await zoneOfLodging(stored.lodgingId),
        "machine"
      )
    );
  }

  // Empty deadlines filled from the mail, never over stored ones (forgejo#285).
  const fill = await fillEmptyDeadlines(
    fields,
    stored,
    await zoneOfLodging(stored.lodgingId),
    userId
  );
  Object.assign(data, fill.columns);
  // A changed booking moved the dates: on a shared trip, the copies follow.
  const before = await shareSnapshot(prisma, "lodgingStay", stored.id);
  await prisma.lodgingStay.update({ where: { id: stored.id }, data });
  await propagateWrite(prisma, userId, "lodgingStay", stored.id, before);
  logger.info(
    {
      operation: "lodging_import_stay_updated",
      stayId: stored.id,
      // The FIELD NAMES, never the values: a stay's dates and price are the
      // user's data, not diagnostics.
      fields: changes.map((c) => c.field),
    },
    "[Lodging Import] Changed booking moved a stored stay"
  );
  return { filled: fill.filled };
}
