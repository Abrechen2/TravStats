import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceEntry, EvidenceResponse } from "../../schemas/evidence";
import type { PagingParams } from "./paging";
import { requireAllTime } from "./flightMeasureResponse";
import { flightEvidenceEntry } from "./entryMappers";
import {
  cruiseEvidenceEntry,
  pageSumEntries,
  stayEvidenceEntry,
  tripEvidenceEntry,
} from "./entryMappersDomains";
import { loadTravelAccountData, type TravelAccountData } from "../stats/travelAccountData";
import {
  attributeTravelNights,
  buildTravelAccount,
  type AttributedNight,
  type NightSource,
} from "../stats/travelAccount";
import { buildTripAccount } from "../stats/tripAccount";

/**
 * The nine served `TravelAccountSection` measures (task-7b-2-brief.md), all
 * of them `sum` and all of them all-time.
 *
 * Every one answers from `GET /stats/travel-account`'s OWN calculators —
 * `attributeTravelNights` for the night buckets, `buildTripAccount` for the
 * trip figures — loaded through the endpoint's own loader
 * (`services/stats/travelAccountData.ts`). Nothing here re-derives a night
 * or a covered day: the precedence rule that decides whether a night was
 * slept at sea or in a hotel lives in `travelAccount.ts` and is read from
 * there, because a second copy of it would put rows in the panel that the
 * tile never counted.
 *
 * ONE NIGHT IS ONE NIGHT, however many rows claimed it. Two stays that
 * overlap both produced the same hotel night, and the account counts it
 * once; giving each of them a contribution of 1 would report twice the
 * number the tile shows. Each night's single unit is therefore SPLIT evenly
 * between its claimants, the same move `countRoundTrips` makes for the two
 * legs of one round trip (0.5 each). The share is what makes the sum
 * invariant hold against the account's own figure rather than against a row
 * count.
 */

function sumResponse(args: {
  key: string;
  unit: string;
  scope: EvidenceScope;
  page: PagingParams;
  value: number;
  entries: EvidenceEntry[];
}): EvidenceResponse {
  const { entries, omittedCount, omittedContribution } = pageSumEntries(args.entries, args.page);
  return {
    measure: {
      kind: "metric",
      key: args.key,
      aggregation: "sum",
      label: { key: `evidence.metric.${args.key}` },
      unit: args.unit,
      value: args.value,
      scope: args.scope,
    },
    entries,
    returned: entries.length,
    omitted: { count: omittedCount, contribution: omittedContribution },
    unattributed: [],
    page: args.page,
  };
}

/** Row lookups for the three night buckets, built once per request. */
interface AccountIndex {
  data: TravelAccountData;
  nights: AttributedNight[];
}

async function loadAccountIndex(userId: string): Promise<AccountIndex> {
  const data = await loadTravelAccountData(userId);
  return { data, nights: attributeTravelNights(data).nights };
}

/** Each claimed night hands out exactly one unit, split evenly — see the header. */
function shareNights(
  nights: AttributedNight[],
  claimantsOf: (night: AttributedNight) => string[]
): Map<string, number> {
  const byId = new Map<string, number>();
  for (const night of nights) {
    const claimants = claimantsOf(night);
    if (claimants.length === 0) continue;
    const share = 1 / claimants.length;
    for (const id of claimants) byId.set(id, (byId.get(id) ?? 0) + share);
  }
  return byId;
}

function nightEntriesFor(
  source: NightSource,
  data: TravelAccountData,
  contributionById: Map<string, number>,
  subtitleOf: (id: string) => EvidenceEntry["subtitle"]
): EvidenceEntry[] {
  if (source === "hotel") {
    return data.stays
      .filter((stay) => contributionById.has(stay.id))
      .map((stay) =>
        stayEvidenceEntry(stay, {
          contribution: contributionById.get(stay.id)!,
          subtitle: subtitleOf(stay.id),
        })
      );
  }
  if (source === "sea") {
    return data.cruises
      .filter((cruise) => contributionById.has(cruise.id))
      .map((cruise) =>
        cruiseEvidenceEntry(cruise, {
          contribution: contributionById.get(cruise.id)!,
          subtitle: subtitleOf(cruise.id),
        })
      );
  }
  return data.flights
    .filter((flight) => contributionById.has(flight.id))
    .map((flight) => ({
      ...flightEvidenceEntry(flight, contributionById.get(flight.id)!),
      subtitle: subtitleOf(flight.id),
    }));
}

