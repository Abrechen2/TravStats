import { DOMAINS, type DomainKey } from "../../shared/domains";

/**
 * Where a year card sends the reader.
 *
 * The map is the dashboard with its year filter set from the URL (`useDashboardYearParam`), so
 * a link is just `?year=YYYY` on the tab. A domain's logbook takes `?year=` and, for flights,
 * `?month=`. A domain whose list has no such filter (lodging, places) never carries a distance,
 * so it is never linked from here.
 */

/** `/dashboard?year=2024` — the "Alle" map on that year. */
export function dashboardYearHref(year: number): string {
  return `/dashboard?year=${year}`;
}

/** The lists that take `?month=` beside `?year=`: flights (client-side) and the server-filtered ones. */
const MONTH_LISTS: ReadonlySet<DomainKey> = new Set([
  "flight",
  "rail",
  "bus",
  "ferry",
  "rental",
  "cruise",
]);

/** The domain's list for a year, and where the list can, a month of it. */
export function domainListHref(domain: DomainKey, year: number, month?: number): string {
  const query = new URLSearchParams({ year: String(year) });
  if (month !== undefined && MONTH_LISTS.has(domain)) query.set("month", String(month));
  return `${DOMAINS[domain].routePrefix}?${query.toString()}`;
}

/** A plausible calendar year from a query string; null for anything else. */
export function yearFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get("year");
  if (raw === null || !/^\d{4}$/.test(raw)) return null;
  const year = Number(raw);
  return year >= 1900 && year <= 2200 ? year : null;
}

/** A month 1-12 from a query string; null for anything else. */
export function monthFromSearch(search: string): number | null {
  const raw = new URLSearchParams(search).get("month");
  if (raw === null || !/^\d{1,2}$/.test(raw)) return null;
  const month = Number(raw);
  return month >= 1 && month <= 12 ? month : null;
}
