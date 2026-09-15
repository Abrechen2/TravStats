/**
 * How an airport is named to a reader.
 *
 * The obvious field is `city`, and it is the wrong one. It is seeded from
 * OurAirports' `municipality`, which is the town the runway physically sits in
 * — not the city the airport serves, and the two differ for exactly the
 * airports people fly to. Measured in the catalogue on 2026-09-13:
 *
 *   MXP   city "Ferno (VA)"                     name "Milan Malpensa International Airport"
 *   BGY   city "Orio al Serio (BG)"             name "Milan Bergamo Airport / Antonio Locatelli Air Base"
 *   CDG   city "Paris (Roissy-en-France, …)"    name "Charles de Gaulle International Airport"
 *   LHR   city "London"                         name "London Heathrow Airport"
 *
 * A tester read "Ferno" in the "next up" strip and reported it (#332). Note
 * that the parenthesis cannot be used to tell the good rows from the bad: CDG
 * and HHN put the served city BEFORE it, MXP and BGY put the municipality
 * there. There is no rule to recover, so `city` is not consulted at all.
 *
 * `municipalityName` would be the right field — AeroDataBox returns the served
 * city — but it is backfilled only as a side effect of a flight lookup, and was
 * null on all 18017 rows when this was written. It is preferred when present
 * and cannot be relied on.
 *
 * So the name comes from the airport's own `name`, minus the words every
 * airport shares. That is never wrong, and it says which airport rather than
 * which city — which is the more useful half anyway, since London has six.
 */

/** Words that carry no information because every row has them. */
const GENERIC_SUFFIX = /\s+(?:international\s+)?(?:airport|airfield|aerodrome)$/i;

/**
 * Dual-use fields are catalogued as "Civil Name / Military Name"
 * (BGY: "Milan Bergamo Airport / Antonio Locatelli Air Base"). The reader wants
 * the first.
 */
const SECOND_NAME = /\s+\/\s+.*$/;

/**
 * A name that is NOTHING but the generic words. Shortening it would leave
 * "International", or nothing at all — both read as missing data rather than as
 * an airport, so such a row is returned untouched.
 */
const GENERIC_ONLY = /^(?:international\s+)?(?:airport|airfield|aerodrome)$/i;

export interface AirportNameSource {
  name?: string | null;
  municipalityName?: string | null;
}

/**
 * A short, human-readable name for an airport, or `null` when the row carries
 * nothing usable — the caller decides whether to fall back to the code. Never
 * returns an empty string, and never invents a city.
 */
export function airportDisplayName(airport: AirportNameSource | undefined | null): string | null {
  const municipality = airport?.municipalityName?.trim();
  if (municipality) return municipality;

  const name = airport?.name?.trim();
  if (!name) return null;

  if (GENERIC_ONLY.test(name)) return name;

  const shortened = name.replace(SECOND_NAME, "").replace(GENERIC_SUFFIX, "").trim();
  return shortened.length > 0 ? shortened : name;
}
