import type { TimeFieldInput } from "../../shared/time/timeInput";
import { resolveTimeField, type ResolveContext } from "../../shared/time/resolveInput";
import { TzUnresolvedError } from "../../shared/time/errors";
import { fromDbDate, toDbDate } from "../../shared/time/localDate";
import {
  serializeDay,
  serializeTime,
  type LocalDateValue,
  type TimeValue,
} from "../../shared/time/wire";

/**
 * Booking deadlines (forgejo#285) — one home for the fields a stay, a rental
 * and a booking share, and for the flight's online check-in opening. The
 * inbound shapes are in `schemas/deadlines.ts`.
 *
 * Three kinds, as ADR 0002 D1 names them:
 *
 * - `freeCancellationUntil` / `onlineCheckInOpensAt` are INSTANTS stated on a
 *   place's clock ("free cancellation until 18:00 hotel time"). Stored as real
 *   UTC with the zone they were stated in beside it.
 * - `freeCancellationOn` is the same deadline known only to the DAY ("bis
 *   1. Mai"): the calendar day, with the zone of the place when there is one.
 *   No hour is invented — "until 23:59" or "until 00:00" would each be a
 *   guess, and a reminder computed from a guess fires at the wrong time.
 *   At most one of the instant and the day is set.
 * - `paymentDueOn` is a calendar day with NO zone — a bank's due day belongs
 *   to no station clock, like a rental's deposit days (forgejo#238).
 *
 * Abstention: null is "not recorded". Nothing derives a deadline from a
 * departure or a check-in — an airline whose check-in opens 30 h before is
 * not one whose opens 24 h before, and a guessed deadline that is wrong is
 * worse than none.
 *
 * Writes go through `resolveDeadlineColumns`: absent fields are left alone,
 * an explicit null clears, and an instant without a zone is refused
 * (`TZ_UNRESOLVED`) rather than stored on the server's clock.
 */

export interface DeadlineInput {
  freeCancellationUntil?: TimeFieldInput | null;
  paymentDueOn?: string | null;
}

export interface DeadlineColumns {
  freeCancellationUntil: Date | null;
  freeCancellationOn: Date | null;
  freeCancellationZone: string | null;
  paymentDueOn: Date | null;
}

export interface OnlineCheckInColumns {
  onlineCheckInOpensAt: Date | null;
  onlineCheckInZone: string | null;
}

export type DeadlineContext = Omit<ResolveContext, "field" | "legacyFakeUtc">;

/** One instant + its zone, or null for a clear. Refuses an instant whose zone nobody can name. */
async function resolveInstant(
  input: TimeFieldInput | null,
  field: string,
  ctx: DeadlineContext
): Promise<{ utc: Date; zone: string } | null> {
  if (input === null) return null;
  const resolved = await resolveTimeField(input, { ...ctx, field });
  // A machine instant at an entity with no place (a booking) has no clock to
  // be shown on; storing it zone-less would make every later reading a guess.
  if (!resolved.zone) throw new TzUnresolvedError("the deadline names no zone", field);
  return { utc: resolved.utc, zone: resolved.zone };
}

type CancellationColumns = Pick<
  DeadlineColumns,
  "freeCancellationUntil" | "freeCancellationOn" | "freeCancellationZone"
>;

async function cancellationColumns(
  input: TimeFieldInput | null,
  ctx: DeadlineContext
): Promise<CancellationColumns> {
  if (input !== null && input.kind === "date") {
    // A day keeps its day: the place's zone names whose day it is, and an
    // entity with no place (a booking) keeps a floating day — a day has a
    // meaning without a zone, an instant does not.
    return {
      freeCancellationUntil: null,
      freeCancellationOn: toDbDate(input.date),
      freeCancellationZone: ctx.placeZone(),
    };
  }
  const instant = await resolveInstant(input, "freeCancellationUntil", ctx);
  return {
    freeCancellationUntil: instant?.utc ?? null,
    freeCancellationOn: null,
    freeCancellationZone: instant?.zone ?? null,
  };
}

