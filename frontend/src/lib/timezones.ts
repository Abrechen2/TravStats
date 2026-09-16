/**
 * The IANA time zones the display settings offer.
 *
 * Until #318 this was a literal list of six zones, so a user outside Berlin,
 * Paris, New York, Los Angeles or Singapore had no way to say where they are.
 * `Intl.supportedValuesOf("timeZone")` is the browser's own copy of the IANA
 * database — the same source the formatting code already trusts — so the list
 * is complete and ages with the browser rather than with this file.
 *
 * `supportedValuesOf` is ES2022 and missing in older engines; the six literals
 * survive as the fallback, which is exactly what the settings offered before.
 */

const FALLBACK_ZONES = [
  "UTC",
  "Europe/Berlin",
  "Europe/Paris",
  "America/New_York",
  "America/Los_Angeles",
  "Asia/Singapore",
] as const;

/** "UTC" has no "/" and belongs in no continent — this is the group it gets. */
export const UNGROUPED_REGION = "UTC";

function supportedZones(): string[] {
  const intl = Intl as typeof Intl & {
    supportedValuesOf?: (key: string) => string[];
  };
  try {
    const zones = intl.supportedValuesOf?.("timeZone");
    if (zones && zones.length > 0) return zones;
  } catch {
    // A runtime that throws on the call is a runtime without the list.
  }
  return [...FALLBACK_ZONES];
}

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
