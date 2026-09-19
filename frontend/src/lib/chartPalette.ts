import { tokens } from "../theme/tokens";
import type { DomainKey } from "../shared/domains";

/**
 * Colour for a chart series — and the rule for which colour.
 *
 * The web has no chart palette today: every series is `accent` or `success`,
 * which is fine while a chart has one series and silently wrong the moment it
 * has three. `chartColors` in the token file is the eight-colour list both
 * apps share.
 *
 * THE RULE, and it is the one correction the round-2 review names by itself:
 *
 *   A series that IS a domain carries `domainColor.<key>`.
 *   `chartColors` is for series WITHOUT a domain — airlines, airports, cabin
 *   classes, countries, years.
 *
 * The export got this wrong: it drew the cruise series of "activity per year"
 * in `chart[1]`, the `info` blue, while the cruise tile beside it, the
 * dashboard legend and the logbook sub-bar all used the domain teal. On one
 * screen, blue then meant "cruise" in a chart and "planned" in a pill.
 *
 * Domain series do not go through this module at all — they read
 * `useDomainColors()`, which is where the user's override lives. Sending them
 * here would silently ignore that override, which is the defect #270 removed.
 */

/** In the token file's order. A series takes its colour by index. */
export const CHART_COLORS: readonly string[] = tokens.chartColors;

/** The un-highlighted bar. Not a series colour — the absence of one. */
export const CHART_MUTED_BAR: string = tokens.chartMutedBar;

/**
 * The colour of the Nth series in a chart that has no domains in it.
 *
 * Wraps, rather than running out: eight airlines is common and a ninth must
 * still be drawn. A repeat is honest — a legend is what tells them apart once
 * there are more series than distinguishable hues.
 */
export function chartColor(index: number): string {
  return CHART_COLORS[index % CHART_COLORS.length];
}

/**
 * Grid, axis and tick colours, so a chart's chrome is not decided per file.
 * The hairline is the same one every card uses; the labels are `muted`.
 */
export const CHART_GRID = "var(--ts-border)";
export const CHART_LABEL = "var(--ts-muted)";
export const CHART_AXIS_TICK = { fill: CHART_LABEL, fontSize: 11 } as const;

/**
 * Guard rail for the rule above, usable from a test: a chart that plots
 * domains must not reach for `chartColors`.
 */
export function isDomainSeries(key: string): key is DomainKey {
  return ["flight", "cruise", "lodging", "poi"].includes(key);
}
