/**
 * How a passport groups the world, and against what denominator.
 *
 * TWO DECISIONS LIVE HERE, both of which a second product has to make the same
 * way or the two disagree about how far somebody has travelled. The Companion
 * app draws this screen already and its own table says it mirrors this
 * repository — so this file is the side that has to stay still.
 *
 * DECISION 1 — Africa and Antarctica are drawn as ONE ROW, and counted as TWO
 * CONTINENTS. The single row comes from the mockup, which has no space for a
 * seventh row that is empty for almost everyone. Counting them as one would
 * mean somebody who reaches Antarctica sees the headline number not move,
 * which is the opposite of what that trip deserves. So the grouping is
 * presentation and the count is data, and they are deliberately not the same
 * thing.
 *
 * DECISION 2 — the denominator is the countries THIS SERVER KNOWS, per
 * continent, and nothing else. There is no agreed number of countries in the
 * world: 193, 195 and 197 are all defensible and none is a fact. Quoting one
 * as if it were would put a made-up figure under a real one. What can be said
 * honestly is "you have been to 14 of the 51 European countries in this
 * catalogue", so that is what is said.
 */

import { CONTINENTS, countryCountsByContinent, type Continent } from "../utils/continents";

/** One row as the passport draws it. Several continents may share a row. */
export interface ContinentGroup {
  /** Stable identifier — safe to use as an i18n key or a React key. */
  key: string;
  /** The continents this row stands for, in the order they should be named. */
  continents: readonly Continent[];
}

/**
 * The rows, in reading order.
 *
 * Only one row covers more than one continent, and the comment above says why.
 * A client renders these; it must not invent its own grouping, or the two
 * products stop showing the same picture.
 */
export const CONTINENT_GROUPS: readonly ContinentGroup[] = [
  { key: "europe", continents: ["Europe"] },
  { key: "asia", continents: ["Asia"] },
  { key: "northAmerica", continents: ["North America"] },
  { key: "southAmerica", continents: ["South America"] },
  { key: "africaAntarctica", continents: ["Africa", "Antarctica"] },
  { key: "oceania", continents: ["Oceania"] },
] as const;

/**
 * Every continent appears in exactly one group.
 *
 * Checked here rather than trusted: adding a continent to the type without
 * adding it to a row would silently drop it from the screen, and a country
 * there would count towards a total nobody displays.
 */
export function groupsCoverEveryContinent(): boolean {
  const grouped = CONTINENT_GROUPS.flatMap((g) => g.continents);
  return (
    grouped.length === CONTINENTS.length && CONTINENTS.every((c) => grouped.includes(c))
  );
}

/** The denominator per continent — see DECISION 2. */
export function continentTotals(): Record<Continent, number> {
  return countryCountsByContinent();
}
