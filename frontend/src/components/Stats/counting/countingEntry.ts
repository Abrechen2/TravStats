/**
 * The five questions every statistics figure answers (forgejo#256–#265), in
 * the order the reader meets them.
 *
 * - `unit` — what one unit of the figure is: a night, a visit, a kilometre;
 * - `time` — which clock and calendar decide when it happened;
 * - `source` — which records it is read from;
 * - `coverage` — how much of the data can answer, in numbers where there are any;
 * - `exclusions` — what is deliberately left out, and why.
 */
export const COUNTING_FIELDS = ["unit", "time", "source", "coverage", "exclusions"] as const;

export type CountingField = (typeof COUNTING_FIELDS)[number];

/**
 * Where a figure's five answers live: the i18n key prefix `helpKey` holds
 * `<helpKey>.unit`, `.time`, `.source`, `.coverage` and `.exclusions`, in DE
 * and EN alike — so `localeKeyParity` holds the translations, and no answer
 * is free text passed in from a component.
 */
export interface CountingSource {
  /** Namespaced key prefix, e.g. `rail:stats.help.journeys`. */
  helpKey: string;
  /** Interpolation values the answers name (a count of left-out records, …). */
  values?: Record<string, unknown>;
}

/** One figure in a "How this is counted" list: its on-screen name and its answers. */
export interface CountingEntry extends CountingSource {
  /** The figure as it is titled on screen. */
  term: string;
}

/** A `CountingSource` for the five answers under `<base>.help`. */
export function countingSource(base: string, values?: Record<string, unknown>): CountingSource {
  return values ? { helpKey: `${base}.help`, values } : { helpKey: `${base}.help` };
}
