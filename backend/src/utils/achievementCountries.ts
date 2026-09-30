import { loadVisibleDomains } from "../services/domainVisibility";
import { loadPassport } from "../services/stats/passportLoader";

/**
 * The country set the cross-domain country badges ("N Länder bereist") count
 * from. One rule, one home: the passport's evidence and threshold, read from
 * the curated sources only.
 *
 * Owner decision 2026-09-26: the badges count like the passport, so a country
 * reached only by train or only on a roadtrip counts — while that domain is
 * visible to the user (its beta gate on and the domain switched on), as rail
 * and roadtrips are everywhere else. Before this, the badges took the
 * INTERSECTION of the passport with a flight/cruise/lodging union, and a
 * rail-only country appeared on the passport and in no badge.
 *
 * The rules, each with the reason it exists:
 *
 * 1. **Only curated records earn a badge** (owner, 2026-09-26): a flight, a
 *    stay, a port call, a train ride, a roadtrip station. Never location
 *    history — a Dawarich track day, EvidenceKind `track`. The engine is
 *    monotonic (an unlock is never taken back), and a single stray GPS fix
 *    makes a track day that grades `visited` or `transited`, so one border
 *    outlier would unlock a country badge forever. The passport PAGE still
 *    lists a track-proved country with its tier; only the badges ignore it.
 * 2. **Places stay out**, for the badge's own reason: a badge means "I
 *    travelled there", and a place is a pin — a McDonald's around the corner
 *    must not move a travel badge.
 * 3. **Left out means not read, not filtered afterwards.** The passport is
 *    loaded WITHOUT track and place evidence, so neither proves a country nor
 *    lifts one's tier. Filtering rows by `kinds` instead — the rule until
 *    this change — let a track "slept" or a place "visited" carry a country
 *    that the flights prove only as a `connection` over a threshold that
 *    excludes connections. The tier a badge counts is the curated evidence's
 *    own. A hidden rail or roadtrip domain is left out the same way.
 * 4. **The threshold is the passport's** (`services/countryThresholdResolver.ts`,
 *    spec §3.2): a user reading "32 Länder" on the passport must not be handed
 *    a 50-country badge off a looser set.
 * 5. **The union is the floor.** A country the flight/cruise/lodging union
 *    knows but the curated passport never lists (an unresolvable port name, a
 *    lodging the passport's `visited: true` filter excludes) keeps counting:
 *    it was never measured against the threshold, and abstention is not
 *    exclusion. The union is built from curated records only, so it adds no
 *    track or place country.
 */
export async function achievementCountries(
  userId: string,
  unionFloor: ReadonlySet<string>
): Promise<Set<string>> {
  const visible = new Set(await loadVisibleDomains(userId));
  const passport = await loadPassport(userId, undefined, {
    rail: visible.has("rail"),
    roadtrip: visible.has("roadtrip"),
    place: false,
    track: false,
  });
  const listed = new Set(passport.countries.map((c) => c.code));
  const counted = passport.countries.filter((c) => c.counted).map((c) => c.code);
  const neverMeasured = [...unionFloor].filter((code) => !listed.has(code));
  return new Set([...counted, ...neverMeasured]);
}
