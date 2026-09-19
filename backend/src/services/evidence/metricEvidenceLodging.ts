import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceEntry, EvidenceResponse } from "../../schemas/evidence";
import { classifyStay, type LodgingCountState } from "../../shared/lodgingCounting";
import { classifyLodging } from "../../shared/lodgingCounting";
import { resolveStayTiming, type StayTiming } from "../../shared/lodgingTiming";
import { lodgingSpendNothingConverted } from "../../shared/lodgingSpendConverted";
import {
  calculateLodgingStats,
  type LodgingStats,
  type LodgingStayData,
} from "../../utils/lodgingStats";
import { bucketNights, walkNights } from "../../utils/lodgingStats/nights";
import { continentForCoordinates, continentForCountry } from "../../utils/continents";
import {
  loadLodgingStatsData,
  type LodgingHouseRow,
  type LodgingStayRow,
} from "../stats/lodgingStatsData";
import type { PagingParams } from "./paging";
import { stayEvidenceEntry } from "./entryMappersDomains";
import { domainDistinctEvidence, domainSumEvidence, readYearScope } from "./domainMeasureResponse";

/**
 * The ten served lodging-tab measures (task 7b-3).
 *
 * `measure.value` is always `calculateLodgingStats`'s own figure — the same
 * call `GET /stats/lodging` makes, over the same rows from the same loader.
 * What this file adds is the per-row split the rollup never needed, and it
 * takes every rule for that from the module that owns it rather than
 * restating one: `shared/lodgingCounting.ts` decides whether a stay counted
 * (owner rule: not until check-out is past), `shared/lodgingTiming.ts` what
 * its dates are good for, `lodgingStats/nights.ts` how many nights that makes,
 * `utils/continents.ts` where it happened, and
 * `shared/lodgingSpendConverted.ts` whether the money total is a real one.
 *
 * TWO DELIBERATE DEPARTURES FROM "ABSTAIN RATHER THAN SAY ZERO", both for the
 * same reason and both visible to the reader instead of hidden in a bucket. A
 * stay whose LENGTH is unknown (`nightsKnown === false`) and a stay whose
 * PRICE nothing could convert stay in the entry list contributing 0, with a
 * subtitle saying which. They are not moved to `unattributed`, because that
 * bucket counts UNITS OF THE MEASURE — nights, or base-currency money — and
 * nobody knows how many nights an undated stay was or what an unconvertible
 * price is worth in euros. A count of STAYS put there would be added to a
 * total of NIGHTS by `assertSumInvariant`, which is a wrong number rather
 * than an honest silence. The calculator itself adds 0 for both, so the panel
 * and the tile agree; the subtitle is what keeps the zero from reading as a
 * fact.
 */

interface ScopedLodging {
  stats: LodgingStats;
  stays: StayView[];
  houses: LodgingHouseRow[];
  /** Lodging id → the state of each of its stays, for `classifyLodging`. */
  statesByLodgingId: Map<string, LodgingCountState[]>;
  baseCurrency: string;
}

/** One stay with everything a measure reads, resolved once. */
interface StayView {
  id: string;
  data: LodgingStayData;
  state: LodgingCountState;
  timing: StayTiming;
  nights: number;
}

/**
 * `calculateLodgingStats` classifies and times every stay up front so that
 * "counts as visited" cannot mean two things in one file. This does the same,
 * through the same two modules and the same night walk, so the split below
 * cannot mean something else than the total it is splitting.
 */
function viewOf(row: LodgingStayRow): StayView {
  const state = classifyStay({
    status: row.stay.status,
    checkIn: row.stay.checkIn,
    checkOut: row.stay.checkOut,
  });
  const timing = resolveStayTiming(row.stay);
  // Throwaway accumulators: the year/month series belongs to the rollup, and
  // this only wants the count — the same call the calculator makes for its
  // planned nights.
  const nights = timing.walkable
    ? walkNights(row.stay.checkIn!, row.stay.checkOut!, {}, {})
    : bucketNights(timing, {}, {});
  return { id: row.id, data: row.stay, state, timing, nights };
}

async function loadScoped(
  userId: string,
  scope: EvidenceScope,
  key: string
): Promise<ScopedLodging> {
  const year = readYearScope(scope, key);
  const data = await loadLodgingStatsData(userId, year);
  const stays = data.rows.map(viewOf);
  const statesByLodgingId = new Map<string, LodgingCountState[]>();
  for (const stay of stays) {
    const bucket = statesByLodgingId.get(stay.data.lodgingId);
    if (bucket) bucket.push(stay.state);
    else statesByLodgingId.set(stay.data.lodgingId, [stay.state]);
  }
  return {
    stats: calculateLodgingStats(data.stays, data.baseCurrency, data.lodgingRecords),
    stays,
    houses: data.houses,
    statesByLodgingId,
    baseCurrency: data.baseCurrency,
  };
}

