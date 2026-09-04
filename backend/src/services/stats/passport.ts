/**
 * The passport: which countries somebody has been to, when, and through which
 * airports.
 *
 * Derived here rather than in each client. The Companion app draws this screen
 * already and builds it from two raw endpoints; a web page doing the same would
 * be a third copy of the same arithmetic, and the three would drift — which is
 * how one screen ends up saying five continents and another six.
 *
 * SIX RULES, all chosen to agree with figures this server already publishes
 * elsewhere. A passport that contradicts the statistics page is worse than no
 * passport.
 *
 * 1. FLOWN ONLY. A booked flight is not a stamp. The same cut the rest of the
 *    statistics make, and the same one shared/placeCounting.ts makes for places.
 * 2. BOTH ENDS COUNT. A country counts if a flight began OR ended there, which
 *    is how airportStats counts countries. Arrivals only would drop the country
 *    somebody lives in until their first flight home.
 * 3. ONE STAMP PER AIRPORT, dated its first visit. A stamp marks having been
 *    somewhere, not how often; a commuter would otherwise paper over the card
 *    with a single airport.
 * 4. NO FORMATTED TEXT. Dates go out as dates. A month name belongs to the
 *    reader's language, and this server does not know it.
 * 5. EVIDENCE, NOT ONLY FLIGHTS (Forgejo #42, owner's decision 2026-08-31).
 *    A landing proves presence; so does a cruise that called at a port, and so
 *    does a place the user recorded visiting. The Companion already counted
 *    this way ("31 geflogen · 5 per hafen · 2 anders erreicht") while this
 *    server counted flights alone, so one account had two answers to "how many
 *    countries". Each country now carries the STRONGEST evidence behind it, so
 *    that split line comes from one implementation instead of two.
 *
 *    A port or a place joins on its resolved country code and never on free
 *    text — "Deutschland" and "Germany" are one country and only the code knows
 *    that. A place whose country was never resolved contributes NOTHING rather
 *    than a guess: shared/placeCounting.ts makes the same cut for the same
 *    reason.
 * 6. EVIDENCE HAS A STRENGTH, and the strength decides the headline
 *    (docs/superpowers/specs/2026-09-02-country-counting-design.md). Rule 5 said
 *    WHAT proved a country; it did not say how much. Measured on the owner's
 *    account the count was wrong in both directions at once, which is why it
 *    looked plausible: seven countries counted on a connection under five hours,
 *    while three countries reached by car and slept in for a week did not count
 *    at all, because lodging was not evidence here.
 *
 *    Both halves are fixed by reading shared/countryEvidence.ts — the ONE home
 *    of the rule — instead of deriving a second answer beside it:
 *
 *    - a lodging is evidence, joined on `isoCountryCode` and never on the
 *      free-text `country` column. That column holds "Deutschland", "Germany"
 *      and "Schweiz/Suisse/Svizzera/Svizra" in one account, and unioning it with
 *      airport codes is why the achievements reported 88 countries where this
 *      passport reported 32.
 *    - every country carries a `tier` and the `kinds` that produced it, so a
 *      reader can answer "why is this country here". That is not decoration: it
 *      is how a wrongly imported hotel — one house, no stays, geocoded to
 *      Bucharest instead of Slovenia — was found in the owner's own data.
 *    - only `summary.countries` applies a threshold. The LIST always holds every
 *      country with any evidence at all, whatever its tier. A tier is inferred
 *      from what was recorded, and what was recorded is incomplete: Ethiopia
 *      shows 4.7 hours of ground time here and three GPS-measured days in an
 *      independent tracker. The tier is a hint, never a verdict, so nothing may
 *      disappear from the list on the strength of one.
 *
 * 7. MEASURED PRESENCE IS EVIDENCE TOO (spec §8). Rules 5 and 6 count curated
 *    EVENTS — a flight, a cruise, a house — and driving across a border is not
 *    one, which is why Estonia and Lithuania were absent from this passport
 *    while Latvia survived only because there happened to be a house in it.
 *    Location history, reduced to country-days and nothing else, is the
 *    evidence class that answers it, and it brings the `transited` rung with
 *    it: no other source can populate one.
 *
 *    It also brings the obligation §8.3 puts on it. The payload cannot say
 *    whether a fix was measured by GPS or estimated from a photograph, so
 *    nothing here claims to know — `pointCount` is stored as a number and left
 *    to be read. A track proves DAYS, never hours: it bounds no departure.
 *
 * What the FLIGHTS prove — the spells on the ground, their tiers, their days and
 * their measured durations — lives in `./flightEvidence.ts`, and what the
 * TRACKS prove in `./trackEvidence.ts`. Both moved out when this file crossed
 * the 800-line limit; the seam is that this file assembles a card around
 * answers it does not compute.
 */

