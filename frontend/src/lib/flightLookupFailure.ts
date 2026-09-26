import type { LookupProviderFailure } from "./api/flightLookup";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/** Provider names as their owners spell them — proper nouns, not copy. */
const PROVIDER_NAMES: Record<LookupProviderFailure["provider"], string> = {
  aviationstack: "Aviationstack",
  aerodatabox: "AeroDataBox",
  airlabs: "AirLabs",
  opensky: "OpenSky",
};

/**
 * One sentence per provider that could not answer, in the reader's language.
 * Shared by the flight form's lookup and the bulk refresh summary, so a
 * refused key reads the same in both places.
 */
export function providerFailureLines(
  failures: readonly LookupProviderFailure[],
  t: Translate
): string[] {
  return failures.map((failure) =>
    t(`errors:providerFailure.${failure.outcome}`, {
      provider: PROVIDER_NAMES[failure.provider] ?? failure.provider,
    })
  );
}
