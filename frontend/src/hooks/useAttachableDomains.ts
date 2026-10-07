import { useMemo } from "react";

import { useEnabledDomains } from "./useEnabledDomains";
import { useRailVisible } from "./useRailVisible";
import { useRentalVisible } from "./useRentalVisible";
import { useBusVisible } from "./useBusVisible";
import { ATTACHABLE_DOMAINS } from "../lib/trips/attachableEntries";
import type { DomainKey } from "../shared/domains";

/**
 * The domains whose existing entries a trip may take in — the ones this
 * reader has switched on. Rail, rental and bus ask their own gates, which add the
 * beta switch to the reader's toggle; roadtrips are gated inside
 * `useEnabledDomains` itself.
 */
export function useAttachableDomains(): readonly DomainKey[] {
  const { isEnabled } = useEnabledDomains();
  const railVisible = useRailVisible();
  const rentalVisible = useRentalVisible();
  const busVisible = useBusVisible();
  return useMemo(
    () =>
      ATTACHABLE_DOMAINS.filter((key) =>
        key === "rail"
          ? railVisible
          : key === "rental"
            ? rentalVisible
            : key === "bus"
              ? busVisible
              : isEnabled(key)
      ),
    [isEnabled, railVisible, rentalVisible, busVisible]
  );
}