import {
  continentForCountry,
  getContinent,
  isoCountryCode,
  type Continent,
} from "../../utils/continents";
import { CONTINENT_GROUPS, continentTotals } from "../../shared/passportContinents";
import {
  DEFAULT_COUNTRY_TIER,
  countCountries,
  daysBetween,
  foldCountryEvidence,
  groundTier,
  lodgingEvidence,
  type CountableStay,
  type CountryGroundTime,
  type CountryTier,
  type EvidenceInput,
  type EvidenceKind,
} from "../../shared/countryEvidence";
import {
  FLOWN,
  flightEvidence,
  isoDayOf,
  type PassportFlight,
} from "./flightEvidence";
import { trackEvidence, type CountryDayRow } from "./trackEvidence";

/**
 * Re-exported so every caller and every test keeps importing the passport's
 * input shape from the passport. The type moved when this file crossed the
 * 800-line limit; where it is declared is a fact about the split, not about the
 * API.
 */
export type { PassportFlight };

/** Country per airport code, as the catalogue holds it. */
export type AirportCountries = ReadonlyMap<string, string | null>;

/**
 * A port a SAILED cruise actually called at. Scheduled itineraries are not
 * evidence, the same cut rule 1 makes for flights.
 */
export interface PassportPortCall {
  /** Free text as the port catalogue holds it; resolved here, never trusted raw. */
  country: string | null;
  /** When the ship was there, if known. */
  at: Date | null;
  /**
   * When the ship left again, if known. Only used to tell a call that spanned a
   * night from a day in port — the design's port row. Optional so every
   * existing caller keeps its exact behaviour.
   */
  until?: Date | null;
}

/** A place the user recorded visiting, with its country already resolved. */
export interface PassportPlaceVisit {
  isoCountryCode: string | null;
  at: Date | null;
}

/**
 * A house the user recorded, with the stays that say when.
 *
 * Joined on `isoCountryCode` and NEVER on the free-text `country` column beside
 * it: that column keeps whatever the source wrote, and unioning it with airport
 * codes is the 88-versus-40 failure the design measured.
 *
 * The stays arrive unfiltered, WITH their status — `lodgingEvidence` owns the
 * "does this count" cut, including the two that look like each other's opposite:
 * a house with NO stay counts as one night, while a stay whose check-out is
 * still ahead is a booking and counts for nothing.
 *
 * The status travels because dropping cancelled stays on the way in would turn a
 * house whose only booking fell through into a house with no stay — which
 * counts. A cancellation would then prove a country.
 */
export interface PassportLodging {
  isoCountryCode: string | null;
  stays: readonly CountableStay[];
}

/**
 * What KIND of record put a country in the passport — the same vocabulary
 * `shared/countryEvidence.ts` folds on, so the two cannot drift apart.
 *
 * Ordered: a landing outranks a port call, which outranks a recorded place,
 * which outranks a house, which outranks a track — the order the owner's own
 * split line reads in, and the one a row shows when several kinds apply.
 *
 * Lodging and track join the bottom of that order deliberately. The rank
 * decides which single LABEL a row wears, not how strong the proof is — `tier`
 * answers that now, and a house is the strongest proof there is. Putting either
 * anywhere else would relabel countries whose `evidence` is already correct and
 * move `byEvidence` figures for a reason that has nothing to do with the
 * change. `track` in particular arrives for countries that already have four
 * kinds of evidence, so it takes the bottom rung and nothing a reader has
 * already seen moves.
 */
export type PassportEvidence = EvidenceKind;

