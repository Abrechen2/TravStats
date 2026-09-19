/**
 * Whether the base-currency lodging total is a zero nobody paid.
 *
 * Three states hide behind one number: money recorded and converted, money
 * recorded that nothing could convert, and no money recorded at all. Only the
 * first is a real total; the other two print "0 €", which reads as "all free"
 * — measured on the RC with three unconverted stays under "0 € Ausgaben"
 * (CT106 audit B12, design-6 R04). An award stay priced at a real 0 is still a
 * zero and must NOT be swept in with them.
 *
 * It lived in `frontend/src/lib/` until task 7b-3 and had no backend twin,
 * which is why the evidence resolver for `lodgingSpendTotal` would otherwise
 * have decided the same question a second time — and the panel and the tile
 * would have disagreed about whether a figure exists at all.
 *
 * MIRRORED in `frontend/src/shared/lodgingSpendConverted.ts`. Change both
 * together.
 */
export interface LodgingSpendShape {
  spendBaseTotal: number;
  spendByCurrency: Record<string, number>;
  spendUnconvertedStays: number;
  spendBaseByCurrency?: Record<string, number>;
}

export function lodgingSpendNothingConverted(stats: LodgingSpendShape): boolean {
  return (
    stats.spendBaseTotal === 0 &&
    (Object.keys(stats.spendByCurrency).length === 0 || stats.spendUnconvertedStays > 0) &&
    Object.values(stats.spendBaseByCurrency ?? {}).every((amount) => amount === 0)
  );
}
