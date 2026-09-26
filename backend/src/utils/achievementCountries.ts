import { loadVisibleDomains } from "../services/domainVisibility";
import { loadPassport } from "../services/stats/passportLoader";

/**
 * The country set the cross-domain country badges ("N Länder bereist") count
 * from. One rule, one home: the passport's.
 *
 * Owner decision 2026-09-26: the badges count like the passport, so a country
 * reached only by train or only on a roadtrip counts — while that domain is
 * visible to the user (its beta gate on and the domain switched on), as rail
 * and roadtrips are everywhere else. The passport is loaded with exactly those
 * sources, so a hidden domain neither adds a country nor lifts one over the
 * counting threshold. Before this, the badges took the INTERSECTION of the
 * passport with a flight/cruise/lodging union, and a rail-only country
 * appeared on the passport and in no badge.
 *
 * Kept from the earlier rule, deliberately:
 *
 * 1. **The threshold is the passport's** (`services/countryThresholdResolver.ts`,
 *    spec §3.2): a user reading "32 Länder" on the passport must not be handed
 *    a 50-country badge off a looser set.
 * 2. **Places stay out.** A badge means "I travelled there", and a place is a
 *    pin — a McDonald's around the corner must not move a travel badge. A row
 *    the passport proves ONLY by a place is dropped.
 * 3. **The union is the floor.** A country the flight/cruise/lodging union
 *    knows but the passport never lists (an unresolvable port name, a lodging
 *    the passport's `visited: true` filter excludes) keeps counting: it was
 *    never measured against the threshold, and abstention is not exclusion.
 *    The badge engine is monotonic besides — an unlock is never taken back.
 */
export async function achievementCountries(
  userId: string,
  unionFloor: ReadonlySet<string>
): Promise<Set<string>> {
  const visible = new Set(await loadVisibleDomains(userId));
  const passport = await loadPassport(userId, undefined, {
    rail: visible.has("rail"),
    roadtrip: visible.has("roadtrip"),
  });
  const listed = new Set(passport.countries.map((c) => c.code));
  const counted = passport.countries
    .filter((c) => c.counted && c.kinds.some((kind) => kind !== "place"))
    .map((c) => c.code);
  const neverMeasured = [...unionFloor].filter((code) => !listed.has(code));
  return new Set([...counted, ...neverMeasured]);
}