const NIGHT_UNIT = "nights";

async function resolveNightBucket(
  userId: string,
  key: string,
  source: NightSource,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, key);
  const { data, nights } = await loadAccountIndex(userId);
  const awarded = nights.filter((night) => night.awardedTo === source);
  const contributionById = shareNights(awarded, (night) => night.claims[source] ?? []);
  return sumResponse({
    key,
    unit: NIGHT_UNIT,
    scope,
    page,
    // The account's own figure: the number of nights this bucket WON, not
    // the number it claimed. A night claimed by a hotel and spent at sea is
    // a sea night, and the tile says so.
    value: awarded.length,
    entries: nightEntriesFor(source, data, contributionById, () => null),
  });
}

export function resolveTravelAccountHotelNights(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  return resolveNightBucket(userId, "travelAccountHotelNights", "hotel", scope, page);
}

export function resolveTravelAccountSeaNights(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  return resolveNightBucket(userId, "travelAccountSeaNights", "sea", scope, page);
}

export function resolveTravelAccountAirNights(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  return resolveNightBucket(userId, "travelAccountAirNights", "air", scope, page);
}

/**
 * Home nights are the REMAINDER — the days of a year that no stay, cruise or
 * flight claimed — so there is no row to name and never will be. The value
 * is nonetheless derived, and it is carried in `unattributed` with
 * `notPerEntry`: the panel then prints "N nights cannot be split across
 * individual entries" instead of an empty list under a bare number.
 */
export async function resolveTravelAccountHomeNights(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "travelAccountHomeNights");
  const data = await loadTravelAccountData(userId);
  const account = buildTravelAccount(data);
  const homeNights = account.years.reduce((total, year) => total + year.homeNights, 0);
  return {
    measure: {
      kind: "metric",
      key: "travelAccountHomeNights",
      aggregation: "sum",
      label: { key: "evidence.metric.travelAccountHomeNights" },
      unit: NIGHT_UNIT,
      value: homeNights,
      scope,
    },
    entries: [],
    returned: 0,
    omitted: { count: 0, contribution: 0 },
    unattributed: homeNights > 0 ? [{ count: homeNights, reason: "notPerEntry" }] : [],
    page,
  };
}

/**
 * The four combinations of "what else claimed this night". The entry's own
 * bucket is implied by its domain, so the key names only the OTHERS — a
 * sentence the reader can act on ("also booked as a hotel") rather than a
 * bare "contested". Sorted so `sea+hotel` and `hotel+sea` are one key.
 */
const CONTESTED_WITH_KEY: Record<string, string> = {
  hotel: "evidence.travelAccount.contestedWith.hotel",
  sea: "evidence.travelAccount.contestedWith.sea",
  air: "evidence.travelAccount.contestedWith.air",
  "air,hotel": "evidence.travelAccount.contestedWith.hotelAir",
  "air,sea": "evidence.travelAccount.contestedWith.seaAir",
  "hotel,sea": "evidence.travelAccount.contestedWith.seaHotel",
};

const SOURCES: NightSource[] = ["hotel", "sea", "air"];

function claimantsOfAnyBucket(night: AttributedNight): string[] {
  return SOURCES.flatMap((source) => night.claims[source] ?? []);
}

/**
 * The nights two buckets disagreed about. Every claimant is evidence — the
 * hotel AND the cruise, not only the winner — because the number counts the
 * DISAGREEMENT, and a list holding one side of it would not explain itself.
 */
export async function resolveTravelAccountContestedNights(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "travelAccountContestedNights");
  const { data, nights } = await loadAccountIndex(userId);
  const contested = nights.filter((night) => night.contested);
  const contributionById = shareNights(contested, claimantsOfAnyBucket);

  // Which OTHER buckets a row met across all its contested nights.
  const othersById = new Map<string, Set<NightSource>>();
  for (const night of contested) {
    for (const source of SOURCES) {
      for (const id of night.claims[source] ?? []) {
        const others = othersById.get(id) ?? new Set<NightSource>();
        for (const other of SOURCES) {
          if (other !== source && night.claims[other]) others.add(other);
        }
        othersById.set(id, others);
      }
    }
  }
  const subtitleOf = (id: string): EvidenceEntry["subtitle"] => {
    const others = [...(othersById.get(id) ?? [])].sort().join(",");
    const key = CONTESTED_WITH_KEY[others];
    return key ? { key } : null;
  };

  // One pass per bucket, and no row can appear in two: `contributionById`
  // holds only rows that claimed a contested night, and a stay id is never a
  // cruise id.
  const entries = SOURCES.flatMap((source) =>
    nightEntriesFor(source, data, contributionById, subtitleOf)
  );

  return sumResponse({
    key: "travelAccountContestedNights",
    unit: NIGHT_UNIT,
    scope,
    page,
    value: contested.length,
    entries,
  });
}

