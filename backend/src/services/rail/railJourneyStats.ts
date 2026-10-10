import {
  groupRailLegs,
  transferMinutes,
  type GroupableRailLeg,
} from "../../shared/railJourneyGrouping";
import {
  firstRidesPerConnection,
  railConnectionKey,
  departureYearOf,
} from "../../shared/railConnections";
import { nightTrainNights, operatorKey, type NightTrainFacts } from "../../shared/railRideKinds";
import { rideHasClocks } from "../../shared/railClock";

/**
 * The rail tab's journey-level figures (forgejo#261): rides read as journeys,
 * the changes between them, favourite and new connections, punctuality per
 * operator and per connection, and the nights slept on board.
 *
 * Every rule here is somebody else's, on purpose:
 *  - which legs are ONE journey is `shared/railJourneyGrouping.ts` — only legs
 *    of the same booking that meet at a station within four hours, and never a
 *    leg back to a station the journey already left from (that is the way
 *    back, so an outbound and its return are two journeys). Rides that are not
 *    linked by a booking are never joined here, however well they line up;
 *  - which connection a ride is on, and which station is which, is
 *    `shared/railConnections.ts` (the unordered pair, as for flights);
 *  - what a night on board is, is `shared/railRideKinds.nightTrainNights`, the
 *    rule the travel account reads too.
 *
 * Pure: the caller passes rides that `shared/railCounting.ts` already counted.
 */

/**
 * A ride arrived on time when its recorded delay is at most this — the first
 * bucket of the rail tab's delay chart ("pünktlich"), so the per-operator
 * share and the chart beside it use one word for one thing.
 */
export const RAIL_ON_TIME_MAX_MINUTES = 0;

const TOP = 10;
/** A favourite is a connection taken at least this often — once is not a habit. */
const FAVOURITE_MIN_RIDES = 2;
const FAVOURITES = 5;

export interface RailJourneyRow extends NightTrainFacts {
  id: string;
  operator: string | null;
  depStationName: string;
  arrStationName: string;
  depStationCode: string | null;
  arrStationCode: string | null;
  delayMinutes: number | null;
  /** Optional so hand-built test rows need not name them; the query selects them. */
  bookingId?: string | null;
  depStationId?: number | null;
  arrStationId?: number | null;
  depLat?: number;
  depLon?: number;
  arrLat?: number;
  arrLon?: number;
}

export interface RailPunctualityRow {
  label: string;
  /** Rides with a recorded delay and both clocks — the sample. */
  measured: number;
  /** Of those, arrived at most `RAIL_ON_TIME_MAX_MINUTES` late. */
  onTime: number;
  /** Mean delay over the sample, one decimal, early arrivals negative. */
  averageMinutes: number;
}

export interface RailJourneyFigures {
  journeys: {
    /** Rides read as journeys: a change of trains on one booking is one journey. */
    total: number;
    /** Journeys of two or more trains. */
    withTransfer: number;
  };
  /** The waits between the trains of one journey — every one of them measured by the grouping rule. */
  transfers: {
    count: number;
    averageMinutes: number | null;
    shortestMinutes: number | null;
    longestMinutes: number | null;
  };
  /** Connections taken at least twice, most rides first; both directions together. */
  favouriteConnections: Array<{ from: string; to: string; rides: number; latestRideId: string }>;
  newConnections: {
    /** Connections first recorded on a ride in the rides passed as `scoped`. */
    inScope: number;
    /** Lifetime, per year of the first ride, ascending. */
    byYear: Array<{ year: number; count: number }>;
  };
  punctuality: { byOperator: RailPunctualityRow[]; byConnection: RailPunctualityRow[] };
  /** Nights slept on a night train; `undated` = a night train whose arrival day is unknown. */
  nightTrainNights: { nights: number; undated: number };
}

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** What the grouping reads of a ride — the badge rows carry it as well as the statistics rows. */
export type RailJourneyLegInput = Pick<
  RailJourneyRow,
  | "id"
  | "depStationName"
  | "arrStationName"
  | "departureTime"
  | "arrivalTime"
  | "depPrecision"
  | "arrPrecision"
  | "bookingId"
  | "depStationId"
  | "arrStationId"
  | "depLat"
  | "depLon"
  | "arrLat"
  | "arrLon"