/** The stays that feed every actual figure — the calculator's `activeStays`. */
function visited(stays: StayView[]): StayView[] {
  return stays.filter((s) => s.state === "visited");
}

function entryOf(
  stay: StayView,
  fields: Partial<Pick<EvidenceEntry, "contribution" | "credits" | "subtitle">>
): EvidenceEntry {
  return stayEvidenceEntry(
    {
      id: stay.id,
      lodgingId: stay.data.lodgingId,
      lodgingName: stay.data.lodgingName,
      checkIn: stay.data.checkIn,
    },
    { ...fields, subtitle: fields.subtitle ?? null }
  );
}

/** One row each — `staysCount` is the size of the visited set. */
export async function resolveLodgingStaysCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "lodgingStaysCount";
  const { stats, stays } = await loadScoped(userId, scope, key);
  const entries = visited(stays).map((stay) => entryOf(stay, { contribution: 1 }));
  return domainSumEvidence({ key, unit: "stays", scope, page, entries, value: stats.staysCount });
}

/**
 * Nights, as the rollup counts them: walked day by day where both dates are
 * real, taken from the explicit field otherwise. A stay whose length nobody
 * recorded contributes 0 and says so — see the file header for why that is
 * not `unattributed`.
 */
export async function resolveLodgingNightsTotal(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "lodgingNightsTotal";
  const { stats, stays } = await loadScoped(userId, scope, key);
  const entries = visited(stays).map((stay) =>
    entryOf(stay, {
      contribution: stay.nights,
      subtitle: stay.timing.nightsKnown ? null : { key: "evidence.subtitle.nightsUnknown" },
    })
  );
  return domainSumEvidence({ key, unit: "nights", scope, page, entries, value: stats.totalNights });
}

/**
 * What the stays cost in the account's CURRENT base currency.
 *
 * A snapshot taken under a base currency the user has since moved away from
 * counts as no snapshot at all: the stored number is real, but it is real in a
 * currency this sum is not being computed in, and adding it would be the
 * defect the snapshot exists to prevent. The rollup makes the same split —
 * `spendBaseByCurrency` is keyed by the snapshot's own currency and
 * `spendBaseTotal` reads only the current one's bucket.
 *
 * `value` is null when the total is a zero nobody paid, which is the same
 * question the tile asks through `lodgingSpendNothingConverted` before drawing
 * "—". A 0 that somebody really paid — an award stay — is a figure, not an
 * absence, and stays a 0.
 *
 * The one case the tile cannot answer for is an account with no stay at all:
 * `LodgingStatsSection` returns its empty state before the strip is drawn, so
 * there is no "—" to mirror. 0 is then the truer answer — nothing was recorded,
 * so nothing was spent — and it also keeps a `{count: 0}` bucket off the wire,
 * which would satisfy `requireReasonForNull` while explaining nothing.
 */
export async function resolveLodgingSpendTotal(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "lodgingSpendTotal";
  const { stats, stays, baseCurrency } = await loadScoped(userId, scope, key);
  const priced = visited(stays).filter(
    (stay) => stay.data.totalPrice !== null || stay.data.totalPriceBase !== null
  );
  const baseOf = (stay: StayView): number | null =>
    stay.data.totalPriceBase !== null && stay.data.fxBaseCurrency === baseCurrency
      ? stay.data.totalPriceBase
      : null;

  const entries = priced.map((stay) => {
    const base = baseOf(stay);
    return entryOf(stay, {
      contribution: base ?? 0,
      subtitle:
        base === null && stay.data.totalPrice !== null
          ? {
              key: "evidence.subtitle.notConverted",
              values: { amount: stay.data.totalPrice, currency: stay.data.currency ?? "EUR" },
            }
          : null,
    });
  });

  // Every stay that counted and gave the total nothing — unconvertible, or
  // never priced at all. It is what the abstention has to EXPLAIN, and it is
  // deliberately wider than `spendUnconvertedStays`, which counts only stays
  // that HAVE a price: an account whose stays carry no prices at all has an
  // unconverted count of 0, and a `{count: 0}` bucket explains nothing while
  // still satisfying `requireReasonForNull`.
  const contributing = priced.filter((stay) => baseOf(stay) !== null);
  const explained = visited(stays).length - contributing.length;
  const abstains = lodgingSpendNothingConverted(stats) && explained > 0;
  return domainSumEvidence({
    key,
    unit: "currency",
    scope,
    page,
    entries,
    value: abstains ? null : stats.spendBaseTotal,
    round: (n) => Math.round(n * 100) / 100,
    // As `businessTotalCost` does for the same case: none of the three closed
    // reasons names "priced, but nothing reached the base currency" exactly,
    // and `notPerEntry` is the nearest fit rather than a silent pick.
    unattributed: abstains ? [{ count: explained, reason: "notPerEntry" }] : [],
  });
}

