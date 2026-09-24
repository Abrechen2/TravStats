import type { DomainKey } from "../../shared/domains";
import type { IconName } from "./Icon";

/**
 * The line icon of each area, where a tab or a chip names it. `DOMAINS[k].icon`
 * is an emoji — right for a toast, wrong in a tab bar beside line icons, which
 * is what round 4 draws in the logbook and the statistics tabs alike.
 */
export const DOMAIN_ICON: Record<DomainKey, IconName> = {
  flight: "plane",
  cruise: "ship",
  lodging: "bed",
  poi: "map-pin",
  roadtrip: "caravan",
};
