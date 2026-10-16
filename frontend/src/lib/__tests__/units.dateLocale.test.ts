import { describe, expect, it } from "vitest";
import { dateLocaleForLanguage } from "../units";

/**
 * Thirty-two screens wrote `language.startsWith("en") ? "en-GB" : "de-DE"`
 * inline. It is NOT `localeForLanguage` (that one says en-US, month-first), so
 * the shared rule must keep day-first British dates for English.
 */
describe("dateLocaleForLanguage", () => {
  it.each([
    ["en", "en-GB"],
    ["en-US", "en-GB"],
    ["en-GB", "en-GB"],
    ["de", "de-DE"],
    ["de-AT", "de-DE"],
    ["fr", "de-DE"],
    [undefined, "de-DE"],
  ] as const)("%s → %s", (language, locale) => {
    expect(dateLocaleForLanguage(language)).toBe(locale);
  });
});
