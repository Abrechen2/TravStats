import type { TemplateEnvelope } from "./envelope";

/**
 * Order v2 templates for a user's home country — order, never filter (owner
 * ruling 3, 2026-10-09).
 *
 * A template for another market stays a candidate: a German traveller books a
 * Spanish hotel through its Spanish confirmation, and dropping that template
 * would turn a readable booking into a silent parse failure. The home country
 * only decides which templates are tried first.
 *
 * Three ranks, stable within each (the incoming order is the tie-breaker):
 * 1. templates whose `markets` name the home country,
 * 2. global templates (`markets: []`),
 * 3. everything else.
 *
 * Without a home country the input order is returned unchanged.
 */
export function orderByMarket<T extends Pick<TemplateEnvelope, "markets">>(
  templates: readonly T[],
  homeCountry?: string | null
): T[] {
  if (!homeCountry) return [...templates];
  const home = homeCountry.toUpperCase();
  const rank = (t: T): number => {
    if (t.markets.includes(home)) return 0;
    if (t.markets.length === 0) return 1;
    return 2;
  };
  return templates
    .map((template, index) => ({ template, index, rank: rank(template) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.template);
}
