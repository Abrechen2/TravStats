/**
 * Country evidence for the passport and its dependent statistics (forgejo#299).
 * Ground presence includes flown endpoints, transit and curated road stations.
 * Visits require an actual destination, a confirmed place or a non-transit stay.
 * Owner rulings 2026-10-16: a port call is a visit; train, coach and ferry
 * rides count like flights, in one chain with them (`./journeyEvidence.ts`).
 * Raw location observations never prove either set. Planned and cancelled
 * travel is excluded; undated confirmed records remain undated.
 * Each country appears once, with its evidence and uncertainty retained.
 */

import {
  continentForCountry,
  getContinent,
  isoCountryCode,
  type Continent,
} from "../../utils/continents";
import { CONTINENT_GROUPS } from "../../shared/passportContinents";
import {
  DEFAULT_COUNTRY_TIER,
  countCountries,
  daysBetween,
  foldCountryEvidence,
  lodgingEvidence,
  type CountryGroundTime,
  type CountryTier,
  type EvidenceInput,
  type EvidenceKind,
} from "../../shared/countryEvidence";
import { FLOWN, flightDay, flightLegs, isoDayOf, type PassportFlight } from "./flightEvidence";
import { journeyEvidence } from "./journeyEvidence";
import {
  countryAnnotations,
  type CountryVisitSource,
  type PassportUnclearReason,
} from "./countryAnnotations";
import {
  unconfirmedTrackCountries,
  type CountryDayRow,
  type UnconfirmedTrackCountry,
} from "./trackEvidence";
import { localDay } from "../../shared/time/instant";
import { roadtripEvidence, type PassportRoadtripStation } from "./roadtripEvidence";
import { legsOfEnds, type RailEnd } from "./railEvidence";
import type { BusEnd } from "./busEvidence";
import type { FerryEnd } from "./ferryEvidence";
import { countEvidencePerCountry } from "./evidenceCountry";
import { lodgingStampsPerCountry, type LodgingStamp, type StampLodging } from "./lodgingStamp";
import { compareCountryRows, summarizePassport } from "./passportSummary";
import type { CountryOverrideView, ExcludedCountry } from "./countryOverrides";

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
  countryVisitKind?: string;
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
 *
 * `city`, `datePrecision` and `nights` are read by the lodging stamp
 * (`./lodgingStamp.ts`, forgejo#93) and by nothing else here; all three are
 * optional so a caller that proves a country and no more keeps compiling.
 */
export type PassportLodging = StampLodging;

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
  flight: 7,
  port: 6,
  place: 5,
  lodging: 4,
  // A train station: below every older kind, so no country an account
  // without rail already shows changes its label; above a roadtrip station,
  // because a ride is a dated ticket rather than a pin on a route.
  rail: 3,
  // A coach terminal (forgejo#265): beside the station, a step below it.
  bus: 2.5,
  // A ferry port (owner ruling 2026-10-16 #3): beside the coach terminal.
  ferry: 2.4,
  // Below the house, so a country already labelled by its stay keeps that
  // label; above the track, because a station is a record somebody typed and
  // can open, which a country-day is not.
  roadtrip: 2,
  track: 1,
  // The user's own word (forgejo#308): the bottom rung, so a row that has any
  // record keeps that record's label and only a manual-only row wears it.
  manual: 0,
};

/** The strongest kind among several. `kinds` is never empty by construction. */
const strongestKind = (kinds: readonly EvidenceKind[]): PassportEvidence =>
  [...kinds].sort((a, b) => EVIDENCE_RANK[b] - EVIDENCE_RANK[a])[0];

/**
 * The legacy threshold default, kept only so old callers compile: since
 * forgejo#299 the headline is always "Land besucht" and no threshold moves it.
 */
export const PASSPORT_COUNTRY_THRESHOLD: CountryTier = DEFAULT_COUNTRY_TIER;

export type { PassportUnclearReason };

