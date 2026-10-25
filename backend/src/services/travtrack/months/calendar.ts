/**
 * The Statistik calendar (TravTrack plan T5.3): per UTC day of a year the
 * ground kilometres along the privacy-safe line, read from what the monthly
 * projection stored (`project.ts` writes `dayValues` with each month) — no
 * point is read here, so a year costs twelve rows.
 *
 *   - `days` lists every day with a privacy-safe vertex: `recorded: true`
 *     and its kilometres (0 is a measurement — recorded, not moved). A day of
 *     a settled month that is absent was not recorded; never a day of zeros.
 *   - `pending` names the months a day of which is still owed to the
 *     projection ("wird vorbereitet"): their days may change or appear.
 *   - `unavailable` names months whose row predates the calendar and is not
 *     owed — their days are not known, and are not passed off as empty.
 */
import { prisma } from "../../../db";
import { MONTHS_BIT } from "../dirtyDays";

export type TravTrackCalendarDay = { day: string; kmGround: number; recorded: true };

export type TravTrackCalendar = {
  year: number;
  days: TravTrackCalendarDay[];
  pending: string[];
  unavailable: string[];
};

const monthKey = (d: Date) => d.toISOString().slice(0, 7);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The stored `{ day: km }` of one month, or null when the row carries none. */
function dayValuesOf(value: unknown, month: string): Array<[string, number]> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return Object.entries(value as Record<string, unknown>).flatMap(([day, km]) =>
    DAY.test(day) && day.startsWith(month) && typeof km === "number" && Number.isFinite(km)
      ? [[day, km] as [string, number]]
      : []
  );
}

export async function travTrackCalendar(userId: string, year: number): Promise<TravTrackCalendar> {
  const from = new Date(Date.UTC(year, 0, 1));
  const until = new Date(Date.UTC(year + 1, 0, 1));
  const [rows, owed] = await Promise.all([
    prisma.travTrackMonthValue.findMany({
      where: { userId, month: { gte: from, lt: until } },
      orderBy: { month: "asc" },
      select: { month: true, dayValues: true },
    }),
    prisma.$queryRaw<{ month: Date }[]>`
      SELECT DISTINCT date_trunc('month', day)::date AS month FROM travtrack_dirty_days
       WHERE user_id = ${userId} AND (done & ${MONTHS_BIT}) = 0
         AND day >= ${from}::date AND day < ${until}::date
       ORDER BY month ASC`,
  ]);
  const pending = owed.map((r) => monthKey(r.month));
  const days: TravTrackCalendarDay[] = [];
  const unavailable: string[] = [];
  for (const row of rows) {
    const month = monthKey(row.month);
    const values = dayValuesOf(row.dayValues, month);
    if (!values) {
      if (!pending.includes(month)) unavailable.push(month);
      continue;
    }
    for (const [day, km] of values) {
      // To the metre's hundred, like the months.
      days.push({ day, kmGround: Math.round(km * 10) / 10, recorded: true });
    }
  }
  days.sort((a, b) => a.day.localeCompare(b.day));
  return { year, days, pending, unavailable };
}
