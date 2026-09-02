/**
 * One country, in detail — the drill-down behind a passport row (Forgejo #42).
 *
 * The Companion draws this screen (04a) from the raw flight list in
 * `countryDetailFromFlights`, which is a second implementation of the counting
 * rules `passport.ts` already states. This is the port, and it keeps the same
 * six rules so that a row and its detail page can never disagree:
 *
 * 1. FLOWN ONLY — a booked flight is not a visit.
 * 2. BOTH ENDS COUNT — a flight that began or ended here counts, once, even
 *    when both of its ends are in this country.
 * 3. ONE ENTRY PER FLIGHT — a domestic hop is one visit, not two.
 * 4. NO FORMATTED TEXT — dates go out as dates, the country as its ISO code.
 *    The Companion composes "BER · LH123 · MUC" and localises the country name;
 *    both belong to the reader's language and this server does not know it.
 * 5. EVIDENCE, NOT ONLY FLIGHTS — a port call and a recorded place prove
 *    presence too, which is the decision `passport.ts` rule 5 records.
 * 6. A HOUSE IS EVIDENCE, AND IT MUST BE REACHABLE (spec §3.4, owner's binding
 *    instruction of 2026-09-02: the user must see where a name came from AND be
 *    able to change it). The passport has counted lodging since that day, but
 *    this page did not — so a country proved only by a house answered 404, and
 *    the one screen the whole design was written for opened on nothing.
 *
 *    `Hotel Sport` is the case: one house, no stay, a Google Place ID saying
 *    Bucharest while its address says Otočec in Slovenia. It put a country in
 *    the passport, and finding it took a database session. With the lodging in
 *    this timeline, carrying its id, it takes two clicks.
 *
 * Rules 5 and 6 are the reason this returns a country the user has never flown
 * to. A passport row evidenced by a cruise or a hotel is clickable; answering
 * 404 for it would put the list and the detail page into exactly the
 * disagreement #42 is about. Such a country carries no entries and no
 * airports — it has none — and says so through `evidence`.
 *
 * ## What this page does NOT carry, and why
 *
 * `tier`, `daysPresent` and `groundTime` are on the PASSPORT ROW and not here.
 * They come out of `foldCountryEvidence` fed by `passport.ts`'s ground-segment
 * reading, which needs each flight's local day and its two ends as real
 * instants — neither of which this route resolves. Deriving them from what IS
 * here would produce a second answer to "how strong is this evidence", and a
 * page that graded a country differently from the row it was opened from is
 * precisely the drift #42 was filed about. One derivation, one home.
 *
 * ## Two abstentions, both deliberate
 *
 * `kmFromHome` is NOT here. The Companion leaves it undefined for want of the
 * home-airport history, and this server has that history — but "distance from
 * home" needs somebody to decide which home (the history holds several, with
 * date ranges) and which point in the country it is measured to. Neither has
 * been decided, and a plausible-looking number nobody chose is worse than the
 * dash the screen already renders.
 *
 * A country name is not here either, for rule 4: the client names the code.
 */

import {
  continentForCountry,
  getContinent,
  isoCountryCode,
  type Continent,
} from "../../utils/continents";
import { lodgingEvidence, toCountryCode, type CountableStay } from "../../shared/countryEvidence";
import type { PassportEvidence } from "./passport";

/** The columns the derivation reads. Any flight row is a superset. */
export interface CountryDetailFlight {
  id: string;
  flightNumber: string | null;
  depIata: string | null;
  depLat: number;
  depLon: number;
  arrIata: string | null;
  arrLat: number;
  arrLon: number;
  departureTime: Date | null;
  status: string;
}

/** A port a SAILED cruise called at. Same cut rule 1 makes for flights. */
export interface CountryDetailPortCall {
  cruiseId: string;
  /** As the catalogue holds it — a name, not a sentence. */
  portName: string | null;
  /** Free text; resolved through `isoCountryCode`, never trusted raw. */
  country: string | null;
  at: Date | null;
}

/** A place the user recorded visiting, with its country already resolved. */
export interface CountryDetailPlaceVisit {
  placeId: string;
  name: string;
  isoCountryCode: string | null;
  at: Date | null;
}

/**
 * A house the user recorded, with the stays that say when — the kind this page
 * could not open until 2026-09-02, and the motivating case of the whole design.
 *
 * Joined on `isoCountryCode`, never on the free-text `country` column beside it:
 * that column holds "Deutschland", "Germany" and "Schweiz/Suisse/Svizzera/Svizra"
 * in one account, and unioning it with airport codes is the 88-versus-40 failure
 * the spec measured.
 *
 * The stays arrive UNFILTERED and with their status, because `lodgingEvidence`
 * owns the "does this count" cut — dropping cancelled stays on the way in would
 * turn a house whose only booking fell through into a house with no stay, which
 * counts as a night, so a cancellation would prove a country.
 */
export interface CountryDetailLodging {
  lodgingId: string;
  /** As the user or the parser wrote it. The client links, it does not compose. */
  name: string;
  isoCountryCode: string | null;
  stays: readonly CountableStay[];
}

