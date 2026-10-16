import { useMemo } from "react";

import { useEnabledDomains } from "./useEnabledDomains";
import { ATTACHABLE_DOMAINS } from "../lib/trips/attachableEntries";
import type { DomainKey } from "../shared/domains";

/**
 * The domains whose existing entries a trip may take in — the ones this
 * reader has switched on, with every beta switch applied (`useEnabledDomains`).
 */
export function useAttachableDomains(): readonly DomainKey[] {
  const { isEnabled } = useEnabledDomains();
  return useMemo(() => ATTACHABLE_DOMAINS.filter((key) => isEnabled(key)), [isEnabled]);
}
