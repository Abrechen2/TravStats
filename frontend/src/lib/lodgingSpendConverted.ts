import type { LodgingStats } from "../types/lodging";

/**
 * True when the base-currency spend total is a zero nobody paid: no price was
 * recorded, or prices were recorded that nothing could convert. A real "0 €"
 * (an award stay) is still a zero. The stat strip and the currency card both
 * ask; the card used to show "In Basiswährung: 0 €" beside a strip that said
 * "— · 3 not converted" (CT106 audit B12, design-6 R04).
 */
export function lodgingSpendNothingConverted(
  stats: Pick<LodgingStats, "spendBaseTotal" | "spendByCurrency" | "spendUnconvertedStays"> & {
    spendBaseByCurrency?: Record<string, number>;
  }
): boolean {
  return (
    stats.spendBaseTotal === 0 &&
    (Object.keys(stats.spendByCurrency).length === 0 || stats.spendUnconvertedStays > 0) &&
    Object.values(stats.spendBaseByCurrency ?? {}).every((amount) => amount === 0)
  );
}
