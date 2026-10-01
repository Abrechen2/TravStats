import type { RoadtripCosts } from "../../schemas/expense";
import { sumByCurrency } from "../../shared/expenses";

/**
 * A roadtrip's money per station, per leg and in total (forgejo#140) — what
 * `GET /roadtrips/:id` answers beside its stations and legs. Pure; the caller
 * loads the rows.
 *
 * A leg expense is reported on the STATION pair it runs between, because that
 * is the pair the detail's `legs` are keyed by once route corrections are
 * folded out (`shared/tour/viaPoints.ts`): a toll the old leg column held
 * between a station and a via point lands on the station-to-station leg
 * instead of on a pair no client can match. An end that is a via point walks
 * to the nearest station before (from) or after (to) it.
 *
 * Whatever cannot be placed — no station, a station since deleted (SetNull),
 * a leg whose ends no longer face each other — is `unpinned`, and still in
 * `total`: an expense that drops out of the sum because its station moved is
 * the silent loss this endpoint must not have.
 */

export interface CostStop {
  id: string;
  viaPoint: boolean;
}

export interface CostExpense {
  stopId: string | null;
  legFromStopId: string | null;
  legToStopId: string | null;
  amount: number;
  currency: string;
}

type Money = { amount: number; currency: string };

function stationAround(
  stops: readonly CostStop[],
  index: number,
  step: 1 | -1
): CostStop | undefined {
  for (let i = index; i >= 0 && i < stops.length; i += step) {
    if (!stops[i].viaPoint) return stops[i];
  }
  return undefined;
}

export function roadtripCosts(
  orderedStops: readonly CostStop[],
  expenses: readonly CostExpense[]
): RoadtripCosts {
  const indexOf = new Map(orderedStops.map((s, i) => [s.id, i]));
  const byStation = new Map<string, Money[]>();
  const byLeg = new Map<string, { from: string; to: string; items: Money[] }>();
  const unpinned: Money[] = [];

  for (const expense of expenses) {
    const money = { amount: expense.amount, currency: expense.currency };
    const stationIdx = expense.stopId === null ? undefined : indexOf.get(expense.stopId);
    if (stationIdx !== undefined && !orderedStops[stationIdx].viaPoint) {
      const list = byStation.get(orderedStops[stationIdx].id) ?? [];
      byStation.set(orderedStops[stationIdx].id, [...list, money]);
      continue;
    }
    const fromIdx = expense.legFromStopId === null ? undefined : indexOf.get(expense.legFromStopId);
    const toIdx = expense.legToStopId === null ? undefined : indexOf.get(expense.legToStopId);
    const from = fromIdx === undefined ? undefined : stationAround(orderedStops, fromIdx, -1);
    const to = toIdx === undefined ? undefined : stationAround(orderedStops, toIdx, 1);
    if (expense.stopId === null && from && to && indexOf.get(from.id)! < indexOf.get(to.id)!) {
      const key = `${from.id}>${to.id}`;
      const entry = byLeg.get(key) ?? { from: from.id, to: to.id, items: [] };
      byLeg.set(key, { ...entry, items: [...entry.items, money] });
      continue;
    }
    unpinned.push(money);
  }

  const order = (id: string) => indexOf.get(id) ?? Number.MAX_SAFE_INTEGER;
  return {
    total: sumByCurrency(expenses),
    byStation: [...byStation.entries()]
      .sort(([a], [b]) => order(a) - order(b))
      .map(([stopId, items]) => ({ stopId, byCurrency: sumByCurrency(items) })),
    byLeg: [...byLeg.values()]
      .sort((a, b) => order(a.from) - order(b.from))
      .map((leg) => ({
        fromStopId: leg.from,
        toStopId: leg.to,
        byCurrency: sumByCurrency(leg.items),
      })),
    unpinned: sumByCurrency(unpinned),
  };
}
