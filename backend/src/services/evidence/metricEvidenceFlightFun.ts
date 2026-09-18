import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceResponse } from "../../schemas/evidence";
import type { PagingParams } from "./paging";
import { flightDistinctEvidence, flightSumEvidence, requireAllTime } from "./flightMeasureResponse";
import {
  loadCountableCo2Rows,
  loadCountableCodeRows,
  loadCountableCoordinateRows,
  loadClockedFlightRows,
} from "./flightPopulations";
import {
  buildAirportTimezoneMap,
  departureDaypartOf,
  isLongHaulFlight,
  isShortHaulFlight,
  isWeekendDeparture,
} from "../../utils/stats/flightPredicates";
import { calculateCo2Kg, toSeatClass } from "../co2Calculator";

/**
 * `metric` evidence for the seven served tiles of `StatsFunSection`
 * (`GET /stats/fun`, `utils/stats/funStats.ts`): the timezone hopper, the
 * two time-of-day counts, the weekend warrior, the two distance bands and
 * the CO₂ footprint.
 *
 * Every per-flight rule below comes from `utils/stats/flightPredicates.ts`,
 * which `calculateFunStats` itself calls — the resolver applies the
 * calculator's rule, it does not resemble it. The four remaining tiles on
 * that surface are `ratio` or `extremum` measures and wait for release 2.
 */

/**
 * `timezoneHopperFlightCount` is a DISTINCT count of timezones, not a count
 * of flights: `calculateFunStats` answers it with `timezones.size`, the
 * union of the IANA zones of every airport the countable set touches. The
 * registry entry said `sum` / `flights` — measurably wrong against the
 * calculator it names, and corrected in both mirrors together with this
 * resolver. The key itself keeps its name: a key is an address, and renaming
 * one breaks every `?evidence=` link already in the wild for a wording fix.
 *
 * The map is keyed by CODE, so an airport named by both its IATA and its
 * ICAO code appears under both; crediting the union of a row's zones rather
 * than one per code is what keeps a single-airport pair from counting twice.
 */
export async function resolveTimezoneHopperFlightCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "timezoneHopperFlightCount");
  const rows = await loadCountableCodeRows(userId);
  const timezoneByCode = await buildAirportTimezoneMap(rows, "evidence_timezone_hopper");
  return flightDistinctEvidence({
    userId,
    key: "timezoneHopperFlightCount",
    unit: "timezones",
    scope,
    page,
    rows,
    creditsOf: (row) => [
      ...new Set(
        [row.depIata, row.depIcao, row.arrIata, row.arrIcao]
          .map((code) => (code ? timezoneByCode.get(code) : undefined))
          .filter((zone): zone is string => Boolean(zone))
      ),
    ],
  });
}

/**
 * Early bird and night owl read the hour on the DEPARTURE airport's clock,
 * over the `flown`-with-both-times subset alone. A `DATE_ONLY` row carries a
 * 12:00 placeholder and `departureDaypartOf` returns null for it, so it
 * appears in neither count and in neither panel — the calculator drops it
 * the same way rather than filing it under afternoon.
 */
export async function resolveEarlyBirdFlightCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "earlyBirdFlightCount");
  const rows = await loadClockedFlightRows(userId);
  return flightSumEvidence({
    userId,
    key: "earlyBirdFlightCount",
    unit: "flights",
    scope,
    page,
    rows: rows.filter((row) => departureDaypartOf(row) === "morning"),
  });
}

export async function resolveNightOwlFlightCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "nightOwlFlightCount");
  const rows = await loadClockedFlightRows(userId);
  return flightSumEvidence({
    userId,
    key: "nightOwlFlightCount",
    unit: "flights",
    scope,
    page,
    rows: rows.filter((row) => departureDaypartOf(row) === "evening"),
  });
}

export async function resolveWeekendFlightCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "weekendFlightCount");
  const rows = await loadClockedFlightRows(userId);
  return flightSumEvidence({
    userId,
    key: "weekendFlightCount",
    unit: "flights",
    scope,
    page,
    rows: rows.filter(isWeekendDeparture),
  });
}

export async function resolveShortHaulFlightCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "shortHaulFlightCount");
  const rows = await loadCountableCoordinateRows(userId);
  return flightSumEvidence({
    userId,
    key: "shortHaulFlightCount",
    unit: "flights",
    scope,
    page,
    rows: rows.filter(isShortHaulFlight),
  });
}

export async function resolveLongHaulFlightCount(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "longHaulFlightCount");
  const rows = await loadCountableCoordinateRows(userId);
  return flightSumEvidence({
    userId,
    key: "longHaulFlightCount",
    unit: "flights",
    scope,
    page,
    rows: rows.filter(isLongHaulFlight),
  });
}

/**
 * `co2FootprintKg` is the only fun measure whose rows contribute something
 * other than 1: each flight contributes `calculateCo2Kg`'s own estimate, the
 * same model stamped on the flight list's per-flight figure, so the panel's
 * rows add up to the tile above them by construction.
 *
 * `?? 0` rather than an abstention, deliberately. `calculateCo2Kg` returns
 * null when a coordinate is missing, and `calculateFunStats` folds such a row
 * in at zero (`if (co2 !== null) total += co2`) — but the branch cannot fire
 * for a row read from the flight table at all: `dep_lat`, `dep_lon`,
 * `arr_lat` and `arr_lon` are `Float` NOT NULL in `schema.prisma`. Inventing
 * an `UnattributedReason` for it would add a fifth word to a closed
 * vocabulary that no code path can produce and no test can reach — which is
 * the defect `shared/evidence.ts` already records against `entryRemoved` and
 * `locationHistoryOnly`. Should those columns ever become nullable, the right
 * answer is an abstention and this comment is the place it is owed.
 */
export async function resolveCo2FootprintKg(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireAllTime(scope, "co2FootprintKg");
  const rows = await loadCountableCo2Rows(userId);
  return flightSumEvidence({
    userId,
    key: "co2FootprintKg",
    unit: "kg",
    scope,
    page,
    rows,
    contributionOf: (row) =>
      calculateCo2Kg({
        depLat: row.depLat,
        depLon: row.depLon,
        arrLat: row.arrLat,
        arrLon: row.arrLon,
        seatClass: toSeatClass(row.seatClass),
      }) ?? 0,
  });
}