export interface PassportCountry {
  /** "Am Boden gewesen" — every row is, by construction. */
  groundPresence: boolean;
  /** "Land besucht" (forgejo#299). The same value as `counted`. */
  visited: boolean;
  /**
   * Not visited, and the records cannot decide whether it was — shown as
   * "unklar" with `visitUncertainReasons`, never dropped and never upgraded.
   * False for a DECIDED connection (Qatar on MUC->DOH->HAN and back).
   */
  visitUncertain: boolean;
  /** Sorted, distinct; empty unless `visitUncertain`. */
  visitUncertainReasons: PassportUnclearReason[];
  /** Which domains prove the visit, in which years; empty unless `visited`. */
  visitSources: CountryVisitSource[];
  /** ISO-3166 alpha-2. What a client shows — never a flag: flags are political and age. */
  code: string;
  continent: Continent | null;
  /** Flights that began or ended here. See rule 2. */
  entries: number;
  firstYear: number | null;
  firstVisitedYear?: number | null;
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
  /**
   * How much of each OTHER kind of evidence stands behind the row (forgejo#78)
   * — `entries` and `airports` already say it for flights. Counted by the same
   * predicates the drill-down counts with (`./evidenceCountry.ts`), so a row
   * and its page cannot disagree. Plain counts; zero means none recorded.
   */
  portCalls: number;
  places: number;
  /**
   * The lodging stamp (forgejo#93): nights slept here and the town that stands
   * for them. Null when no house proves this country — `kinds` then holds no
   * `lodging` either. See `./lodgingStamp.ts` for what a zero means.
   */
  lodging: LodgingStamp | null;
  /** The user's verdict on this country (forgejo#308); null when there is none. */
  override: CountryOverrideView | null;
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
    groundCountries: number;
    visitedCountries: number;
    /** Ground-presence countries whose visit the records cannot decide. */
    unclearCountries: number;
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
  /** Raw location history, excluded from all country and presence figures. */
  unconfirmedCountries: UnconfirmedTrackCountry[];
  /** Countries the user excluded (forgejo#308): out of every set and total, listed to be undone. */
  excludedCountries: ExcludedCountry[];
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
  _threshold: CountryTier = PASSPORT_COUNTRY_THRESHOLD,
  /** Stored location observations; never proof of ground presence (forgejo#299). */
  trackDays: readonly CountryDayRow[] = [],
  /**
   * Stations of roadtrips that have started, each already reduced to its
   * night, days and country (`./roadtripEvidence.ts`). Before this the Stats
   * overview counted a roadtrip's countries while the passport did not.
   */
  roadtripStations: readonly PassportRoadtripStation[] = [],
  /** Station ends of completed train rides (`./railEvidence.ts`), each with its ride as a leg. */
  railEnds: readonly RailEnd[] = [],
  /**
   * The user's profile zone: "this year" for `isNew` is THEIR year. Stamps are
   * dated on local days, so a UTC year disagreed for the hours between the two
   * New Years — a Tokyo user at 08:00 on 1 January still in the old one.
   */
  profileZone: string = "UTC",
  /** Terminal ends of completed bus rides (`./busEvidence.ts`), while bus is visible. */
  busEnds: readonly BusEnd[] = [],
  /**
   * ISO codes of the countries the user lives or lived in — a home period that
   * has begun (`./passportLoader.ts` `loadHomeCountries`). Living somewhere is
   * the longest stay there is, so a home country with any record counts as
   * visited even when every flight there is a chain end; without this the
   * owner's Germany dropped out of "Land besucht" (forgejo#299 lists it). It
   * never creates a row: a country needs a record to open.
   */
  homeCountries: readonly string[] = [],
  /** Port ends of completed ferry crossings (`./ferryEvidence.ts`), while ferry is visible. */
  ferryEnds: readonly FerryEnd[] = []
): Passport {
  flights = flights.filter((f) => !f.departureTime || f.departureTime <= now);
  placeVisits = placeVisits.filter((v) => !v.at || v.at <= now);
  portCalls = portCalls.filter((v) => !v.at || v.at <= now);
  const thisYear = Number(localDay(now, profileZone).slice(0, 4));
  const home = new Set(homeIatas.map((c) => c.toUpperCase()));
  const homeCountrySet = new Set(
    homeCountries.map((c) => isoCountryCode(c)).filter((c): c is string => c !== null)
  );

  const byCountry = new Map<string, CountryAcc>();
  const firstSeen = new Map<string, { date: string | null; country: string | null }>();

  for (const flight of flights) {
    if (!FLOWN.has(flight.status)) continue;
    // The departure airport's day, the one the spells below are read on — a
    // UTC cut made a Tokyo 07:30 on 1 January a stamp of the year before (forgejo#273).
    const isoDate = flightDay(flight);
    const year = isoDate === null ? null : Number(isoDate.slice(0, 4));

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
      tier: lodging.countryVisitKind === "transit" ? "connection" : proof.tier,
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

  // Flights, trains and coaches as ONE chain (owner ruling 2026-10-16).
  const journeyInputs = journeyEvidence(
    [
      ...flightLegs(flights, countryOfAirport),
      ...legsOfEnds(railEnds),
      ...legsOfEnds(busEnds),
      ...legsOfEnds(ferryEnds),
    ],
    homeCountrySet
  );
  const evidenceInputs: EvidenceInput[] = [
    ...journeyInputs,
    ...portCalls.map((call): EvidenceInput => {
      const from = isoDayOf(call.at);
      const to = isoDayOf(call.until);
      return {
        country: call.country,
        kind: "port",
        // Owner ruling 2026-10-16: "Landgang ist eindeutig ein Besuch". A port
        // call (a port day, never a sea day — sea days carry no port) is a
        // visit; graded `transited` it left a cruise-only account with no
        // visited country at all.
        tier: "visited",
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
      tier: visit.countryVisitKind === "transit" ? "transited" : "visited",
      at: visit.at,
    })),
    ...lodgingInputs,
    // Curated roadtrip stations attest ground travel; raw location points do not.
    ...roadtripEvidence(roadtripStations),
  ];
  const evidence = foldCountryEvidence(evidenceInputs);
  const annotations = countryAnnotations(evidenceInputs);
  const liftedHome = new Set<string>();
  const firstVisitYears = new Map(
    foldCountryEvidence(
      evidenceInputs.filter((input) => input.tier === "visited" || input.tier === "slept")
    ).map((row) => [
      row.code,
      row.firstDate && !row.hasUndatedEvidence ? Number(row.firstDate.slice(0, 4)) : null,
    ])
  );

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

    // Both ends of the evidence widen the country's span. Only `firstDate` was
    // ever read, and only when the row CREATED the accumulator — so a country
    // that already had a row got no year update at all from its evidence. Two
    // track days in Germany, 2020 and 2025, read 2020-2020 in the passport
    // while the country detail correctly read 2020-2025; add a place visit in
    // 2023 and the passport collapsed to 2023-2023 (AUD-086). `countryDetail`
    // has always extended by both ends, which is the contract being matched.
    for (const iso of [row.firstDate, row.lastDate]) {
      if (!iso) continue;
      const year = Number(iso.slice(0, 4));
      if (!Number.isFinite(year)) continue;
      acc.firstYear = acc.firstYear === null ? year : Math.min(acc.firstYear, year);
      acc.lastYear = acc.lastYear === null ? year : Math.max(acc.lastYear, year);
    }

    acc.tier = row.tier;
    acc.kinds = row.kinds;
    acc.hasUndatedEvidence = row.hasUndatedEvidence;
    acc.daysPresent = row.daysPresent;
    acc.groundTime = row.groundTime;
    // Asked through `countCountries` on a one-row list rather than by comparing
    // tiers here, so the ranking that decides the headline lives in exactly one
    // place. A second copy of "which tier outranks which" is the drift the
    // shared module exists to end.
    acc.counted = countCountries([row], "visited") === 1;
    if (homeCountrySet.has(row.code)) {
      acc.isHome = true;
      if (!acc.counted) {
        acc.tier = "visited";
        acc.counted = true;
        liftedHome.add(row.code);
      }
    }
  }

  /**
   * The per-kind figures beside the row (forgejo#78, #93). Derived from the
   * same inputs the fold above read, grouped by the code each record resolves
   * to, and looked up per row — a country the fold raised and these did not
   * simply reports zero and null, which is what it has.
   */
  const evidenceCounts = countEvidencePerCountry(portCalls, placeVisits);
  const lodgingStamps = lodgingStampsPerCountry(lodgings, now);

  // A home country lifted to visited dates from its own earliest record — a
  // real year, never the home setting's.
  const visitedYearOf = (code: string, acc: CountryAcc): number | null =>
    firstVisitYears.get(code) ?? (homeCountrySet.has(code) ? acc.firstYear : null);

  const countries: PassportCountry[] = [...byCountry.entries()]
    .map(([code, acc]) => ({
      code,
      continent: acc.continent,
      entries: acc.entries.size,
      firstYear: acc.firstYear,
      firstVisitedYear: visitedYearOf(code, acc),
      lastYear: acc.lastYear,
      airports: [...acc.airports.entries()]
        .sort(
          (a, b) =>
            (a[1] ?? "9999-99-99").localeCompare(b[1] ?? "9999-99-99") || a[0].localeCompare(b[0])
        )
        .map(([iata]) => iata),
      isHome: acc.isHome,
      isNew: acc.counted && visitedYearOf(code, acc) === thisYear,
      evidence: acc.evidence,
      tier: acc.tier,
      kinds: acc.kinds,
      hasUndatedEvidence: acc.hasUndatedEvidence,
      daysPresent: acc.daysPresent,
      groundTime: acc.groundTime,
      counted: acc.counted,
      groundPresence: true,
      visited: acc.counted,
      visitUncertain: !acc.counted && annotations.unclearReasons(code).length > 0,
      visitUncertainReasons: acc.counted ? [] : annotations.unclearReasons(code),
      visitSources: acc.counted ? annotations.visitSources(code, liftedHome.has(code)) : [],
      portCalls: evidenceCounts.get(code)?.portCalls ?? 0,
      places: evidenceCounts.get(code)?.places ?? 0,
      lodging: lodgingStamps.get(code) ?? null,
      override: null,
    }))
    .sort(compareCountryRows);

  const stamps: PassportStamp[] = [...firstSeen.entries()]
    .map(([iata, seen]) => ({ iata, country: seen.country, date: seen.date }))
    .sort(
      (a, b) =>
        (a.date ?? "9999-99-99").localeCompare(b.date ?? "9999-99-99") ||
        a.iata.localeCompare(b.iata)
    );

  // Flights and airports are untouched by the evidence rules: a house proves a
  // country, it does not add an airport or an entry. `firstSeen` holds one
  // stamp per airport, so the stamps ARE the airport count.
  const { summary, continents } = summarizePassport(countries, stamps.length);
  return {
    summary,
    countries,
    unconfirmedCountries: unconfirmedTrackCountries(trackDays, now),
    excludedCountries: [],
    continents,
    groups: CONTINENT_GROUPS,
    stamps,
  };
}
