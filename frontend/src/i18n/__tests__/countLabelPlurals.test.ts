import { describe, it, expect } from "vitest";
import { createInstance } from "i18next";

import deCommon from "../resources/de/common.json";
import enCommon from "../resources/en/common.json";
import deRail from "../resources/de/rail.json";
import enRail from "../resources/en/rail.json";
import deStats from "../resources/de/stats.json";
import enStats from "../resources/en/stats.json";

/**
 * forgejo#160 — with exactly one entry, every list header and the Gesamt
 * experiences tile read "1 Flüge · 1 Airlines", "1 Fahrten", "1 Unterkünfte",
 * "1 Kreuzfahrten · 1 Reedereien". The labels were plain plural nouns, so
 * i18next had no singular to pick even where the count was at hand.
 *
 * Resolved through a real i18next instance against the real bundles, because
 * the suffix rule (`_one` / `_other`) is the library's: asserting that a JSON
 * key exists says nothing about what the reader sees for one row.
 */
const instance = createInstance();
void instance.init({
  lng: "de",
  fallbackLng: false,
  resources: {
    de: { common: deCommon, rail: deRail, stats: deStats },
    en: { common: enCommon, rail: enRail, stats: enStats },
  },
});

const say = (lng: "de" | "en", key: string, count: number): string =>
  instance.getFixedT(lng)(key, { count });

/** [key, DE one, DE other, EN one, EN other] */
const LIST_LABELS: readonly [string, string, string, string, string][] = [
  ["common:summary.flights", "Flug", "Flüge", "Flight", "Flights"],
  ["common:summary.airlines", "Airline", "Airlines", "Airline", "Airlines"],
  ["common:summary.airports", "Flughafen", "Flughäfen", "Airport", "Airports"],
  ["common:summary.cruises", "Kreuzfahrt", "Kreuzfahrten", "Cruise", "Cruises"],
  ["common:summary.portCalls", "Hafenanlauf", "Hafenanläufe", "Port call", "Port calls"],
  ["common:summary.seaDays", "Seetag", "Seetage", "Sea day", "Sea days"],
  ["common:summary.lines", "Reederei", "Reedereien", "Cruise line", "Cruise lines"],
  ["common:summary.lodgings", "Unterkunft", "Unterkünfte", "Stay", "Stays"],
  ["common:summary.stays", "Aufenthalt", "Aufenthalte", "Booking", "Bookings"],
  ["common:summary.nights", "Übernachtung", "Übernachtungen", "Night", "Nights"],
  ["common:summary.chains", "Kette", "Ketten", "Chain", "Chains"],
  ["common:summary.places", "Ort", "Orte", "Place", "Places"],
  ["common:summary.countries", "Land", "Länder", "Country", "Countries"],
  ["rail:summary.journeys", "Fahrt", "Fahrten", "Journey", "Journeys"],
  ["rail:summary.operators", "Betreiber", "Betreiber", "Operator", "Operators"],
  ["rail:summary.stations", "Bahnhof", "Bahnhöfe", "Station", "Stations"],
];

describe("list summary labels agree with their count (forgejo#160)", () => {
  it.each(LIST_LABELS)("%s", (key, deOne, deOther, enOne, enOther) => {
    expect(say("de", key, 1)).toBe(deOne);
    expect(say("de", key, 2)).toBe(deOther);
    expect(say("de", key, 0)).toBe(deOther);
    expect(say("en", key, 1)).toBe(enOne);
    expect(say("en", key, 2)).toBe(enOther);
  });
});

describe("the Gesamt experiences tile breakdown (forgejo#160)", () => {
  it.each([
    ["flight", "1 Flug", "3 Flüge", "1 flight", "3 flights"],
    ["cruise", "1 Kreuzfahrt", "3 Kreuzfahrten", "1 cruise", "3 cruises"],
    ["lodging", "1 Unterkunft", "3 Unterkünfte", "1 stay", "3 stays"],
    ["poi", "1 Ort", "3 Orte", "1 place", "3 places"],
    ["roadtrip", "1 Roadtrip", "3 Roadtrips", "1 roadtrip", "3 roadtrips"],
    ["rail", "1 Zugfahrt", "3 Zugfahrten", "1 train journey", "3 train journeys"],
    ["rental", "1 Mietwagen", "3 Mietwagen", "1 rental car", "3 rental cars"],
  ] as const)("%s", (domain, deOne, deMany, enOne, enMany) => {
    const key = `stats:overviewKpis.breakdown.${domain}`;
    expect(say("de", key, 1)).toBe(deOne);
    expect(say("de", key, 3)).toBe(deMany);
    expect(say("en", key, 1)).toBe(enOne);
    expect(say("en", key, 3)).toBe(enMany);
  });

  it("the per-domain card's lifetime count reads in the singular for one", () => {
    expect(say("de", "stats:overviewCard.lifetimeCount", 1)).toBe("1 Erlebnis");
    expect(say("de", "stats:overviewCard.lifetimeCount", 4)).toBe("4 Erlebnisse");
  });
});
