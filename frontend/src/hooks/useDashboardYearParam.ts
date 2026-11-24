import { useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";

import { useDashboardFilterStore } from "../store/dashboardFilterStore";
import { yearFromSearch } from "../lib/stats/yearLinks";

/**
 * `/dashboard?year=2024` — the dashboard's year filter, carried by the URL.
 *
 * The filter itself is `dashboardFilterStore.year` (the "Jahr" select of the map panel; every
 * tab that filters reads it). This keeps the two in step: a link sets the store, and a change
 * of the select writes the URL, so a map on one year can be reloaded or shared. A URL without a
 * year never clears a year the reader chose — only choosing "all years" does.
 */
export function useDashboardYearParam(): void {
  const [search, setSearch] = useSearchParams();
  const year = useDashboardFilterStore((s) => s.year);
  const setYear = useDashboardFilterStore((s) => s.setYear);
  const urlYear = yearFromSearch(search.toString());
  const previous = useRef(year);

  // URL → filter.
  useEffect(() => {
    if (urlYear !== null && urlYear !== year) setYear(urlYear);
    // Only a change of the URL's year may set the filter; the filter's own change is below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlYear]);

  // Filter → URL: when the reader changed it, or the URL has none to show.
  useEffect(() => {
    const changed = previous.current !== year;
    previous.current = year;
    if (year === urlYear || (!changed && urlYear !== null)) return;
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (year === null) next.delete("year");
        else next.set("year", String(year));
        return next;
      },
      { replace: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, urlYear]);
}