/** The trip half of the section, straight off `buildTripAccount`. */
async function loadTripAccount(userId: string): Promise<{
  rows: ReturnType<typeof buildTripAccount>;
  startDateById: Map<string, Date | null>;
}> {
  const data = await loadTravelAccountData(userId);
  return {
    rows: buildTripAccount(data.trips),
    startDateById: new Map(data.trips.map((trip) => [trip.id, trip.startDate])),
  };
}

function tripDaysSubtitle(days: number | null): EvidenceEntry["subtitle"] {
  // `days`, not `count`: i18next reads `count` as a plural selector and would
  // look for `_one`/`_other` variants this key deliberately does not have.
  return days === null ? null : { key: "evidence.travelAccount.tripDays", values: { days } };
}

export async function resolveTravelAccountTripsWithDatesCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "travelAccountTripsWithDatesCount");
  const { rows, startDateById } = await loadTripAccount(userId);
  const dated = rows.trips.filter((trip) => trip.days !== null);
  return sumResponse({
    key: "travelAccountTripsWithDatesCount",
    unit: "trips",
    scope,
    page,
    value: rows.tripsWithDates,
    entries: dated.map((trip) =>
      tripEvidenceEntry(
        { id: trip.id, name: trip.name, startDate: startDateById.get(trip.id) ?? null },
        { contribution: 1, subtitle: tripDaysSubtitle(trip.days) }
      )
    ),
  });
}

export async function resolveTravelAccountFullyCoveredTripCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "travelAccountFullyCoveredTripCount");
  const { rows, startDateById } = await loadTripAccount(userId);
  // `buildTripAccount`'s own predicate: a DATED trip whose every travelling
  // day is accounted for. An undated trip is not "fully covered" — coverage
  // is unanswered for it, which is a third state and not a yes.
  const covered = rows.trips.filter((trip) => trip.days !== null && trip.uncoveredDays === 0);
  return sumResponse({
    key: "travelAccountFullyCoveredTripCount",
    unit: "trips",
    scope,
    page,
    value: rows.fullyCoveredTrips,
    entries: covered.map((trip) =>
      tripEvidenceEntry(
        { id: trip.id, name: trip.name, startDate: startDateById.get(trip.id) ?? null },
        { contribution: 1, subtitle: tripDaysSubtitle(trip.days) }
      )
    ),
  });
}

export async function resolveTravelAccountUncoveredDayCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "travelAccountUncoveredDayCount");
  const { rows, startDateById } = await loadTripAccount(userId);
  // Only the trips that actually left a gap. A fully covered trip
  // contributes zero, and listing it as evidence for a count of uncovered
  // days would answer the question with rows that are not the answer.
  const gapped = rows.trips.filter((trip) => (trip.uncoveredDays ?? 0) > 0);
  return sumResponse({
    key: "travelAccountUncoveredDayCount",
    unit: "days",
    scope,
    page,
    value: rows.totalUncoveredDays,
    entries: gapped.map((trip) =>
      tripEvidenceEntry(
        { id: trip.id, name: trip.name, startDate: startDateById.get(trip.id) ?? null },
        { contribution: trip.uncoveredDays ?? 0, subtitle: tripDaysSubtitle(trip.days) }
      )
    ),
  });
}

export async function resolveTravelAccountJournalEntryCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "travelAccountJournalEntryCount");
  const { rows, startDateById } = await loadTripAccount(userId);
  const written = rows.trips.filter((trip) => trip.journalEntries > 0);
  return sumResponse({
    key: "travelAccountJournalEntryCount",
    unit: "entries",
    scope,
    page,
    value: rows.journalEntries,
    entries: written.map((trip) =>
      tripEvidenceEntry(
        { id: trip.id, name: trip.name, startDate: startDateById.get(trip.id) ?? null },
        { contribution: trip.journalEntries, subtitle: tripDaysSubtitle(trip.days) }
      )
    ),
  });
}
