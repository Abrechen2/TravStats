import { useEnabledDomains } from "../../hooks/useEnabledDomains";
import { usePlacesVisible } from "../../hooks/usePlacesVisible";

/**
 * Whether the Posteingang offers the photo-journey tab.
 *
 * The scan produces exactly three readings, and each is NAMED by something a
 * domain owns (`backend/src/shared/photoScan.ts`): a `place` and a `stay`
 * finding are named by one of the account's own Places, a `trip` finding by one
 * of its own, already-flown airports. With neither flights nor places switched
 * on, no burst of photographs can become a row — so the tab could only ever be
 * empty, and the nav states the rule for that case one file over: "an entry
 * leading to a page that explains why it is empty is worse than no entry".
 *
 * Places ask through `usePlacesVisible`, the one home of the places rule,
 * rather than `isEnabled("poi")` directly.
 *
 * Nothing on the backend is gated by this. `/api/v1/photo-journeys` stays
 * reachable for any authenticated caller — the Companion reads the same rows —
 * and rows survive a domain being switched off, exactly as places do.
 */
export function usePhotoJourneysVisible(): boolean {
  const { isEnabled } = useEnabledDomains();
  const placesVisible = usePlacesVisible();
  return isEnabled("flight") || placesVisible;
}