/** Nights slept on points. Only an award stay is evidence; the rest gave none. */
export async function resolveLodgingAwardNightsCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "lodgingAwardNightsCount";
  const { stats, stays } = await loadScoped(userId, scope, key);
  const entries = visited(stays)
    .filter((stay) => stay.data.isAwardStay)
    .map((stay) => entryOf(stay, { contribution: stay.nights }));
  return domainSumEvidence({ key, unit: "nights", scope, page, entries, value: stats.awardNights });
}

/**
 * Distinct DATES away from home — a union, not a sum, which is why the
 * registry entry was corrected to `distinct` in task 7b-3.
 * `computeRhythmStats` walks the set of dates rather than the stays precisely
 * so that two stays which touch make one continuous run and two that overlap
 * do not count a night twice; adding per-stay nights instead is
 * `walkableNights`, which the same module reports separately so the
 * difference can be shown as the double booking it is.
 *
 * Only a stay with two real DAY-precision dates names days at all. A stay
 * known to the month has nights but no position on a calendar, so it credits
 * nothing here while still counting in `lodgingNightsTotal`.
 */
export async function resolveLodgingNightsAwayTotal(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "lodgingNightsAwayTotal";
  const { stats, stays } = await loadScoped(userId, scope, key);
  const entries = visited(stays).map((stay) => entryOf(stay, { credits: nightDaysOf(stay) }));
  return domainDistinctEvidence({
    key,
    unit: "nights",
    scope,
    page,
    entries,
    value: stats.rhythm.nightsAway,
  });
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The calendar dates this stay was away, as `YYYY-MM-DD` — the key
 * `computeRhythmStats` puts in its set, walked the same way (UTC midnight,
 * check-out day excluded, because a night belongs to the date it starts on).
 */
function nightDaysOf(stay: StayView): string[] {
  const { checkIn, checkOut } = stay.data;
  if (!stay.timing.walkable || checkIn === null || checkOut === null) return [];
  const days: string[] = [];
  let cursor = Date.UTC(checkIn.getUTCFullYear(), checkIn.getUTCMonth(), checkIn.getUTCDate());
  const end = Date.UTC(checkOut.getUTCFullYear(), checkOut.getUTCMonth(), checkOut.getUTCDate());
  while (cursor < end) {
    days.push(new Date(cursor).toISOString().slice(0, 10));
    cursor += DAY_MS;
  }
  return days;
}

/** A stay of exactly one night. Zero-night and undated stays are not one. */
export async function resolveLodgingOneNightStayCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "lodgingOneNightStayCount";
  const { stats, stays } = await loadScoped(userId, scope, key);
  const entries = visited(stays)
    .filter((stay) => stay.nights === 1)
    .map((stay) => entryOf(stay, { contribution: 1 }));
  return domainSumEvidence({
    key,
    unit: "stays",
    scope,
    page,
    entries,
    value: stats.oneNightStays,
  });
}

/**
 * A perfect stay is FOUR fives, not one: overall, room, breakfast and service
 * all at 5, with the overall rating present. A stay rated 5 overall and left
 * blank elsewhere is not perfect — that is the calculator's rule and the whole
 * reason this figure is smaller than a count of five-star ratings.
 */
export async function resolveLodgingPerfectStayCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "lodgingPerfectStayCount";
  const { stats, stays } = await loadScoped(userId, scope, key);
  const entries = visited(stays)
    .filter(
      (stay) =>
        stay.data.ratingOverall === 5 &&
        stay.data.ratingRoom === 5 &&
        stay.data.ratingBreakfast === 5 &&
        stay.data.ratingService === 5
    )
    .map((stay) => entryOf(stay, { contribution: 1 }));
  return domainSumEvidence({
    key,
    unit: "stays",
    scope,
    page,
    entries,
    value: stats.perfectStays,
  });
}

