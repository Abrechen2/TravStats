import { describe, it, expect } from "vitest";
import de from "../resources/de/evidence.json";
import en from "../resources/en/evidence.json";

/**
 * A measure label names WHAT is counted; the panel prints WHICH population
 * separately, on its own line under the value (`EvidencePanel`'s
 * `scopeText`). Where a measure serves more than one scope those two must not
 * be merged: the three `scorecard*` labels read "(rollierend, letzte 12
 * Monate)" while the resolver equally serves `year` and `allTime`, so opening
 * the tile with the range on 2023 gave a title and a scope line that
 * contradicted each other.
 *
 * The check is deliberately narrow — the multi-scope measures only, against
 * the scope vocabulary the panel itself uses — rather than a ban on the word
 * "year" everywhere: `yearFlightCount` is a single-scope measure and names
 * its year on purpose, through an interpolated value.
 */
const MULTI_SCOPE_MEASURE_KEYS = [
  "evidence.metric.scorecardFlightCount",
  "evidence.metric.scorecardDistanceKm",
  "evidence.metric.scorecardFlightTimeMinutes",
];

const SCOPE_WORDS = [
  /rollierend/i,
  /rolling/i,
  /letzte\s+12/i,
  /last\s+12/i,
  /gesamter zeitraum/i,
  /all time/i,
];

describe("evidence labels for multi-scope measures name no period", () => {
  for (const [locale, bundle] of Object.entries({ de, en }) as Array<
    [string, Record<string, unknown>]
  >) {
    it(`${locale}: the scorecard labels leave the window to the scope line`, () => {
      for (const key of MULTI_SCOPE_MEASURE_KEYS) {
        const label = bundle[key];
        expect([key, typeof label]).toEqual([key, "string"]);
        for (const word of SCOPE_WORDS) {
          expect([key, word.source, word.test(label as string)]).toEqual([key, word.source, false]);
        }
      }
    });
  }
});