>;

function asLeg(r: RailJourneyLegInput): GroupableRailLeg {
  return {
    id: r.id,
    bookingId: r.bookingId ?? null,
    depStationId: r.depStationId ?? null,
    arrStationId: r.arrStationId ?? null,
    depStationName: r.depStationName,
    arrStationName: r.arrStationName,
    // A hand-built row without a position cannot be "within a kilometre" of
    // anything; NaN keeps the distance test false rather than inventing 0,0.
    depLat: r.depLat ?? Number.NaN,
    depLon: r.depLon ?? Number.NaN,
    arrLat: r.arrLat ?? Number.NaN,
    arrLon: r.arrLon ?? Number.NaN,
    departureTime: r.departureTime,
    arrivalTime: r.arrivalTime,
    depPrecision: r.depPrecision,
    arrPrecision: r.arrPrecision,
  };
}

/** The rides grouped into journeys by the one grouping rule. */
export function railJourneysOf<T extends RailJourneyLegInput>(rows: readonly T[]): T[][] {
  const byId = new Map(rows.map((r) => [r.id, r]));
  return groupRailLegs(rows.map(asLeg)).map((legs) => legs.map((leg) => byId.get(leg.id)!));
}

/**
 * A journey with at least one change, every train of which carries both
 * clocks — "fully documented" for the "Gut umgestiegen" badge. The grouping
 * already demands the clocks AT each change; this asks it of every end.
 */
export function isDocumentedTransferJourney(journey: readonly RailJourneyLegInput[]): boolean {
  return journey.length >= 2 && journey.every((r) => rideHasClocks(r) && r.arrivalTime !== null);
}

/**
 * The measured changes of ONE journey, in minutes — a change whose two clocks
 * are not both known is left out, never read as 0. The rail and bus tabs
 * average these, and their evidence panels list the journeys they came from.
 */
export function journeyTransferWaits(journey: readonly RailJourneyLegInput[]): number[] {
  const waits: number[] = [];
  for (let i = 1; i < journey.length; i += 1) {
    const wait = transferMinutes(journey[i - 1], journey[i]);
    if (wait !== null) waits.push(wait);
  }
  return waits;
}

function transferFigures(journeys: readonly RailJourneyRow[][]): RailJourneyFigures["transfers"] {
  const waits = journeys.flatMap(journeyTransferWaits);
  if (waits.length === 0) {
    return { count: 0, averageMinutes: null, shortestMinutes: null, longestMinutes: null };
  }
  return {
    count: waits.length,
    averageMinutes: round1(waits.reduce((a, b) => a + b, 0) / waits.length),
    shortestMinutes: Math.min(...waits),
    longestMinutes: Math.max(...waits),
  };
}

/** Display names of a connection: the stations as the most recent ride on it spells them. */
function connectionLabel(ride: RailJourneyRow): { from: string; to: string } {
  const dep = ride.depStationName.trim();
  const arr = ride.arrStationName.trim();
  return dep.localeCompare(arr) <= 0 ? { from: dep, to: arr } : { from: arr, to: dep };
}

function favourites(rows: readonly RailJourneyRow[]): RailJourneyFigures["favouriteConnections"] {
  const byKey = new Map<string, { rides: number; latest: RailJourneyRow }>();
  for (const ride of rows) {
    const key = railConnectionKey(ride);
    if (key === null) continue;
    const entry = byKey.get(key);
    const latest =
      entry && entry.latest.departureTime.getTime() > ride.departureTime.getTime()
        ? entry.latest
        : ride;
    byKey.set(key, { rides: (entry?.rides ?? 0) + 1, latest });
  }
  return [...byKey.values()]
    .filter((v) => v.rides >= FAVOURITE_MIN_RIDES)
    .map((v) => ({ ...connectionLabel(v.latest), rides: v.rides, latestRideId: v.latest.id }))
    .sort((a, b) => b.rides - a.rides || a.from.localeCompare(b.from) || a.to.localeCompare(b.to))
    .slice(0, FAVOURITES);
}

