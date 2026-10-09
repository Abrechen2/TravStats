/**
 * What a trip cost, as the SERVER computes it (`backend/src/shared/tripCost.ts`,
 * forgejo#274): per currency, never summed across them. The client shows it
 * and adds no price logic of its own.
 */
export interface TripCost {
  spendByCurrency: Record<string, number>;
  /** Entries with no usable price; above 0 the figure is a lower bound. */
  unpricedEntries: number;
}
