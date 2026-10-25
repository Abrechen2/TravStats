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
import { MAX_JUMP_STEP_MS, MAX_MASKED_RUN } from "../locationEvidence/anomaly";

/** `done` bit of the country-day projection (E6). L1 adds 2, L3 adds 4. */
export const COUNTRY_DAYS_BIT = 1;

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/**
 * How many fixes of each device beyond a day's edge a projection reads as
 * context: the longest masked run and the fix that closes it. With them the
 * anomaly mask judges a run across midnight as one continuous read would.
 */
export const CONTEXT_FIXES = MAX_MASKED_RUN + 1;
/** No fix further than a jump's longest step beyond the edge is context. */
export const CONTEXT_SPAN_MS = MAX_JUMP_STEP_MS;

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

/**
 * The days a removal of `days` makes unusable: the days themselves and both
 * neighbours, whose projection read the removed points as edge context
 * (`CONTEXT_FIXES`). Their derived rows go with the removal, and every open
 * question resting on one of them goes too (E5, `invalidate.ts`).
 */
export function removalDays(days: readonly string[]): string[] {
  const out = new Set<string>();
  for (const day of days) {
    if (!DAY.test(day)) continue;
    const ms = Date.parse(`${day}T00:00:00.000Z`);
    out.add(utcDayOf(ms - DAY_MS));
    out.add(day);
    out.add(utcDayOf(ms + DAY_MS));
  }
  return [...out].sort();
}

/**
 * The days of `[fromDay, untilDay]` (inclusive) whose `bit` is not set on
 * their current version: rows derived for them may be stale, so nothing reads
 * them until the projection ran again. In `tx` when given, so a check under
 * the TravTrack lock sees what committed before it.
 */
export async function unprojectedDaysIn(
  userId: string,
  bit: number,
  fromDay: string,
  untilDay: string,
  tx: DbTransaction | typeof prisma = prisma
): Promise<Set<string>> {
  const rows = await tx.$queryRaw<{ day: Date }[]>`
    SELECT day FROM travtrack_dirty_days
     WHERE user_id = ${userId} AND (done & ${bit}) = 0
       AND day >= ${fromDay}::date AND day <= ${untilDay}::date`;
  return new Set(rows.map((r) => r.day.toISOString().slice(0, 10)));
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

/**
 * The neighbouring days whose projection reads these freshly stored points as
 * context (`CONTEXT_FIXES` of a device beyond the edge, within
 * `CONTEXT_SPAN_MS`): their masking may change, so they are marked too. Asked
 * after the insert, per device and day.
 */
export async function neighbourDaysOf(
  tx: DbTransaction,
  userId: string,
  points: readonly { tMs: number; deviceId: string | null }[]
): Promise<string[]> {
  const groups = new Map<
    string,
    { deviceId: string | null; day: number; min: number; max: number }
  >();
  for (const p of points) {
    const day = Math.floor(p.tMs / DAY_MS) * DAY_MS;
    const key = `${p.deviceId ?? ""} ${day}`;
    const g = groups.get(key);
    if (g) {
      g.min = Math.min(g.min, p.tMs);
      g.max = Math.max(g.max, p.tMs);
    } else groups.set(key, { deviceId: p.deviceId, day, min: p.tMs, max: p.tMs });
  }
  const days = new Set<string>();
  for (const g of groups.values()) {
    const next = g.day + DAY_MS;
    const [{ before, after }] = await tx.$queryRaw<{ before: bigint; after: bigint }[]>`
      SELECT
        count(*) FILTER (WHERE t >= ${new Date(g.day)} AND t < ${new Date(g.min)}) AS before,
        count(*) FILTER (WHERE t > ${new Date(g.max)} AND t < ${new Date(next)}) AS after
        FROM travtrack_points
       WHERE user_id = ${userId} AND device_id IS NOT DISTINCT FROM ${g.deviceId}
         AND t >= ${new Date(g.day)} AND t < ${new Date(next)}`;
    if (before < BigInt(CONTEXT_FIXES) && g.min - g.day < CONTEXT_SPAN_MS) {
      days.add(utcDayOf(g.day - DAY_MS));
    }
    if (after < BigInt(CONTEXT_FIXES) && next - g.max <= CONTEXT_SPAN_MS) days.add(utcDayOf(next));
  }
  return [...days].sort();
}

/**
 * `[from, until)` a projection of the day `[dayStart, dayEnd)` reads: the day,
 * plus each device's last `CONTEXT_FIXES` before it and first after it, within
 * `CONTEXT_SPAN_MS`.
 */
export async function contextWindow(
  userId: string,
  dayStart: Date,
  dayEnd: Date,
  tx: DbTransaction | typeof prisma = prisma
): Promise<{ fromMs: number; untilMs: number }> {
  const [{ from_t: fromT }] = await tx.$queryRaw<{ from_t: Date | null }[]>`
    SELECT min(t) AS from_t FROM (
      SELECT t, row_number() OVER (PARTITION BY device_id ORDER BY t DESC) AS rn
        FROM travtrack_points
       WHERE user_id = ${userId} AND t < ${dayStart}
         AND t >= ${new Date(dayStart.getTime() - CONTEXT_SPAN_MS)}) x
     WHERE rn <= ${CONTEXT_FIXES}`;
  const [{ until_t: untilT }] = await tx.$queryRaw<{ until_t: Date | null }[]>`
    SELECT max(t) AS until_t FROM (
      SELECT t, row_number() OVER (PARTITION BY device_id ORDER BY t ASC) AS rn
        FROM travtrack_points
       WHERE user_id = ${userId} AND t >= ${dayEnd}
         AND t < ${new Date(dayEnd.getTime() + CONTEXT_SPAN_MS)}) x
     WHERE rn <= ${CONTEXT_FIXES}`;
  return {
    fromMs: fromT ? fromT.getTime() : dayStart.getTime(),
    untilMs: untilT ? untilT.getTime() + 1 : dayEnd.getTime(),
  };
}