const EVIDENCE_RANK: Record<PassportEvidence, number> = {
  flight: 5,
  port: 4,
  place: 3,
  lodging: 2,
  track: 1,
};

/** The strongest kind among several. `kinds` is never empty by construction. */
const strongestKind = (kinds: readonly EvidenceKind[]): PassportEvidence =>
  [...kinds].sort((a, b) => EVIDENCE_RANK[b] - EVIDENCE_RANK[a])[0];

/**
 * The tier `summary.countries` counts from when the caller names none.
 *
 * A connection does not count, everything else does. It stopped being THE
 * threshold on 2026-09-02 (spec §3.2): "does a connection count" is a personal
 * definition, so an admin now sets the instance default and any user may
 * override it — `services/countryThresholdResolver.ts` resolves the pair, and
 * `loadPassport` passes the answer in. This constant is what a caller with no
 * user in hand gets, which is what every unit test in this directory is.
 *
 * It is an alias for the shared default rather than a second copy of the word:
 * two places naming a default is how they start disagreeing about it.
 */
export const PASSPORT_COUNTRY_THRESHOLD: CountryTier = DEFAULT_COUNTRY_TIER;

export interface PassportCountry {
  /** ISO-3166 alpha-2. What a client shows — never a flag: flags are political and age. */
  code: string;
  continent: Continent | null;
  /** Flights that began or ended here. See rule 2. */
  entries: number;
  firstYear: number | null;
  lastYear: number | null;
  /** The airports used here, first visit first. */
  airports: string[];
  /** A home airport of the user's is in this country. */
  isHome: boolean;
  /** First reached in the current calendar year. */
  isNew: boolean;
  /** The strongest KIND of record behind this country. See rule 5. */
  evidence: PassportEvidence;
  /** How strong that evidence is. See rule 6 and shared/countryEvidence.ts. */
  tier: CountryTier;
  /**
   * Every kind that contributed, alphabetical. A tier alone cannot answer "why
   * is this country in my passport", and that question is what found a wrongly
   * geocoded hotel in real data.
   */
  kinds: EvidenceKind[];
  /**
   * At least one contribution carried no date at all — an undated house, a
   * place ticked without a day, a flight with no departure time. Without this
   * a country that can never appear in any year's figures looks like a gap in
   * the data rather than a fact about it.
   */
  hasUndatedEvidence: boolean;
  /**
   * How many distinct calendar days any record places the traveller here, and
   * how long the longest measured spell on the ground was (spec §3.4b).
   *
   * Both stand BESIDE the tier and neither decides it: a duration is shown as
   * evidence, never used as a threshold. They are published so a reader can
   * judge a tier instead of taking it on trust — the same obligation §3.4 puts
   * on the records themselves.
   *
   * `groundTime` has three states because two would lie. A country proved only
   * by a hotel reports `notApplicable`, a country flown to once and never out of
   * reports `unknown`, and neither reports zero. See `CountryGroundTime`.
   *
   * Both figures count only ATTESTED days. A spell between two flights measures
   * the absence of a recorded departure, not presence, so it contributes its two
   * endpoint days and publishes minutes only while it spans at most one night
   * (`shared/countryEvidence.ts`). Without that, this account's home country
   * reported 2200 days present and 5.5 years on the ground — both literally
   * correct, both nonsense. A lodging stay is unaffected and still counts its
   * whole span: nothing about it was inferred.
   */
  daysPresent: number;
  groundTime: CountryGroundTime;
  /**
   * Does this country reach `summary.countries`? A `false` here is the ONLY
   * effect the threshold has: the row itself is always present.
   */
  counted: boolean;
}

export interface PassportStamp {
  iata: string;
  country: string | null;
  /** First visit, ISO date. The client formats it — see rule 4. */
  date: string | null;
}

