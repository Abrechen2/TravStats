import { AppError } from "../../middleware/errorHandler";

/**
 * What a PATCH on a stay actually leaves behind.
 *
 * A partial update is not the body — it is the body laid over the stored row,
 * and every derived field (status, times, FX day, total price) has to be
 * computed against THAT, not against whichever half arrived. The rule the
 * whole module turns on:
 *
 *   `undefined` means "not mentioned" and keeps the stored value.
 *   `null`      means "clear this" and must survive into every derivation.
 *
 * Collapsing those two with `?:` or `??` is what made a PATCH clearing both
 * dates store nulls in the columns while the check-in/out times stayed, the
 * status came out `in_progress` for a stay with no dates at all, and the FX
 * snapshot kept its old rate day (audit finding AUD-039).
 *
 * Lives here rather than in `routes/lodging.ts` because that file is at the
 * 800-line limit — and because a merge rule with a trap in it is worth being
 * able to test on its own.
 */

/** The fields of an update body this module reads. */
export interface StayPatchInput {
  checkIn?: string | null;
  checkOut?: string | null;
  datePrecision?: string;
  nights?: number | null;
}

/** The fields of the stored row this module reads. */
export interface StoredStayDates {
  checkIn: Date | null;
  checkOut: Date | null;
  datePrecision: string;
  nights: number | null;
}

export interface EffectiveStayDates {
  checkIn: Date | null;
  checkOut: Date | null;
  datePrecision: string;
  nights: number | null;
}

/** `undefined` keeps the stored value; `null` clears it. */
export function merged<T>(sent: T | null | undefined, stored: T | null): T | null {
  return sent !== undefined ? sent : stored;
}

/**
 * The dates the row will actually hold after this PATCH.
 *
 * Throws on an inverted range. The schema's own date-order refine only fires
 * when BOTH ends are in the SAME body, so a check-in-only update could
 * otherwise push a stay past its existing check-out and store the inversion.
 * An order can only be violated when both ends exist — a stay may legitimately
 * carry one date or none since 2.7, and there is nothing to compare then.
 */
export function resolveEffectiveStayDates(
  input: StayPatchInput,
  stay: StoredStayDates,
): EffectiveStayDates {
  const sentCheckIn =
    input.checkIn !== undefined ? (input.checkIn ? new Date(input.checkIn) : null) : undefined;
  const sentCheckOut =
    input.checkOut !== undefined ? (input.checkOut ? new Date(input.checkOut) : null) : undefined;

  const checkIn = merged(sentCheckIn, stay.checkIn);
  const checkOut = merged(sentCheckOut, stay.checkOut);

  if (checkIn !== null && checkOut !== null && checkOut.getTime() < checkIn.getTime()) {
    throw new AppError("checkOut must not precede checkIn", 400);
  }

  return {
    checkIn,
    checkOut,
    // Not nullable in the schema, so `??` is right here and only here.
    datePrecision: input.datePrecision ?? stay.datePrecision,
    nights: merged(input.nights, stay.nights),
  };
}
