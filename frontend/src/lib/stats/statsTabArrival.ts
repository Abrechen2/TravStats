/**
 * Router state a link sets when it opens a statistics tab from further down
 * the page. A tab change is a query change on the same route, so the browser
 * kept the overview's scroll position and the tab opened mid-page (CT106
 * design-6 R05). Carried as state, not a global scroll-to-top, so filters and
 * the back button keep their position.
 */
export const STATS_TAB_ARRIVAL = { statsTabArrival: true } as const;

export function isStatsTabArrival(state: unknown): boolean {
  return (
    typeof state === "object" &&
    state !== null &&
    (state as { statsTabArrival?: unknown }).statsTabArrival === true
  );
}
