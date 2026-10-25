/**
 * What `GET /travtrack/months` answers, and the account's city-lookup switch
 * (TravTrack plan L3). Own account only; never in a share, a `.travstats`
 * file, a public link, a comparison or a federation payload.
 *
 *   - A month without data has no row and is absent from the answer, never
 *     a month of zeros.
 *   - `cities` is null while the lookup is off or not complete for the month
 *     ("nicht ermittelt"), never an empty list standing in for "unknown".
 *   - `pending` names the months a day of which is still owed to the
 *     projection: their row, if any, may be stale, and an absent one may be
 *     coming. A reader says so instead of passing either off as settled.
 */
import { Prisma } from "../../../prisma";
import { prisma } from "../../../db";
import { MONTHS_BIT } from "../dirtyDays";
import { takeTravTrackLock } from "../lock";
import type { City } from "./cities";

export type TravTrackMonth = {
  /** `YYYY-MM`, a UTC month. */
  month: string;
  kmGround: number;
  countries: string[];
  cities: City[] | null;
  daysWithData: number;
  daysPaused: number;
};

export type TravTrackMonths = { months: TravTrackMonth[]; pending: string[] };

const monthKey = (d: Date) => d.toISOString().slice(0, 7);

function citiesOf(value: Prisma.JsonValue | null): City[] | null {
  if (!Array.isArray(value)) return null;
  return value.flatMap((c) => {
    if (!c || typeof c !== "object" || Array.isArray(c)) return [];
    const name = (c as Record<string, unknown>).name;
    const code = (c as Record<string, unknown>).countryCode;
    if (typeof name !== "string") return [];
    return [{ name, countryCode: typeof code === "string" ? code : null }];
  });
}

export async function travTrackMonths(userId: string, year: number): Promise<TravTrackMonths> {
  const from = new Date(Date.UTC(year, 0, 1));
  const until = new Date(Date.UTC(year + 1, 0, 1));
  const [rows, owed] = await Promise.all([
    prisma.travTrackMonthValue.findMany({
      where: { userId, month: { gte: from, lt: until } },
      orderBy: { month: "asc" },
    }),
    prisma.$queryRaw<{ month: Date }[]>`
      SELECT DISTINCT date_trunc('month', day)::date AS month FROM travtrack_dirty_days
       WHERE user_id = ${userId} AND (done & ${MONTHS_BIT}) = 0
         AND day >= ${from}::date AND day < ${until}::date
       ORDER BY month ASC`,
  ]);
  return {
    months: rows.map((r) => ({
      month: monthKey(r.month),
      // To the metre's hundred: a figure, not a measurement's noise.
      kmGround: Math.round(r.kmGround * 10) / 10,
      countries: r.countries,
      cities: citiesOf(r.cities),
      daysWithData: r.daysWithData,
      daysPaused: r.daysPaused,
    })),
    pending: owed.map((r) => monthKey(r.month)),
  };
}

export async function travTrackCityLookup(userId: string): Promise<boolean> {
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: { travtrackCityLookup: true },
  });
  return row?.travtrackCityLookup === true;
}

/**
 * Switches the lookup and owes every month a recomputation: switched on, the
 * next run names their cities; switched off, the cities already named go at
 * once, in the same transaction.
 */
export async function setTravTrackCityLookup(userId: string, enabled: boolean): Promise<boolean> {
  await prisma.userSettings.createMany({
    data: [{ userId, data: {} as unknown as Prisma.InputJsonValue }],
    skipDuplicates: true,
  });
  await prisma.$transaction(async (tx) => {
    // Under the projection's lock: a month being written cannot keep cities
    // the account has just switched off.
    await takeTravTrackLock(tx, userId);
    await tx.userSettings.update({ where: { userId }, data: { travtrackCityLookup: enabled } });
    if (!enabled) {
      await tx.travTrackMonthValue.updateMany({
        where: { userId },
        data: { cities: Prisma.DbNull },
      });
    }
    await tx.$executeRaw`
      UPDATE travtrack_dirty_days SET done = done & ~${MONTHS_BIT}::int WHERE user_id = ${userId}`;
  });
  return enabled;
}
