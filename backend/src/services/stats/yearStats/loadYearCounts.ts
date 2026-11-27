import { prisma } from "../../../db";
import { now as clockNow } from "../../../shared/time/clock";
import { classifyStay } from "../../../shared/lodgingCounting";
import { resolveStayTiming } from "../../../shared/lodgingTiming";
import { classifyVisit, visitYear } from "../../../shared/placeCounting";
import { loadVisibleDomainSet, type VisibleDomains } from "../../domainVisibility";
import { loadDistanceEntries } from "./loadEntries";

export interface YearCount {
  year: number;
  total: number;
  byDomain: Record<string, number>;
}

/**
 * `GET /stats/years/counts` — entries per year and domain. It folds the very entries
 * `/stats/years` measures (each domain's own counting rule, each filed on its own calendar), so a
 * year's caption in the picker can never disagree with the card of that year about what counts.
 *
 * Stays and place visits carry no distance, so the cards never see them; the lodging and places
 * year filters still want their caption. They are counted under `byDomain.lodging` / `byDomain.poi`
 * by their own rules (a stay once its check-out is past, filed by its check-in; a visit that has
 * happened, filed on the place's calendar) and stay OUT of `total`, which keeps meaning "the
 * entries the year cards measure". Newest year first.
 */
export async function loadYearCounts(userId: string): Promise<{ years: YearCount[] }> {
  const now = clockNow();
  const visible = await loadVisibleDomainSet(userId);
  const [entries, stayYears, visitYears] = await Promise.all([
    loadDistanceEntries(userId, now, visible),
    loadStayYears(userId, now, visible),
    loadVisitYears(userId, now, visible),
  ]);
  const byYear = new Map<number, YearCount>();
  const add = (year: number, domain: string, countsInTotal: boolean) => {
    const row = byYear.get(year) ?? { year, total: 0, byDomain: {} };
    if (countsInTotal) row.total += 1;
    row.byDomain[domain] = (row.byDomain[domain] ?? 0) + 1;
    byYear.set(year, row);
  };
  for (const entry of entries) {
    const year = Number(entry.month.slice(0, 4));
    if (Number.isInteger(year)) add(year, entry.domain, true);
  }
  for (const year of stayYears) add(year, "lodging", false);
  for (const year of visitYears) add(year, "poi", false);
  return { years: [...byYear.values()].sort((a, b) => b.year - a.year) };
}

/** The check-in year of every stay that counts (`lodgingCounting`); placeholder spans file nowhere. */
async function loadStayYears(
  userId: string,
  now: Date,
  visible: VisibleDomains
): Promise<number[]> {
  if (!visible.has("lodging")) return [];
  const stays = await prisma.lodgingStay.findMany({
    where: { userId },
    select: { status: true, checkIn: true, checkOut: true, datePrecision: true, nights: true },
  });
  return stays.flatMap((s) => {
    if (classifyStay(s, now) !== "visited") return [];
    const timing = resolveStayTiming(s);
    return timing.canBucketByYear && timing.anchor ? [timing.anchor.getUTCFullYear()] : [];
  });
}

/** The year of every visit that has happened (`placeCounting`); an undated visit claims none. */
async function loadVisitYears(
  userId: string,
  now: Date,
  visible: VisibleDomains
): Promise<number[]> {
  if (!visible.has("poi")) return [];
  const visits = await prisma.placeVisit.findMany({
    where: { place: { userId } },
    select: { visitedAt: true, visitedAtUtc: true, visitedZone: true },
  });
  return visits.flatMap((v) => {
    const year = classifyVisit(v, now) === "visited" ? visitYear(v) : null;
    return year === null ? [] : [year];
  });
}
