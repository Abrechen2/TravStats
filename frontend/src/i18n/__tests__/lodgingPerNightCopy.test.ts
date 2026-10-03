import { describe, it, expect } from "vitest";
import de from "../resources/de/lodging.json";
import en from "../resources/en/lodging.json";

/**
 * forgejo#178: for the same stay the app said "pro Nacht 120 EUR" (the room
 * rate) and the web "Pro Übernachtung 134 EUR" (total spend over nights,
 * extras included). Both numbers are right; the web label has to say which
 * one it is, and must not read like the room rate.
 */
describe("the stay's per-night spend names what it averages", () => {
  it.each([
    ["de", de, /Ø.*Gesamtkosten/],
    ["en", en, /avg.*total/i],
  ] as const)("%s", (_lang, copy, expected) => {
    expect(copy.detail.spendPerNight).toMatch(expected);
    expect(copy.detail.spendPerNight).not.toBe(copy.field.pricePerNight);
  });
});
