/**
 * The Statistik calendar (TravTrack plan T5.3): per UTC day of a year the
 * ground kilometres along the privacy-safe line, read from what the monthly
 * projection stored (`project.ts` writes `dayValues` with each month) — no
 * point is read here, so a year costs twelve rows.
 *
 *   - `days` lists every day with a privacy-safe vertex: `recorded: true`
 *     and its kilometres (0 is a measurement — recorded, not moved). A day of
 *     a settled month that is absent was not recorded; never a day of zeros.
 *   - Each listed day also says, additively, whether a `trip` of the account
 *     spans it (the trip's first to last day, inclusive; the stored local-day
 *     labels, else the dates' UTC days) and whether a `flight` was in the air
 *     on it (departure to arrival UTC day of a flight that is not cancelled).
 *     Only listed days carry the flags: a trip or flight day with no recorded
 *     vertex stays absent rather than becoming a `recorded: false` row.
 *   - `pending` names the months a day of which is still owed to the
 *     projection ("wird vorbereitet"): their days may change or appear.
 *   - `unavailable` names months whose row predates the calendar and is not
 *     owed — their days are not known, and are not passed off as empty.
 */
import { prisma } from "../../../db";
import { MONTHS_BIT } from "../dirtyDays";

export type TravTrackCalendarDay = {
  day: string;
  kmGround: number;
  recorded: true;
  trip: boolean;
  flight: boolean;
};

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

const DAY_MS = 86_400_000;
const dayKey = (d: Date): string => d.toISOString().slice(0, 10);
/** More than this is a data error (a mistyped arrival year), not a flight. */
const MAX_FLIGHT_DAYS = 3;

/** Every `YYYY-MM-DD` from `from` to `to` inclusive, clipped to the window. */
function addSpan(into: Set<string>, from: Date, to: Date, limit: number, lo: string, hi: string) {
  const end = Math.min(to.getTime(), from.getTime() + (limit - 1) * DAY_MS);
  for (let t = from.getTime(); t <= end; t += DAY_MS) {
    const key = dayKey(new Date(t));
    if (key >= lo && key < hi) into.add(key);
  }
}

/** The days of the year a trip spans and the days a flight was in the air. */
async function tripAndFlightDays(userId: string, from: Date, until: Date) {
  const [trips, flights] = await Promise.all([
    prisma.trip.findMany({
      where: {
        userId,
        OR: [{ startDay: { not: null } }, { startDate: { not: null } }],
        AND: [
          { OR: [{ startDay: { lt: until } }, { startDay: null, startDate: { lt: until } }] },
          {
            OR: [
              { endDay: { gte: from } },
              { endDay: null, endDate: { gte: from } },
              { endDay: null, endDate: null },
            ],
          },
        ],
      },
      select: { startDay: true, endDay: true, startDate: true, endDate: true },
    }),
    prisma.flight.findMany({
      where: {
        userId,
        status: { not: "cancelled" },
        departureTime: { gte: new Date(from.getTime() - DAY_MS), lt: until },
      },
      select: { departureTime: true, arrivalTime: true },
    }),
  ]);
  const lo = dayKey(from);
  const hi = dayKey(until);
  const tripDays = new Set<string>();
  for (const t of trips) {
    const start = t.startDay ?? t.startDate;
    if (!start) continue;
    const end = t.endDay ?? t.endDate ?? start;
    addSpan(tripDays, start, end < start ? start : end, 3660, lo, hi);
  }
  const flightDays = new Set<string>();
  for (const f of flights) {
    if (!f.departureTime) continue;
    const arr = f.arrivalTime && f.arrivalTime >= f.departureTime ? f.arrivalTime : f.departureTime;
    addSpan(
      flightDays,
      startOfUtcDay(f.departureTime),
      startOfUtcDay(arr),
      MAX_FLIGHT_DAYS,
      lo,
      hi
    );
  }
  return { tripDays, flightDays };
}

const startOfUtcDay = (d: Date): Date =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));

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
  const { tripDays, flightDays } = await tripAndFlightDays(userId, from, until);
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
      days.push({
        day,
        kmGround: Math.round(km * 10) / 10,
        recorded: true,
        trip: tripDays.has(day),
        flight: flightDays.has(day),
      });
    }
  }
  days.sort((a, b) => a.day.localeCompare(b.day));
  return { year, days, pending, unavailable };
}