export interface CountryAirportUse {
  iata: string;
  /** Flights that began or ended here. */
  visits: number;
  /** First visit, ISO date. Null when no dated flight used it. */
  firstDate: string | null;
}

export type CountryTimelineEntry =
  | {
      kind: "flight";
      date: string | null;
      flightId: string;
      flightNumber: string | null;
      depIata: string | null;
      arrIata: string | null;
      /** The end of the leg that lies inside this country. */
      airportIata: string | null;
    }
  | { kind: "port"; date: string | null; cruiseId: string; portName: string | null }
  | { kind: "place"; date: string | null; placeId: string; name: string }
  | { kind: "lodging"; date: string | null; lodgingId: string; name: string };

export interface CountryDetail {
  /** ISO-3166 alpha-2. Never a flag: flags are political and age. */
  code: string;
  continent: Continent | null;
  /** The strongest proof, in the passport's own vocabulary. */
  evidence: PassportEvidence;
  /** A home airport of the user's is in this country. */
  isHome: boolean;
  /** Flights that began or ended here. See rules 2 and 3. */
  entries: number;
  firstYear: number | null;
  lastYear: number | null;
  /** The airports used here, most-used first. The client groups equal counts. */
  airports: CountryAirportUse[];
  /** Port calls of sailed cruises in this country. */
  portCalls: number;
  /** Recorded visits to places in this country. */
  places: number;
  /** Houses in this country whose record proves presence. See rule 6. */
  lodgings: number;
  /**
   * The busiest visited airport that carries coordinates — what a map centres
   * on. Null when none does, so the client drops its globe control rather than
   * opening a sphere somewhere else.
   */
  anchor: { iata: string; lat: number; lon: number } | null;
  /** Newest first, undated last. Raw parts, never composed prose. */
  timeline: CountryTimelineEntry[];
  /** True when `timeline` was cut, so a client can say it shows the latest N. */
  timelineTruncated: boolean;
}

const FLOWN = new Set(["flown", "historical"]);

/**
 * How many timeline rows travel. Generous — a desktop table shows entries,
 * airports and port calls side by side without paging, which is the thing this
 * screen can do that a phone cannot. Bounded all the same: a commuter with two
 * thousand domestic legs would otherwise ship all of them on every open.
 */
export const COUNTRY_TIMELINE_LIMIT = 200;

/** Sorts newest first and puts undated rows last, in both passes. */
const UNDATED_LAST = "0000-00-00";

/**
 * Tie-break inside one day, strongest evidence first — the order the passport
 * ranks a country's proof in, so the two screens read the same way.
 */
const KIND_RANK: Record<CountryTimelineEntry["kind"], number> = {
  flight: 0,
  port: 1,
  place: 2,
  lodging: 3,
};

const isoDay = (at: Date | null): string | null => (at ? at.toISOString().slice(0, 10) : null);

interface AirportAcc {
  visits: number;
  firstDate: string | null;
  lat: number;
  lon: number;
  hasPosition: boolean;
}

/**
 * @param code       the requested country, in any casing or as an English name
 * @param flights    the user's flights; anything not flown is skipped here
 * @param airportCountries  country per airport code, as the catalogue holds it
 * @returns null when nothing at all evidences the country — the route's 404
 */
