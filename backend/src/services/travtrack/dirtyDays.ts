/**
 * The UTC days of an account's TravTrack history that a projection has still
 * to (re)derive (TravTrack plan E1 table, E6). A day is marked whenever a
 * point of it is stored or removed: `version` is raised and `done` — a bitmask
 * of the projections that ran on that version — is cleared. A projection
 * acknowledges a day by setting its bit, and only for the version it read, so
 * a point stored meanwhile makes the day run again rather than be lost.
 *
 * Holds days, never positions.
 */
import { prisma, type DbTransaction } from "../../db";

/** `done` bit of the country-day projection (E6). L1 adds 2, L3 adds 4. */
export const COUNTRY_DAYS_BIT = 1;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The UTC calendar day of an instant, `YYYY-MM-DD`. */
export const utcDayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** The distinct UTC days of these instants, oldest first. */
export function utcDaysOf(instants: Iterable<number>): string[] {
  const days = new Set<string>();
  for (const ms of instants) if (Number.isFinite(ms)) days.add(utcDayOf(ms));
  return [...days].sort();
}

/** Marks days dirty for every projection: a new row at version 1, an existing one raised. */
export async function markTravTrackDaysDirty(
  tx: DbTransaction,
  userId: string,
  days: readonly string[]
): Promise<void> {
  const valid = [...new Set(days)].filter((d) => DAY.test(d)).sort();
  if (valid.length === 0) return;
  await tx.$executeRaw`
    INSERT INTO travtrack_dirty_days (user_id, day, version, done)
    SELECT ${userId}, d::date, 1, 0 FROM unnest(${valid}::text[]) AS d
    ON CONFLICT (user_id, day)
    DO UPDATE SET version = travtrack_dirty_days.version + 1, done = 0`;
}

/** Marks dirty every UTC day on which this account holds a TravTrack point. */
export async function markAllPointDaysDirty(tx: DbTransaction, userId: string): Promise<number> {
  // `t` is a TIMESTAMP holding UTC, so its date is the UTC day.
  return tx.$executeRaw`
    INSERT INTO travtrack_dirty_days (user_id, day, version, done)
    SELECT DISTINCT ${userId}, t::date, 1, 0
      FROM travtrack_points WHERE user_id = ${userId}
    ON CONFLICT (user_id, day)
    DO UPDATE SET version = travtrack_dirty_days.version + 1, done = 0`;
}

export type DirtyDay = { day: string; version: bigint };

/** Days whose `bit` is not set on their current version, oldest first. */
export async function pendingDirtyDays(
  userId: string,
  bit: number,
  limit: number,
  tx: DbTransaction | typeof prisma = prisma
): Promise<DirtyDay[]> {
  const rows = await tx.$queryRaw<{ day: Date; version: bigint }[]>`
    SELECT day, version FROM travtrack_dirty_days
     WHERE user_id = ${userId} AND (done & ${bit}) = 0
     ORDER BY day ASC LIMIT ${limit}`;
  return rows.map((r) => ({ day: r.day.toISOString().slice(0, 10), version: r.version }));
}

/** Sets `bit` on the day if it is still at `version`; false when it was marked again meanwhile. */
export async function ackDirtyDay(
  tx: DbTransaction,
  userId: string,
  { day, version }: DirtyDay,
  bit: number
): Promise<boolean> {
  const count = await tx.$executeRaw`
    UPDATE travtrack_dirty_days SET done = done | ${bit}
     WHERE user_id = ${userId} AND day = ${day}::date AND version = ${version}`;
  return count > 0;
}

/** Accounts with a day `bit` has still to run on. */
export async function accountsWithDirtyDays(bit: number): Promise<string[]> {
  const rows = await prisma.$queryRaw<{ user_id: string }[]>`
    SELECT DISTINCT user_id FROM travtrack_dirty_days WHERE (done & ${bit}) = 0
     ORDER BY user_id`;
  return rows.map((r) => r.user_id);
}
