/**
 * The IANA time zones the settings offer (profile zone, backup zone), grouped
 * for `<optgroup>`s. The list itself is shared/time's `supportedZones()` —
 * this file only shapes it for a picker and holds no zone logic of its own.
 */
import { supportedZones } from "../shared/time";

/** "UTC" has no "/" and belongs in no continent — this is the group it gets. */
export const UNGROUPED_REGION = "UTC";

/**
 * Every offerable zone, with `selected` folded in.
 *
 * A stored zone that the browser does not know must still appear: a `<select>`
 * whose value is not among its options renders as blank, which reads as "no
 * timezone set" while the account has one.
 */
export function listTimeZones(selected?: string | null): string[] {
  const zones = new Set(supportedZones());
  zones.add("UTC");
  if (selected) zones.add(selected);
  return [...zones].sort((a, b) => a.localeCompare(b, "en"));
}

/** The zones grouped by their region prefix, for `<optgroup>`s. */
export function groupTimeZones(selected?: string | null): Array<{
  region: string;
  zones: string[];
}> {
  const groups = new Map<string, string[]>();
  for (const zone of listTimeZones(selected)) {
    const slash = zone.indexOf("/");
    const region = slash === -1 ? UNGROUPED_REGION : zone.slice(0, slash);
    const bucket = groups.get(region);
    if (bucket) bucket.push(zone);
    else groups.set(region, [zone]);
  }
  return [...groups.entries()]
    .map(([region, zones]) => ({ region, zones }))
    .sort((a, b) => a.region.localeCompare(b.region, "en"));
}
