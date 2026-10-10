import logger from "../../utils/logger";
import { isLocalDate } from "../../shared/time/localDate";
export { parsedDeadlineValuesShape } from "../../schemas/deadlines";
import {
  resolveDeadlineColumns,
  type DeadlineColumns,
  type DeadlineInput,
} from "./bookingDeadlines";

/**
 * Booking deadlines as a DOCUMENT states them (forgejo#285) — the generic
 * value contract a v2 template may fill for a lodging, a rental or a package,
 * and the one place those readings become stored columns.
 *
 * - `freeCancellationUntil`: `YYYY-MM-DDTHH:mm` on the place's own clock
 *   ("kostenlos stornierbar bis 1. Mai 18:00"), or `YYYY-MM-DD` when the
 *   document names only the day — kept as that day, no hour invented.
 * - `paymentDueOn`: `YYYY-MM-DD`, a calendar day with no zone.
 *
 * Issuer-specific reading stays in the template repository; the server only
 * knows these names.
 */

export interface ParsedDeadlines {
  freeCancellationUntil?: string | null;
  paymentDueOn?: string | null;
}

/** Only the deadlines actually read; an absent one is absent, never null. */
export function pickParsedDeadlines(values: ParsedDeadlines): ParsedDeadlines {
  return {
    ...(values.freeCancellationUntil
      ? { freeCancellationUntil: values.freeCancellationUntil }
      : {}),
    ...(values.paymentDueOn ? { paymentDueOn: values.paymentDueOn } : {}),
  };
}

function asInput(values: ParsedDeadlines): DeadlineInput {
  const input: DeadlineInput = {};
  const until = values.freeCancellationUntil;
  if (until) {
    input.freeCancellationUntil = isLocalDate(until)
      ? { kind: "date", date: until }
      : { kind: "local", local: until };
  }
  if (values.paymentDueOn) input.paymentDueOn = values.paymentDueOn;
  return input;
}

/**
 * The columns an import writes for what the document said, on `placeZone`
 * (the hotel's, the pickup station's; null for a package). Never fails the
 * import: a cancellation time whose place has no zone, or that falls in a
 * clock change's gap, is left out and logged — the payment day still lands.
 */
export async function parsedDeadlineColumns(
  values: ParsedDeadlines,
  placeZone: string | null,
  userId: string
): Promise<Partial<DeadlineColumns>> {
  const input = asInput(values);
  const ctx = { placeZone: () => placeZone, userId, viaToken: true };
  try {
    return await resolveDeadlineColumns(input, ctx);
  } catch (error) {
    logger.warn(
      {
        operation: "parsed_deadline_dropped",
        reason: error instanceof Error ? error.message : String(error),
      },
      "A parsed cancellation deadline could not be placed on a clock — imported without it"
    );
    return resolveDeadlineColumns({ paymentDueOn: input.paymentDueOn }, ctx);
  }
}

/** The stored deadline columns a re-import compares against. */
export const STORED_DEADLINE_SELECT = {
  freeCancellationUntil: true,
  freeCancellationOn: true,
  paymentDueOn: true,
} as const;

export interface StoredDeadlines {
  freeCancellationUntil: Date | null;
  freeCancellationOn: Date | null;
  paymentDueOn: Date | null;
}

export const DEADLINE_FIELDS = ["freeCancellationUntil", "paymentDueOn"] as const;
export type DeadlineField = (typeof DEADLINE_FIELDS)[number];

/**
 * What a RE-import may write: only the deadlines the stored row does not hold
 * yet. A deadline already on the row — typed by the user, edited, or from an
 * earlier mail — is never overwritten by a later document; the user changes it
 * by hand if the booking's terms really moved.
 */
export function emptyDeadlineFills(
  incoming: ParsedDeadlines,
  stored: StoredDeadlines
): ParsedDeadlines {
  const cancellationEmpty = !stored.freeCancellationUntil && !stored.freeCancellationOn;
  return {
    ...(incoming.freeCancellationUntil && cancellationEmpty
      ? { freeCancellationUntil: incoming.freeCancellationUntil }
      : {}),
    ...(incoming.paymentDueOn && !stored.paymentDueOn
      ? { paymentDueOn: incoming.paymentDueOn }
      : {}),
  };
}

/**
 * Which deadlines a write ACTUALLY filled, read off the resolved columns — a
 * cancellation time no clock could place was dropped and is not reported.
 */
export function filledDeadlineFields(columns: Partial<DeadlineColumns>): DeadlineField[] {
  return [
    ...(columns.freeCancellationUntil || columns.freeCancellationOn
      ? (["freeCancellationUntil"] as const)
      : []),
    ...(columns.paymentDueOn ? (["paymentDueOn"] as const) : []),
  ];
}

/**
 * Fill a stored row's EMPTY deadlines from a re-imported document: the
 * columns to write (empty when there is nothing to fill) and what they fill.
 */
export async function fillEmptyDeadlines(
  incoming: ParsedDeadlines,
  stored: StoredDeadlines,
  placeZone: string | null,
  userId: string
): Promise<{ columns: Partial<DeadlineColumns>; filled: DeadlineField[] }> {
  const fills = emptyDeadlineFills(incoming, stored);
  if (!fills.freeCancellationUntil && !fills.paymentDueOn) return { columns: {}, filled: [] };
  const columns = await parsedDeadlineColumns(fills, placeZone, userId);
  return { columns, filled: filledDeadlineFields(columns) };
}