/** A recorded delay on a ride with both clocks — the sample the delay chart is drawn over. */
const delaySample = (r: RailJourneyRow): number | null =>
  r.delayMinutes !== null && r.arrivalTime !== null && rideHasClocks(r) ? r.delayMinutes : null;

function punctualityBy(
  rows: readonly RailJourneyRow[],
  keyOf: (r: RailJourneyRow) => { key: string; label: string } | null
): RailPunctualityRow[] {
  const groups = new Map<string, { label: string; delays: number[] }>();
  for (const ride of rows) {
    const delay = delaySample(ride);
    const id = keyOf(ride);
    // Unknown delay is out of the sample, never "on time" (forgejo#261).
    if (delay === null || id === null) continue;
    const group = groups.get(id.key) ?? { label: id.label, delays: [] };
    group.delays.push(delay);
    groups.set(id.key, group);
  }
  return [...groups.values()]
    .map(({ label, delays }) => ({
      label,
      measured: delays.length,
      onTime: delays.filter((d) => d <= RAIL_ON_TIME_MAX_MINUTES).length,
      averageMinutes: round1(delays.reduce((a, b) => a + b, 0) / delays.length),
    }))
    .sort((a, b) => b.measured - a.measured || a.label.localeCompare(b.label))
    .slice(0, TOP);
}

function nightFigures(rows: readonly RailJourneyRow[]): RailJourneyFigures["nightTrainNights"] {
  let nights = 0;
  let undated = 0;
  for (const ride of rows) {
    const keys = nightTrainNights(ride);
    if (keys === null) undated += 1;
    else nights += keys.length;
  }
  return { nights, undated };
}

/**
 * @param scoped the counted rides of the period on screen
 * @param all    every counted ride — a connection is "new" in the year its
 *               FIRST ride left, which a period cut cannot see on its own
 */
export function computeRailJourneyFigures(
  scoped: readonly RailJourneyRow[],
  all: readonly RailJourneyRow[] = scoped
): RailJourneyFigures {
  const journeys = railJourneysOf(scoped);
  const firsts = firstRidesPerConnection(all);
  const scopedIds = new Set(scoped.map((r) => r.id));
  const byYear = new Map<number, number>();
  for (const ride of firsts.values()) {
    const year = departureYearOf(ride);
    byYear.set(year, (byYear.get(year) ?? 0) + 1);
  }
  const operatorLabels = new Map<string, string>();
  return {
    journeys: {
      total: journeys.length,
      withTransfer: journeys.filter((j) => j.length >= 2).length,
    },
    transfers: transferFigures(journeys),
    favouriteConnections: favourites(scoped),
    newConnections: {
      inScope: [...firsts.values()].filter((r) => scopedIds.has(r.id)).length,
      byYear: [...byYear.entries()]
        .map(([year, count]) => ({ year, count }))
        .sort((a, b) => a.year - b.year),
    },
    punctuality: {
      byOperator: punctualityBy(scoped, (r) => {
        const key = operatorKey(r.operator);
        if (key === null) return null;
        // The first spelling met names the operator; the folded key decides identity.
        if (!operatorLabels.has(key)) operatorLabels.set(key, (r.operator as string).trim());
        return { key, label: operatorLabels.get(key)! };
      }),
      byConnection: punctualityBy(scoped, (r) => {
        const key = railConnectionKey(r);
        if (key === null) return null;
        const { from, to } = connectionLabel(r);
        return { key, label: `${from} – ${to}` };
      }),
    },
    nightTrainNights: nightFigures(scoped),
  };
}