export function buildCountryDetail(
  code: string,
  flights: readonly CountryDetailFlight[],
  airportCountries: ReadonlyMap<string, string | null>,
  homeIatas: readonly string[] = [],
  portCalls: readonly CountryDetailPortCall[] = [],
  placeVisits: readonly CountryDetailPlaceVisit[] = [],
  lodgings: readonly CountryDetailLodging[] = [],
  timelineLimit: number = COUNTRY_TIMELINE_LIMIT
): CountryDetail | null {
  const wanted = isoCountryCode(code);
  if (!wanted) return null;

  const home = new Set(homeIatas.map((iata) => iata.toUpperCase()));
  const airports = new Map<string, AirportAcc>();
  const timeline: CountryTimelineEntry[] = [];

  let entries = 0;
  let firstYear: number | null = null;
  let lastYear: number | null = null;
  let continent: Continent | null = null;
  let isHome = false;

  const stretchYears = (at: Date | null): void => {
    if (!at) return;
    const year = at.getUTCFullYear();
    firstYear = firstYear === null ? year : Math.min(firstYear, year);
    lastYear = lastYear === null ? year : Math.max(lastYear, year);
  };

  for (const flight of flights) {
    if (!FLOWN.has(flight.status)) continue;

    const dep = flight.depIata ? flight.depIata.toUpperCase() : null;
    const arr = flight.arrIata ? flight.arrIata.toUpperCase() : null;
    const depHere = dep !== null && isoCountryCode(airportCountries.get(dep) ?? null) === wanted;
    const arrHere = arr !== null && isoCountryCode(airportCountries.get(arr) ?? null) === wanted;
    if (!depHere && !arrHere) continue;

    const date = isoDay(flight.departureTime);

    // Rule 3: one entry per flight, so a domestic leg does not count twice.
    entries += 1;
    stretchYears(flight.departureTime);

    const touch = (iata: string, lat: number, lon: number): void => {
      const acc = airports.get(iata) ?? {
        visits: 0,
        firstDate: null,
        lat,
        lon,
        hasPosition: Number.isFinite(lat) && Number.isFinite(lon),
      };
      acc.visits += 1;
      if (date !== null && (acc.firstDate === null || date < acc.firstDate)) acc.firstDate = date;
      airports.set(iata, acc);
      if (home.has(iata)) isHome = true;
      // The country decides the continent; the coordinates only settle a
      // transcontinental one, which is why they are passed at all.
      continent ??= getContinent(lat, lon, wanted);
    };

    if (depHere && dep !== null) touch(dep, flight.depLat, flight.depLon);
    if (arrHere && arr !== null) touch(arr, flight.arrLat, flight.arrLon);

    timeline.push({
      kind: "flight",
      date,
      flightId: flight.id,
      flightNumber: flight.flightNumber,
      depIata: dep,
      arrIata: arr,
      // The end of the leg inside this country. A domestic leg names the
      // arrival, which is where the journey put the traveller.
      airportIata: arrHere ? arr : dep,
    });
  }

  let portCallCount = 0;
  for (const call of portCalls) {
    // `toCountryCode`, not `isoCountryCode`: the port catalogue's country is free
    // text, and the passport folds it through both resolvers. Resolving it with
    // the English-only table alone made a port stored as "Deutschland" count
    // toward the country row and then vanish from that row's drill-down — the
    // panel denying the evidence the row claimed.
    if (toCountryCode(call.country) !== wanted) continue;
    portCallCount += 1;
    stretchYears(call.at);
    timeline.push({
      kind: "port",
      date: isoDay(call.at),
      cruiseId: call.cruiseId,
      portName: call.portName,
    });
  }

  let placeCount = 0;
  for (const visit of placeVisits) {
    // Already resolved by the caller; a place whose country was never resolved
    // contributes nothing rather than a guess, as shared/placeCounting.ts does.
    if (!visit.isoCountryCode || visit.isoCountryCode.toUpperCase() !== wanted) continue;
    placeCount += 1;
    stretchYears(visit.at);
    timeline.push({
      kind: "place",
      date: isoDay(visit.at),
      placeId: visit.placeId,
      name: visit.name,
    });
  }

  /**
   * A house is evidence, and the passport has graded one `slept` since
   * 2026-09-02 — but this page did not know about lodging at all, so a country
   * proved ONLY by a house answered 404 and the drill-down for the single most
   * important case was empty by construction. Czechia, Italy and Slovenia in
   * the owner's account are exactly that shape.
   *
   * `lodgingEvidence` decides whether and when a house counts; nothing about
   * that cut is repeated here, and the same call in `passport.ts` is why a row
   * and its page cannot disagree about which houses proved a country.
   *
   * Like a port call it touches neither `entries` nor `airports`: a country
   * proved only by a house has flown nothing and used no airport, and saying so
   * is the existing honesty of this derivation rather than an omission.
   */
  let lodgingCount = 0;
  for (const lodging of lodgings) {
    if (!lodging.isoCountryCode || isoCountryCode(lodging.isoCountryCode) !== wanted) continue;
    const proof = lodgingEvidence(lodging.stays);
    if (!proof) continue;
    lodgingCount += 1;
    stretchYears(proof.at);
    timeline.push({
      kind: "lodging",
      date: isoDay(proof.at),
      lodgingId: lodging.lodgingId,
      name: lodging.name,
    });
  }

  if (entries === 0 && portCallCount === 0 && placeCount === 0 && lodgingCount === 0) return null;

  // A country reached without a landing has no airport to take a continent
  // from. `continentForCountry` answers null for a transcontinental one rather
  // than picking a side, which is the right answer for one.
  continent ??= continentForCountry(wanted);

  const ranked = [...airports.entries()].sort(
    (a, b) => b[1].visits - a[1].visits || a[0].localeCompare(b[0])
  );
  const anchored = ranked.find(([, acc]) => acc.hasPosition);

  const ordered = [...timeline].sort(
    (a, b) =>
      (b.date ?? UNDATED_LAST).localeCompare(a.date ?? UNDATED_LAST) ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind]
  );

  // The strongest KIND, in the order `passport.ts` ranks them: a landing
  // outranks a port call, which outranks a recorded place, which outranks a
  // house. The rank decides which single LABEL the page wears, not how strong
  // the proof is — that is the passport row's `tier`.
  const evidence: PassportEvidence =
    entries > 0 ? "flight" : portCallCount > 0 ? "port" : placeCount > 0 ? "place" : "lodging";

  return {
    code: wanted,
    continent,
    evidence,
    isHome,
    entries,
    firstYear,
    lastYear,
    airports: ranked.map(([iata, acc]) => ({
      iata,
      visits: acc.visits,
      firstDate: acc.firstDate,
    })),
    portCalls: portCallCount,
    places: placeCount,
    lodgings: lodgingCount,
    anchor: anchored ? { iata: anchored[0], lat: anchored[1].lat, lon: anchored[1].lon } : null,
    timeline: ordered.slice(0, timelineLimit),
    timelineTruncated: ordered.length > timelineLimit,
  };
}
