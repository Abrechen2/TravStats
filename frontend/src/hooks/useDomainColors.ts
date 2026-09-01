import { useCallback } from "react";

import { useDomainColorStore } from "../store/domainColorStore";
import { useBetaFeatures } from "./useBetaFeatures";
import { BRAND_DOMAIN_COLORS, type DomainColorMap } from "../lib/domainColor";
import type { DomainKey } from "../shared/domains";

export interface DomainColorsState {
  /** The effective colour per domain — brand while the gate is closed. */
  colors: DomainColorMap;
  colorOf: (domain: DomainKey) => string;
  /** Whether the user can change them at all right now. */
  customisable: boolean;
}

/**
 * THE per-domain colour accessor. Every surface outside the map reads here.
 *
 * Nothing else may reach for `DOMAINS[key].color` directly any more: that fixed
 * hex is now the DEFAULT rather than the value, and a component that keeps
 * reading it would sit next to one that does not, showing the same domain in
 * two shades on one screen — the exact inconsistency #270 exists to remove.
 *
 * The gate applies to the VALUE, not just to the settings UI. With the beta
 * flag off, everyone gets the brand set even if a colour is sitting in local
 * storage from a beta instance — otherwise turning the flag off would leave an
 * app painted in colours with no way left to change them.
 */
export function useDomainColors(): DomainColorsState {
  const stored = useDomainColorStore((s) => s.colors);
  const { isFeatureVisible } = useBetaFeatures();
  const customisable = isFeatureVisible("domainColors");

  const colors = customisable ? stored : BRAND_DOMAIN_COLORS;

  const colorOf = useCallback((domain: DomainKey): string => colors[domain], [colors]);

  return { colors, colorOf, customisable };
}