/**
 * The deadline columns a write leaves — only the keys that were sent, so a
 * client that never sends deadlines (an older Companion) never clears one.
 */
export async function resolveDeadlineColumns(
  input: DeadlineInput,
  ctx: DeadlineContext
): Promise<Partial<DeadlineColumns>> {
  const columns: Partial<DeadlineColumns> = {};
  if (input.freeCancellationUntil !== undefined) {
    Object.assign(columns, await cancellationColumns(input.freeCancellationUntil, ctx));
  }
  if (input.paymentDueOn !== undefined) {
    columns.paymentDueOn = input.paymentDueOn === null ? null : toDbDate(input.paymentDueOn);
  }
  return columns;
}

export async function resolveOnlineCheckInColumns(
  input: { onlineCheckInOpensAt?: TimeFieldInput | null },
  ctx: DeadlineContext
): Promise<Partial<OnlineCheckInColumns>> {
  if (input.onlineCheckInOpensAt === undefined) return {};
  const instant = await resolveInstant(input.onlineCheckInOpensAt, "onlineCheckInOpensAt", ctx);
  return { onlineCheckInOpensAt: instant?.utc ?? null, onlineCheckInZone: instant?.zone ?? null };
}

/** `input` without the deadline keys — for paths that spread a body into a Prisma write. */
export function withoutDeadlineInput<T extends DeadlineInput>(
  input: T
): Omit<T, "freeCancellationUntil" | "paymentDueOn"> {
  const { freeCancellationUntil: _c, paymentDueOn: _p, ...rest } = input;
  return rest;
}

/**
 * Whether resolved deadline columns change nothing on the stored row — so a
 * form re-sending what it read is no edit (the rental's `userEditedFields`).
 */
export function deadlinesUnchanged(
  next: Partial<DeadlineColumns>,
  stored: Partial<DeadlineColumns>
): boolean {
  const same = (a: Date | string | null | undefined, b: Date | string | null | undefined) =>
    (a instanceof Date ? a.getTime() : (a ?? null)) ===
    (b instanceof Date ? b.getTime() : (b ?? null));
  return (Object.keys(next) as Array<keyof DeadlineColumns>).every((key) =>
    same(next[key], stored[key])
  );
}

/** The read side: the deadline members of an entity's `times`. */
export interface DeadlineTimes {
  freeCancellationUntil: TimeValue | null;
  freeCancellationOn: LocalDateValue | null;
  paymentDue: LocalDateValue | null;
}

export function deadlineTimes(row: Partial<DeadlineColumns>): DeadlineTimes {
  const until = row.freeCancellationUntil ?? null;
  const day = row.freeCancellationOn ?? null;
  const zone = row.freeCancellationZone ?? null;
  return {
    freeCancellationUntil: until && zone ? serializeTime(until, zone) : null,
    // The instant wins should a row ever hold both: it is the more precise claim.
    freeCancellationOn: !until && day ? serializeDay(fromDbDate(day), zone) : null,
    paymentDue: row.paymentDueOn ? serializeDay(fromDbDate(row.paymentDueOn), null) : null,
  };
}

export function onlineCheckInTime(row: Partial<OnlineCheckInColumns>): TimeValue | null {
  const at = row.onlineCheckInOpensAt ?? null;
  const zone = row.onlineCheckInZone ?? null;
  return at && zone ? serializeTime(at, zone) : null;
}

/** A `@db.Date` deadline column as the day it holds — it must never leave as a JS midnight. */
export function deadlineDay(value: Date | null | undefined): string | null {
  return value ? fromDbDate(value) : null;
}

/** The raw deadline DAY columns of a row as `YYYY-MM-DD`, for DTOs that hand the row on. */
export function deadlineDayFields(row: Partial<DeadlineColumns>): {
  freeCancellationOn: string | null;
  paymentDueOn: string | null;
} {
  return {
    freeCancellationOn: deadlineDay(row.freeCancellationOn),
    paymentDueOn: deadlineDay(row.paymentDueOn),
  };
}