export interface Passport {
  summary: {
    /**
     * THE HEADLINE. Countries whose evidence reaches `countryThreshold` —
     * every country except the ones proved by a connection alone.
     *
     * Smaller than `countriesTotal`, and that gap is the point: the list stays
     * complete while the number states a rule.
     */
    countries: number;
    /** Every row in `countries`, whatever its tier. What `byEvidence` sums to. */
    countriesTotal: number;
    /**
     * The number the rule BEFORE this feature gave: a country counted when a
     * flown flight touched one of its airports, whichever end. Every user's
     * headline moved when evidence tiers arrived (design §5), and a number
     * that changes without explanation reads as data loss — so the page says
     * "vorher 32, jetzt 35" once, with the real figures. Computed from the
     * rows so it can never drift from the list beside it.
     */
    legacyCountries: number;
    /**
     * Which tier `countries` counts from — the RESOLVED value for this user
     * (their override, else the instance default), not a constant.
     *
     * Published rather than assumed because it is now settable: a client that
     * hard-coded "visited" would explain the number with a rule that is not the
     * one that produced it.
     */
    countryThreshold: CountryTier;
    airports: number;
    entries: number;
    continentsVisited: number;
    continentsTotal: number;
    firstStampYear: number | null;
    newThisYear: number;
    /**
     * Countries per strongest evidence KIND — the source of "31 geflogen · 5
     * per hafen · 2 anders erreicht". Sums to `countriesTotal`, NOT to
     * `countries`: the split describes the whole list, the headline applies a
     * threshold to it.
     */
    byEvidence: Record<PassportEvidence, number>;
    /** Countries per evidence STRENGTH. Also sums to `countriesTotal`. */
    byTier: Record<CountryTier, number>;
  };
  countries: PassportCountry[];
  continents: Array<{ continent: Continent; visited: number; total: number }>;
  /**
   * How the rows are drawn. Presentation only: summary.continentsVisited counts
   * real continents, so reaching Antarctica moves the number even though it
   * shares a row with Africa.
   */
  groups: typeof CONTINENT_GROUPS;
  stamps: PassportStamp[];
}

interface Touch {
  iata: string;
  lat: number;
  lon: number;
}

/** The two ends of a flight, as far as this derivation cares. */
const touchesOf = (f: PassportFlight): Touch[] => {
  const out: Touch[] = [];
  if (f.depIata) out.push({ iata: f.depIata, lat: f.depLat, lon: f.depLon });
  if (f.arrIata) out.push({ iata: f.arrIata, lat: f.arrLat, lon: f.arrLon });
  return out;
};

interface CountryAcc {
  entries: Set<PassportFlight>;
  /** airport code to its earliest known visit date */
  airports: Map<string, string | null>;
  firstYear: number | null;
  lastYear: number | null;
  continent: Continent | null;
  isHome: boolean;
  evidence: PassportEvidence;
  /** Overwritten from the fold, which is the authority on all three. */
  tier: CountryTier;
  kinds: EvidenceKind[];
  hasUndatedEvidence: boolean;
  daysPresent: number;
  groundTime: CountryGroundTime;
  counted: boolean;
}

