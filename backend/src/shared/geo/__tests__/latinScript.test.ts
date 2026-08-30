import { anyNonLatin, hasNonLatinScript } from "../latinScript";

/**
 * The line this draws is the SCRIPT, not the language.
 *
 * A German logbook filled itself with 日光市 and مصر because the geocoder
 * answered in the local language — 21 of 54 places on a real instance. Those
 * cannot be read, sorted or typed by the people using the app. But an accented
 * Latin name can, even by someone who does not speak it, so the rule must not
 * turn into "strip anything unfamiliar".
 */
describe("hasNonLatinScript", () => {
  it.each([
    "Stephansplatz",
    "Rudolfskai 37",
    "20 South Entrance Road",
    "Lëtzebuerg",
    "España",
    "Île-de-France",
    "Straße",
    "Café",
    "Đà Nẵng",
  ])("treats Latin text as readable: %s", (value) => {
    expect(hasNonLatinScript(value)).toBe(false);
  });

  it.each([
    ["Japanese", "日光市"],
    ["Arabic", "مصر"],
    ["Armenian", "Հայաստան"],
    ["Georgian", "საქართველო"],
    ["Greek", "Ελλάδα"],
    ["Cyrillic", "Москва"],
    ["Chinese", "中国"],
  ])("flags %s", (_name, value) => {
    expect(hasNonLatinScript(value)).toBe(true);
  });

  it("flags a mixed string — one unreadable word is enough", () => {
    expect(hasNonLatinScript("Tokyo 東京")).toBe(true);
  });

  it("treats empty and null as fine, because absent is a different problem", () => {
    expect(hasNonLatinScript("")).toBe(false);
    expect(hasNonLatinScript(null)).toBe(false);
    expect(hasNonLatinScript(undefined)).toBe(false);
  });
});

describe("anyNonLatin", () => {
  it("is true when a single field is unreadable", () => {
    expect(anyNonLatin("Gizeh", null, "مصر")).toBe(true);
  });

  it("is false when every field reads in Latin script", () => {
    expect(anyNonLatin("Roma", "Italien", null)).toBe(false);
  });
});
