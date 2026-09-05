import { useEnabledDomains } from "./useEnabledDomains";

/**
 * Whether the Places (POI) domain may be shown.
 *
 * ONE condition since 2026-09-05: `isEnabled("poi")` -- does THIS USER want
 * the domain. Until then there was a second, the `poiDomain` beta gate
 * -- was the INSTANCE allowed to show it -- and this hook existed to combine
 * the two in one place because there were six call sites (nav, dashboard tab,
 * dashboard counts, /places route, the module toggle, the trip timeline) and a
 * rule spread over six files is a rule applied five times after the next
 * change. The gate came off when its own condition was met (the CSV import
 * got its surface, POI Phase D section 5); the hook stays, because the call
 * sites still ask one question and the answer still deserves one home.
 *
 * VISIBILITY ONLY. `/api/v1/places` stays reachable for any authenticated
 * user whatever this returns -- a user's places survive the domain being
 * switched off: the rows are untouched and reappear when it comes back on.
 */
export function usePlacesVisible(): boolean {
  return usePlacesAccess() === "allowed";
}

/**
 * The same rule as a THREE-state answer, for the route guards and the stats
 * tab rule that were written for one.
 *
 * "pending" is no longer produced: the beta flag that could be unknown for
 * one request on a cold load is gone from this rule, and `enabledDomains` is
 * persisted, so the answer is known at first render. The state stays in the
 * type because `statsTabAccess.ts` and the route guards handle it, and a
 * three-state consumer of a two-state answer is merely thorough -- the
 * reverse, which bounced people off /places on every refresh in August, is
 * the bug this shape was introduced to end.
 */
export type PlacesAccess = "pending" | "allowed" | "denied";

export function usePlacesAccess(): PlacesAccess {
  const { isEnabled } = useEnabledDomains();
  return isEnabled("poi") ? "allowed" : "denied";
}
