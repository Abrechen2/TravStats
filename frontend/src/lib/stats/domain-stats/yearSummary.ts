// Small shared pieces for building `summaryByYear` in the four adapters.

/** Ranked chips from a label → count map, the way every card shows them. */
export function topFive(counts: Map<string, number>): Array<{ label: string; value: number }> {
  return [...counts.entries()]
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([label, value]) => ({ label, value }));
}

/** The bucket for `year`, created on first use. */
export function bucket<T>(map: Map<number, T>, year: number, create: () => T): T {
  let entry = map.get(year);
  if (entry === undefined) {
    entry = create();
    map.set(year, entry);
  }
  return entry;
}