export function buildPassport(
  flights: readonly PassportFlight[],
  airportCountries: AirportCountries,
  homeIatas: readonly string[] = [],
  now: Date = new Date(),
  /** Optional so every existing caller keeps its exact behaviour. */
  portCalls: readonly PassportPortCall[] = [],
  placeVisits: readonly PassportPlaceVisit[] = [],
  lodgings: readonly PassportLodging[] = [],
  /**
   * Which tier the HEADLINE counts from — the resolved value for this user
   * (`services/countryThresholdResolver.ts`), not a module constant, since
   * 2026-09-02.
   *
   * It reaches exactly two things: `PassportCountry.counted` per row and
   * `summary.countries`. Every row is built and returned whatever it is, and
   * `summary.countriesTotal` does not move — that is the invariant the whole
   * design rests on, because a country wrongly classed as a connection has to
   * stay VISIBLE to be corrected.
   */
  threshold: CountryTier = PASSPORT_COUNTRY_THRESHOLD,
  /**
   * MEASURED presence — the stored country-days of spec §8, which is the one
   * evidence class that can raise a country nobody logged. Everything else in
   * this function is a curated event, and driving across a border is not one.
   *
   * Last in the list and defaulted, like every parameter before it, so an
   * account with no location history — which is most of them — reaches exactly
   * the same code it did before. What a track proves lives in
   * `./trackEvidence.ts`; nothing about it is decided here.
   */
  trackDays: readonly CountryDayRow[] = []
): Passport {
  const thisYear = now.getUTCFullYear();
  const home = new Set(homeIatas.map((c) => c.toUpperCase()));

  const byCountry = new Map<string, CountryAcc>();
  const firstSeen = new Map<string, { date: string | null; country: string | null }>();

  for (const flight of flights) {
    if (!FLOWN.has(flight.status)) continue;
    const year = flight.departureTime ? flight.departureTime.getUTCFullYear() : null;
    const isoDate = flight.departureTime ? flight.departureTime.toISOString().slice(0, 10) : null;

    for (const touch of touchesOf(flight)) {
      const code = touch.iata.toUpperCase();
      const country = isoCountryCode(airportCountries.get(code) ?? null);

      // An airport whose country the catalogue does not know is left out rather
      // than filed somewhere plausible. A wrong country inflates a continent
      // quota and nobody can tell by looking.
      if (!country) continue;

      const seen = firstSeen.get(code);
      if (!seen || (isoDate !== null && (seen.date === null || isoDate < seen.date))) {
        firstSeen.set(code, { date: isoDate, country });
      }

      let acc = byCountry.get(country);
      if (!acc) {
        acc = {
          entries: new Set<PassportFlight>(),
          airports: new Map<string, string | null>(),
          firstYear: null,
          lastYear: null,
          continent: getContinent(touch.lat, touch.lon, country),
          isHome: false,
          evidence: "flight",
          tier: "visited",
          kinds: ["flight"],
          hasUndatedEvidence: false,
          // Overwritten from the fold, which is the authority on both. The
          // seed says "nothing measured yet", never "measured as zero".
          daysPresent: 0,
          groundTime: { state: "notApplicable" },
          counted: true,
        };
        byCountry.set(country, acc);
      }

      // A Set of flights, so a domestic hop counts once for its country.
      acc.entries.add(flight);

      const known = acc.airports.get(code);
      if (known === undefined || (isoDate !== null && (known === null || isoDate < known))) {
        acc.airports.set(code, isoDate);
      }

      if (year !== null) {
        acc.firstYear = acc.firstYear === null ? year : Math.min(acc.firstYear, year);
        acc.lastYear = acc.lastYear === null ? year : Math.max(acc.lastYear, year);
      }
      if (home.has(code)) acc.isHome = true;
      if (EVIDENCE_RANK[acc.evidence] < EVIDENCE_RANK.flight) acc.evidence = "flight";
    }
  }

  /**
   * A country reached without a landing.
   *
   * Deliberately does NOT touch `entries` or `airports`: those count flights and
   * name airports, and a port call is neither. A country proved only this way
   * shows no entries and no airports, which is honest — it is why the row
   * carries its evidence kind at all.
   *
   * `continent` falls back to the country code, since a port call carries no
   * coordinates here. `getContinent` returns null for a transcontinental
   * country rather than guessing, and null is the right answer for one.
   */
  const addNonFlight = (
    country: string | null,
    at: Date | null,
    kind: PassportEvidence
  ): CountryAcc | null => {
    if (!country) return null;
    const year = at ? at.getUTCFullYear() : null;
    let acc = byCountry.get(country);
    if (!acc) {
      acc = {
        entries: new Set<PassportFlight>(),
        airports: new Map<string, string | null>(),
        firstYear: null,
        lastYear: null,
        // Country-only: a port call carries no coordinates here, and
        // `continentForCountry` answers null for a transcontinental country
        // rather than picking a side — which is the right answer for one.
        continent: continentForCountry(country),
        isHome: false,
        evidence: kind,
        tier: "visited",
        kinds: [kind],
        hasUndatedEvidence: false,
        daysPresent: 0,
        groundTime: { state: "notApplicable" },
        counted: true,
      };
      byCountry.set(country, acc);
    }
    if (EVIDENCE_RANK[acc.evidence] < EVIDENCE_RANK[kind]) acc.evidence = kind;
    if (year !== null) {
      acc.firstYear = acc.firstYear === null ? year : Math.min(acc.firstYear, year);
      acc.lastYear = acc.lastYear === null ? year : Math.max(acc.lastYear, year);
    }
    return acc;
  };

  for (const call of portCalls) addNonFlight(isoCountryCode(call.country), call.at, "port");
  // Already resolved by the caller — a place whose country was never resolved
  // contributes nothing rather than a guess.
  for (const visit of placeVisits) {
    addNonFlight(
      visit.isoCountryCode ? visit.isoCountryCode.toUpperCase() : null,
      visit.at,
      "place"
    );
  }

  /**
   * A house is evidence, and until now it was not — which is why a country
   * reached by car and slept in for a week did not appear while a four-hour
   * port call did (spec §1.2).
   *
   * `lodgingEvidence` decides whether and when it counts; nothing about that
   * cut is repeated here. Like a port call it deliberately touches neither
   * `entries` nor `airports`: a country proved only by a house has flown
   * nothing and used no airport, and saying so is the existing honesty of this
   * derivation, not an omission.
   */
  const lodgingInputs: EvidenceInput[] = [];
  for (const lodging of lodgings) {
    const proof = lodgingEvidence(lodging.stays, now);
    if (!proof) continue;
    // Validated rather than upper-cased and trusted: the column is nullable and
    // holds whatever the geocoder wrote, so a value that is not a country must
    // drop out here instead of becoming a row named after itself.
    addNonFlight(isoCountryCode(lodging.isoCountryCode), proof.at, "lodging");
    lodgingInputs.push({
      country: lodging.isoCountryCode,
      kind: "lodging",
      tier: proof.tier,
      at: proof.at,
      // Check-in through check-out, unioned across the house's completed stays
      // — `lodgingEvidence` owns that expansion, because it already owns which
      // stays count. Empty for an undated house, which is the honest answer:
      // it proves the country without proving a day of it.
      days: proof.days,
    });
  }

  /**
   * The one rule, applied once.
   *
   * Flights resolve their country through the SAME `isoCountryCode` call the
   * loop above uses, so the tiers describe exactly the countries this passport
   * already counted — no flight may appear or vanish here for a reason that has
   * nothing to do with tiers. Ports and places pass their country through as
   * they hold it and let the module resolve it, which is strictly more
   * generous: a port catalogued as "Deutschland" resolves in the fold and gets
   * its row created below.
   */
  const countryOfAirport = (iata: string | null): string | null =>
    iata ? isoCountryCode(airportCountries.get(iata.toUpperCase()) ?? null) : null;

  const evidence = foldCountryEvidence([
    ...flightEvidence(flights, countryOfAirport),
    ...portCalls.map((call): EvidenceInput => {
      const from = isoDayOf(call.at);
      const to = isoDayOf(call.until);
      return {
        country: call.country,
        kind: "port",
        // A call that spanned a night is `slept`, a day in port is `visited`.
        // Both times are stored instants and the port catalogue carries no
        // timezone, so they are read as stored rather than pretending to a
        // local clock this derivation does not have.
        tier: from && to ? groundTier(from, to) : "visited",
        at: call.at,
        // The days the ship was alongside. No `groundMinutes`: a port call
        // bounds no departure that this derivation can read, and §3.4b forbids
        // synthesising one for anything but a flight pair.
        days: from ? (to ? daysBetween(from, to) : [from]) : [],
      };
    }),
    ...placeVisits.map((visit): EvidenceInput => ({
      country: visit.isoCountryCode,
      kind: "place",
      tier: "visited",
      at: visit.at,
    })),
    ...lodgingInputs,
    // Measured presence. It creates its OWN rows for countries no curated
    // record mentions — the fold loop below calls `addNonFlight` for any code
    // `byCountry` does not already hold — which is the entire point: Estonia
    // and Lithuania exist in this account only because somebody drove there.
    ...trackEvidence(trackDays),
  ]);

  for (const row of evidence) {
    // A country only the fold could resolve — a free-text port country in a
    // language `isoCountryCode` does not carry. It gets a row rather than being
    // dropped, dated from the evidence itself.
    const acc =
      byCountry.get(row.code) ??
      addNonFlight(
        row.code,
        row.firstDate ? new Date(`${row.firstDate}T00:00:00Z`) : null,
        strongestKind(row.kinds)
      );
    if (!acc) continue;

    acc.tier = row.tier;
    acc.kinds = row.kinds;
    acc.hasUndatedEvidence = row.hasUndatedEvidence;
    acc.daysPresent = row.daysPresent;
    acc.groundTime = row.groundTime;
    // Asked through `countCountries` on a one-row list rather than by comparing
    // tiers here, so the ranking that decides the headline lives in exactly one
    // place. A second copy of "which tier outranks which" is the drift the
    // shared module exists to end.
    acc.counted = countCountries([row], threshold) === 1;
  }

  const countries: PassportCountry[] = [...byCountry.entries()]
    .map(([code, acc]) => ({
      code,
      continent: acc.continent,
      entries: acc.entries.size,
      firstYear: acc.firstYear,
      lastYear: acc.lastYear,
      airports: [...acc.airports.entries()]
        .sort(
          (a, b) =>
            (a[1] ?? "9999-99-99").localeCompare(b[1] ?? "9999-99-99") || a[0].localeCompare(b[0])
        )
        .map(([iata]) => iata),
      isHome: acc.isHome,
      isNew: acc.firstYear === thisYear,
      evidence: acc.evidence,
      tier: acc.tier,
      kinds: acc.kinds,
      hasUndatedEvidence: acc.hasUndatedEvidence,
      daysPresent: acc.daysPresent,
      groundTime: acc.groundTime,
      counted: acc.counted,
    }))
    .sort((a, b) => b.entries - a.entries || a.code.localeCompare(b.code));

  const totals = continentTotals();
  const visitedPerContinent = new Map<Continent, number>();
  for (const row of countries) {
    if (!row.continent) continue;
    visitedPerContinent.set(row.continent, (visitedPerContinent.get(row.continent) ?? 0) + 1);
  }

  const stamps: PassportStamp[] = [...firstSeen.entries()]
    .map(([iata, seen]) => ({ iata, country: seen.country, date: seen.date }))
    .sort(
      (a, b) =>
        (a.date ?? "9999-99-99").localeCompare(b.date ?? "9999-99-99") ||
        a.iata.localeCompare(b.iata)
    );

  const firstYears = countries.map((c) => c.firstYear).filter((y): y is number => y !== null);

  return {
    summary: {
      // Counted from the ROWS, not from the folded list beside them, so the
      // number and the list it belongs to can never answer differently.
      countries: countries.filter((c) => c.counted).length,
      countriesTotal: countries.length,
      legacyCountries: countries.filter((c) => c.airports.length > 0).length,
      // The RESOLVED value, so a client never has to guess which rule produced
      // the number it is showing.
      countryThreshold: threshold,
      // Flights and airports, untouched by any of the above: a house proves a
      // country, it does not add an airport or an entry.
      airports: firstSeen.size,
      entries: countries.reduce((sum, c) => sum + c.entries, 0),
      continentsVisited: visitedPerContinent.size,
      continentsTotal: Object.keys(totals).length,
      firstStampYear: firstYears.length > 0 ? Math.min(...firstYears) : null,
      newThisYear: countries.filter((c) => c.isNew).length,
      byEvidence: {
        flight: countries.filter((c) => c.evidence === "flight").length,
        port: countries.filter((c) => c.evidence === "port").length,
        place: countries.filter((c) => c.evidence === "place").length,
        lodging: countries.filter((c) => c.evidence === "lodging").length,
        track: countries.filter((c) => c.evidence === "track").length,
      },
      byTier: {
        slept: countries.filter((c) => c.tier === "slept").length,
        visited: countries.filter((c) => c.tier === "visited").length,
        transited: countries.filter((c) => c.tier === "transited").length,
        connection: countries.filter((c) => c.tier === "connection").length,
      },
    },
    countries,
    continents: (Object.keys(totals) as Continent[])
      .map((continent) => ({
        continent,
        visited: visitedPerContinent.get(continent) ?? 0,
        total: totals[continent],
      }))
      .sort((a, b) => b.visited - a.visited || a.continent.localeCompare(b.continent)),
    groups: CONTINENT_GROUPS,
    stamps,
  };
}
