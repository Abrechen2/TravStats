import { useMemo } from "react";

import { useEnabledDomains } from "./useEnabledDomains";
import { useRailVisible } from "./useRailVisible";
import { useRentalVisible } from "./useRentalVisible";
import { ATTACHABLE_DOMAINS } from "../lib/trips/attachableEntries";
import type { DomainKey } from "../shared/domains";

/**
 * The domains whose existing entries a trip may take in — the ones this
 * reader has switched on. Rail and rental ask their own gates, which add the
 * beta switch to the reader's toggle; roadtrips are gated inside
 * `useEnabledDomains` itself.
 */
export function useAttachableDomains(): readonly DomainKey[] {
  const { isEnabled } = useEnabledDomains();
  const railVisible = useRailVisible();
  const rentalVisible = useRentalVisible();
  return useMemo(
    () =>
      ATTACHABLE_DOMAINS.filter((key) =>
        key === "rail" ? railVisible : key === "rental" ? rentalVisible : isEnabled(key)
      ),
    [isEnabled, railVisible, rentalVisible]
  );
}
