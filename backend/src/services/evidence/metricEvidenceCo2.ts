import type { EvidenceScope } from "../../shared/evidence";
import type { EvidenceEntry, EvidenceResponse } from "../../schemas/evidence";
import {
  loadBusCo2Items,
  loadCruiseCo2Items,
  loadFerryCo2Items,
  loadRailCo2Items,
  loadRentalCo2Items,
  type Co2Item,
} from "../co2/co2Rows";
import type { PagingParams } from "./paging";
import { domainSumEvidence, requireLifetime } from "./domainMeasureResponse";
import { cruiseEvidenceEntry } from "./entryMappersDomains";
import { railEvidenceEntry } from "./entryMappersDomains";
import { busEvidenceEntry, ferryEvidenceEntry, rentalEvidenceEntry } from "./entryMappersRentalBus";

/**
 * The CO2 tiles of the overview (forgejo#395): carbon per mode, and the saving
 * against flying. Each lists the records behind it with their own kilograms,
 * over the SAME items the tile's endpoint folds (`services/co2/co2Rows.ts`), so
 * the panel, the tile and a ride's own page read one estimate. A record with no
 * estimate (no distance, an electric car) is not listed; the response counts it
 * as abstained.
 */
type Measured<R> = { row: R; kg: number; saved: number | null };

function measured<R>(items: Co2Item<R>[]): Measured<R>[] {
  return items.flatMap(({ row, estimate }) =>
    estimate === null ? [] : [{ row, kg: estimate.kg, saved: estimate.savedKg }]
  );
}

function sumEvidence<R>(
  key: string,
  items: Co2Item<R>[],
  contribution: (m: Measured<R>) => number | null,
  entryOf: (row: R, contribution: number) => EvidenceEntry
) {
  return async (
    userId: string,
    scope: EvidenceScope,
    page: PagingParams
  ): Promise<EvidenceResponse> => {
    requireLifetime(scope, key);
    const entries = measured(items).flatMap((m) => {
      const share = contribution(m);
      return share === null ? [] : [entryOf(m.row, share)];
    });
    const total = entries.reduce((sum, e) => sum + (e.contribution ?? 0), 0);
    return domainSumEvidence({
      key,
      unit: "kg",
      scope,
      page,
      entries,
      value: entries.length === 0 ? null : total,
      abstained: items.length - entries.length,
    });
  };
}

const fields = (contribution: number) => ({ contribution, subtitle: null });

const railLabel = (r: {
  trainCategory: string | null;
  trainNumber: string | null;
  depStationName: string;
  arrStationName: string;
}): string => {
  const train = [r.trainCategory, r.trainNumber].filter(Boolean).join(" ");
  const route = `${r.depStationName} → ${r.arrStationName}`;
  return train ? `${train} · ${route}` : route;
};

type Loader<R> = (userId: string) => Promise<Co2Item<R>[]>;

function lazy<R>(
  key: string,
  load: Loader<R>,
  contribution: (m: Measured<R>) => number | null,
  entryOf: (row: R, contribution: number) => EvidenceEntry
) {
  return async (
    userId: string,
    scope: EvidenceScope,
    page: PagingParams
  ): Promise<EvidenceResponse> => {
    requireLifetime(scope, key);
    return sumEvidence(key, await load(userId), contribution, entryOf)(userId, scope, page);
  };
}

const kgOf = <R>(m: Measured<R>): number => m.kg;

export const resolveCo2RailKg = lazy("co2RailKg", loadRailCo2Items, kgOf, (row, c) =>
  railEvidenceEntry(
    {
      id: row.id,
      label: railLabel(row),
      departureTime: row.departureTime,
      depTimezone: row.depTimezone,
    },
    fields(c)
  )
);

export const resolveCo2BusKg = lazy("co2BusKg", loadBusCo2Items, kgOf, (row, c) =>
  busEvidenceEntry(row, fields(c))
);

export const resolveCo2FerryKg = lazy("co2FerryKg", loadFerryCo2Items, kgOf, (row, c) =>
  ferryEvidenceEntry(row, fields(c))
);

export const resolveCo2CruiseKg = lazy("co2CruiseKg", loadCruiseCo2Items, kgOf, (row, c) =>
  cruiseEvidenceEntry({ id: row.id, label: row.label, startDate: row.startDate }, fields(c))
);

export const resolveCo2RentalKg = lazy("co2RentalKg", loadRentalCo2Items, kgOf, (row, c) =>
  rentalEvidenceEntry(row, fields(c))
);

/** Rail and bus rides that had a flight to compare with; each contributes its estimated saving. */
export async function resolveCo2SavedVsFlightKg(
  userId: string,
  scope: EvidenceScope,
  page: PagingParams
): Promise<EvidenceResponse> {
  requireLifetime(scope, "co2SavedVsFlightKg");
  const [rail, bus] = await Promise.all([loadRailCo2Items(userId), loadBusCo2Items(userId)]);
  const entries = [
    ...measured(rail).flatMap((m) =>
      m.saved === null
        ? []
        : [
            railEvidenceEntry(
              {
                id: m.row.id,
                label: railLabel(m.row),
                departureTime: m.row.departureTime,
                depTimezone: m.row.depTimezone,
              },
              fields(m.saved)
            ),
          ]
    ),
    ...measured(bus).flatMap((m) =>
      m.saved === null ? [] : [busEvidenceEntry(m.row, fields(m.saved))]
    ),
  ];
  const total = entries.reduce((sum, e) => sum + (e.contribution ?? 0), 0);
  return domainSumEvidence({
    key: "co2SavedVsFlightKg",
    unit: "kg",
    scope,
    page,
    entries,
    value: entries.length === 0 ? null : total,
    abstained: rail.length + bus.length - entries.length,
  });
}
