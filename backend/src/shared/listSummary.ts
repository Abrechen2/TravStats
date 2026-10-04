import { rentalDays, type DatedRental } from "./rentalCounting";

/**
 * The figures above the rail and rental logbooks, counted over the whole
 * FILTERED list — the rule the flights, cruises and stays strips already
 * follow. When those two lists became server-paged (forgejo#197) the browser
 * only held one page, so a strip counted in the browser said "50 Fahrten" of
 * 300. The count lives here, the browser only formats it.
 */

const fold = (value: string | null | undefined): string | null => {
  const trimmed = value?.trim();
  return trimmed ? trimmed.toLocaleLowerCase() : null;
};

export interface RailListSummary {
  journeys: number;
  operators: number;
  /** Trains with no operator recorded — named, not dropped from the count. */
  withoutOperator: number;
  /** Station identity is the name as recorded; a missing end adds nothing. */
  stations: number;
}

export function railListSummary(
  legs: ReadonlyArray<{
    operator: string | null;
    depStationName: string | null;
    arrStationName: string | null;
  }>
): RailListSummary {
  const operators = new Set<string>();
  const stations = new Set<string>();
  let withoutOperator = 0;
  for (const leg of legs) {
    const operator = fold(leg.operator);
    if (operator) operators.add(operator);
    else withoutOperator += 1;
    for (const name of [fold(leg.depStationName), fold(leg.arrStationName)]) {
      if (name) stations.add(name);
    }
  }
  return {
    journeys: legs.length,
    operators: operators.size,
    withoutOperator,
    stations: stations.size,
  };
}

export interface RentalListSummary {
  rentals: number;
  /** A cancelled rental never ran, so its days are not days driven. */
  days: number;
  providers: number;
}

/** Days are counted by `rentalCounting.ts`, the one home of that rule. */
export function rentalListSummary(
  rentals: ReadonlyArray<DatedRental & { provider: string; status: string }>
): RentalListSummary {
  const providers = new Set<string>();
  let days = 0;
  for (const rental of rentals) {
    const provider = fold(rental.provider);
    if (provider) providers.add(provider);
    if (rental.status !== "cancelled") days += rentalDays(rental);
  }
  return { rentals: rentals.length, days, providers: providers.size };
}
