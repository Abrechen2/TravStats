/**
 * The statistics year, in the address bar.
 *
 * CT106 audit, B04: on the overview, year 2005 → "Details →" landed on the
 * flights tab showing 2026. The year lived only in component state, the detail
 * link carried only `?tab=`, and the page it opened picked the newest year
 * again. A period that does not survive a link is not a period the reader
 * chose — so it goes where links, the back button and a shared URL can see it.
 *
 * `year=2005` is a year, `year=all` is "all years", and no parameter means the
 * reader has not chosen, so the page may pick the newest year for them.
 */
export const YEAR_PARAM = "year";
const ALL_YEARS = "all";

/** `undefined` = not chosen; `null` = all years; a number = that year. */
export function parseYearParam(value: string | null): number | null | undefined {
  if (value === null || value === "") return undefined;
  if (value === ALL_YEARS) return null;
  if (!/^\d{4}$/.test(value)) return undefined;
  return Number(value);
}

export function formatYearParam(year: number | null): string {
  return year === null ? ALL_YEARS : String(year);
}

/** `route` with the year set, keeping whatever else its query already says. */
export function withYear(route: string, year: number | null): string {
  const [path, query = ""] = route.split("?");
  const params = new URLSearchParams(query);
  params.set(YEAR_PARAM, formatYearParam(year));
  return `${path}?${params.toString()}`;
}
