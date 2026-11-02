import { fxColumnsFor, getBaseCurrency, type FxColumns } from "../fx/snapshot";

/**
 * The FX columns an edit must write, or `undefined` to leave them alone.
 * Recomputed only when an input it depends on moved — from the merged state,
 * so a currency-only PATCH still converts the unchanged price (forgejo#382).
 */
export async function fxColumnsOnEdit(
  userId: string,
  input: { price?: number | null; currency?: string },
  existing: { price: number | null; currency: string | null; departureTime: Date },
  mergedDepartureTime: Date
): Promise<FxColumns | undefined> {
  const inputsChanged =
    input.price !== undefined ||
    input.currency !== undefined ||
    mergedDepartureTime.getTime() !== existing.departureTime.getTime();
  if (!inputsChanged) return undefined;
  return fxColumnsFor(
    {
      amount: input.price !== undefined ? input.price : existing.price,
      currency: input.currency ?? existing.currency,
      date: mergedDepartureTime,
    },
    await getBaseCurrency(userId)
  );
}
