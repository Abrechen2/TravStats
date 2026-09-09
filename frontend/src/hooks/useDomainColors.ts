import { useCallback } from "react";

import { useDomainColorStore } from "../store/domainColorStore";
import { type DomainColorMap } from "../lib/domainColor";
import type { DomainKey } from "../shared/domains";

export interface DomainColorsState {
  /** The effective colour per domain. */
  colors: DomainColorMap;
  colorOf: (domain: DomainKey) => string;
}

/**
 * THE per-domain colour accessor. Every surface outside the map reads here.
 *
 * Nothing else may reach for `DOMAINS[key].color` directly any more: that fixed
 * hex is now the DEFAULT rather than the value, and a component that keeps
 * reading it would sit next to one that does not, showing the same domain in
 * two shades on one screen — the exact inconsistency #270 exists to remove.
 *
 * Until 2026-09-09 this hook also asked the beta gate, and handed back the
 * brand set instead of the stored one while the gate was closed — the gate
 * covered the VALUE, not just the settings panel, so that turning it off could
 * not leave an app painted in colours with no control left to change them.
 * The gate is gone: the owner ruled on 2026-09-09 that overriding a domain
 * colour is an ordinary setting for 2.7, reversing the decision of 2026-09-05
 * (design-system round §9, no. 4) that had kept it behind the badge. The store
 * is now the value, always, and `resetToBrand` is the way back.
 */
export function useDomainColors(): DomainColorsState {
  const colors = useDomainColorStore((s) => s.colors);

  const colorOf = useCallback((domain: DomainKey): string => colors[domain], [colors]);

  return { colors, colorOf };
}
