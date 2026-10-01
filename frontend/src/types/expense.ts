import type { ExpenseKind } from "../shared/expenses";

/** Amount per ISO 4217 code — never summed across currencies. */
export type AmountsByCurrency = Record<string, number>;

/** One expense as the server answers it (forgejo#140). */
export interface TripExpense {
  id: string;
  /** Set for a trip-wide expense; then `routeId` is null. */
  tripId: string | null;
  /** Set for a roadtrip's or tour's; then `tripId` is null. */
  routeId: string | null;
  stopId: string | null;
  legFromStopId: string | null;
  legToStopId: string | null;
  kind: ExpenseKind;
  amount: number;
  currency: string;
  /** `YYYY-MM-DD`, the local day it was paid; null when unknown. */
  date: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
}

/** What `GET /roadtrips/:id` adds: the money per station, per leg and in total. */
export interface RoadtripCosts {
  total: AmountsByCurrency;
  byStation: Array<{ stopId: string; byCurrency: AmountsByCurrency }>;
  /** Keyed by the two STATIONS a leg runs between, as `legs` are. */
  byLeg: Array<{ fromStopId: string; toStopId: string; byCurrency: AmountsByCurrency }>;
  /** On the roadtrip but on no station or leg; counted in `total`. */
  unpinned: AmountsByCurrency;
}

/** POST body. A station OR a leg, never both. */
export interface ExpenseInput {
  kind: ExpenseKind;
  amount: number;
  currency: string;
  date?: string | null;
  note?: string | null;
  stopId?: string | null;
  legFromStopId?: string | null;
  legToStopId?: string | null;
}
