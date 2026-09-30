/**
 * The IANA zones this runtime knows — WEB-ONLY (the server resolves zones from
 * places, it never offers a list).
 *
 * Until #318 the settings offered a literal list of six zones, so a user
 * outside Berlin, Paris, New York, Los Angeles or Singapore had no way to say
 * where they are. `Intl.supportedValuesOf("timeZone")` is the browser's own
 * copy of the IANA database — the same source every formatter here trusts —
 * so the list is complete and ages with the browser rather than with a file.
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

export function supportedZones(): string[] {
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