/**
 * Houses, not stays — which is why these entries are lodgings. The count
 * includes a house entered by hand with NO stay recorded (owner decision,
 * 2026-09-02: somebody took the trouble to enter it, so they were there) and
 * excludes one whose every stay was cancelled. Three stays at the same hotel
 * are one lodging, which is what makes this `distinct`.
 */
export async function resolveLodgingsUniqueCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "lodgingsUniqueCount";
  const { stats, stays, houses, statesByLodgingId } = await loadScoped(userId, scope, key);
  const entries = houses
    .filter(
      (house) => classifyLodging(house.record, statesByLodgingId.get(house.id) ?? []) === "visited"
    )
    // The credit is the house's own id — two hotels of the same name are two
    // lodgings — and the id is a UUID, so the name travels beside it. The
    // panel read "belegt: ea41c04e-…" until 2026-09-19.
    .map((house) =>
      houseEntryOf(house, stays, {
        credits: [house.id],
        creditLabels: { [house.id]: house.name },
      })
    );
  return domainDistinctEvidence({
    key,
    unit: "lodgings",
    scope,
    page,
    entries,
    value: stats.lodgingsCount,
  });
}

/**
 * Countries, by the KEY `lodgingCountryKey` resolves: the stored ISO code
 * where there is one, the code the text resolves to otherwise, and the raw
 * text itself when nothing places it — "Dubai" is a city, and a row that names
 * no country is a finding worth seeing rather than one to drop. The tile
 * counts `countries.size` over exactly those keys, so this credits them
 * unfolded. Folding again here would key the panel's buckets differently from
 * the tile's, which is a second opinion about what a country is.
 *
 * The rollup's country set has TWO sources and this credits both: every stay
 * that counted, and every house classified visited. They usually coincide, and
 * the case where they do not is a house the user marked NOT visited that has a
 * completed stay — the stay's country counts, the house's does not.
 */
export async function resolveLodgingCountriesCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "lodgingCountriesCount";
  const { stats, stays, houses, statesByLodgingId } = await loadScoped(userId, scope, key);
  const proving = new Set<string>();
  for (const stay of visited(stays)) proving.add(stay.data.lodgingId);
  for (const house of houses) {
    if (classifyLodging(house.record, statesByLodgingId.get(house.id) ?? []) === "visited") {
      proving.add(house.id);
    }
  }
  const entries = houses
    .filter((house) => proving.has(house.id))
    .map((house) =>
      houseEntryOf(house, stays, { credits: house.record.country ? [house.record.country] : [] })
    );
  return domainDistinctEvidence({
    key,
    unit: "countries",
    scope,
    page,
    entries,
    value: stats.countriesCount,
  });
}

/**
 * Continents, resolved per STAY the way `computeGeoStats` does: the country
 * first, because that answer is exact, and the coordinate boxes only as a
 * fallback so a missing country never silently drops a continent. A stay that
 * can be placed by neither credits nothing and stays in the list.
 */
export async function resolveLodgingContinentsCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  const key = "lodgingContinentsCount";
  const { stats, stays } = await loadScoped(userId, scope, key);
  const entries = visited(stays).map((stay) => {
    const { country, lat, lon } = stay.data;
    const continent =
      continentForCountry(country, lat ?? undefined, lon ?? undefined) ??
      (lat !== null && lon !== null ? continentForCoordinates(lat, lon) : null);
    return entryOf(stay, { credits: continent ? [continent] : [] });
  });
  return domainDistinctEvidence({
    key,
    unit: "continents",
    scope,
    page,
    entries,
    value: stats.geo.continentsCount,
  });
}

/**
 * A house as evidence. It has no date of its own — only a stay does — so the
 * newest stay that counted places it in time. That is an ORDERING choice, not
 * a claim about the house: the panel sorts by date, and a list of hotels in id
 * order tells the reader nothing.
 */
function houseEntryOf(
  house: LodgingHouseRow,
  stays: StayView[],
  fields: Partial<Pick<EvidenceEntry, "contribution" | "credits" | "creditLabels">>
): EvidenceEntry {
  let newest: Date | null = null;
  for (const stay of stays) {
    if (stay.data.lodgingId !== house.id || stay.state !== "visited") continue;
    const at = stay.data.checkIn;
    if (at !== null && (newest === null || at > newest)) newest = at;
  }
  return {
    domain: "lodging",
    id: house.id,
    href: `/lodging/${house.id}`,
    title: { text: house.name },
    subtitle: null,
    date: newest ? { value: newest.toISOString().slice(0, 10), precision: "day" } : null,
    ...fields,
  };
}
