/**
 * The opt-in "yearly totals" family (owner, 2026-11-25): the same metrics per calendar year,
 * for the years in which anything was recorded, in ONE snapshot — never one request per year.
 * Totals only: a year maps metric names to numbers, nothing that names a trip, place or date
 * beyond the year itself. The lifetime-only figures (countries, curated progress) are not
 * yearly and stay out; a year with no figure above zero is not listed.
 */
import { prisma } from "../../db";
import { now } from "../../shared/time/clock";

export type YearlyTotals = Record<string, Record<string, number | null>>;

/** Never walk further back than this, so a stray 1970 row cannot turn one request into 55 sweeps. */
export const MAX_YEARS = 40;

/** Metrics that exist for the lifetime view only. */
const LIFETIME_ONLY = (key: string): boolean => key === "countries" || key.startsWith("curated");

const yearOf = (d: Date | null | undefined): number | null => (d ? d.getUTCFullYear() : null);

/** The earliest calendar year in which any dated record exists; null for an account with none. */
async function firstYear(userId: string): Promise<number | null> {
  const [flight, stay, cruise, visit, rail, bus, ferry, rental, tour] = await Promise.all([
    prisma.flight.aggregate({ where: { userId }, _min: { departureTime: true } }),
    prisma.lodgingStay.aggregate({ where: { userId }, _min: { checkIn: true } }),
    prisma.cruise.aggregate({ where: { userId }, _min: { startDate: true } }),
    prisma.placeVisit.aggregate({ where: { userId }, _min: { visitedAt: true } }),
    prisma.railJourney.aggregate({ where: { userId }, _min: { departureTime: true } }),
    prisma.busJourney.aggregate({ where: { userId }, _min: { departureTime: true } }),
    prisma.ferryJourney.aggregate({ where: { userId }, _min: { departureTime: true } }),
    prisma.rentalBooking.aggregate({ where: { userId }, _min: { pickupTime: true } }),
    prisma.tripRoute.aggregate({ where: { userId }, _min: { tourDate: true } }),
  ]);
  const years = [
    yearOf(flight._min.departureTime),
    yearOf(stay._min.checkIn),
    yearOf(cruise._min.startDate),
    yearOf(visit._min.visitedAt),
    yearOf(rail._min.departureTime),
    yearOf(bus._min.departureTime),
    yearOf(ferry._min.departureTime),
    yearOf(rental._min.pickupTime),
    yearOf(tour._min.tourDate),
  ].filter((y): y is number => y !== null);
  return years.length ? Math.min(...years) : null;
}

/**
 * `figuresFor(year)` is the caller's per-year totals under the consent's scope. Years run
 * oldest to newest; the first one with data to the current one, at most `MAX_YEARS` of them.
 * Returns undefined when nothing was ever recorded — absent, not an empty year.
 */
export async function buildYearlyTotals(
  userId: string,
  figuresFor: (year: number) => Promise<Record<string, number | null | undefined>>
): Promise<YearlyTotals | undefined> {
  const first = await firstYear(userId);
  if (first === null) return undefined;
  const last = now().getUTCFullYear();
  const from = Math.max(first, last - MAX_YEARS + 1);
  const out: YearlyTotals = {};
  for (let year = from; year <= last; year++) {
    const figures = Object.entries(await figuresFor(year)).filter(
      (e): e is [string, number | null] => e[1] !== undefined && !LIFETIME_ONLY(e[0])
    );
    if (!figures.some(([, v]) => typeof v === "number" && v > 0)) continue;
    out[String(year)] = Object.fromEntries(figures);
  }
  return Object.keys(out).length ? out : undefined;
}
