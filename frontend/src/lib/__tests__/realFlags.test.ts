import { describe, it, expect } from "vitest";
import { resolveCountryCode } from "../countryFlag";

/** Die Werte, die im Bestand des Eigentümers wirklich stehen (279 Zeilen, 2026-08-15). */
const ECHT: Array<[string, string | null]> = [
  ["Italia", "IT"], ["España", "ES"], ["Sverige", "SE"], ["Việt Nam", "VN"],
  ["Schweiz/Suisse/Svizzera/Svizra", "CH"], ["Hrvatska", "HR"],
  ["Madagasikara / Madagascar", "MG"], ["Česko", "CZ"], ["Lëtzebuerg", "LU"],
  ["Tschechische Republik", "CZ"], ["Norge", "NO"], ["Slovenija", "SI"],
  ["Suomi / Finland", "FI"], ["België / Belgique / Belgien", "BE"], ["中国", "CN"],
  ["România", "RO"], ["Nederland", "NL"], ["USA", "US"],
  ["الإمارات العربية المتحدة", "AE"],
  // Kein Land — dafür darf es keine Flagge geben, sonst behauptet die Zeile etwas.
  ["null", null], ["", null], ["Fohnsdorf", null],
];

describe("resolveCountryCode gegen echte Bestandsdaten", () => {
  it.each(ECHT)("%s → %s", (eingabe, erwartet) => {
    expect(resolveCountryCode(eingabe)).toBe(erwartet);
  });
});

describe("Sprachabdeckung jenseits der kuratierten Liste", () => {
  // Sprachen, die NICHT in NAME_LOCALES stehen — sie beweisen, dass der breite
  // Durchgang wirklich greift und nicht nur die Liste abgearbeitet wird, an die
  // jemand gedacht hat.
  it.each([
    ["Ísland", "IS"],
    ["Éire", "IE"],
    ["Հայաստան", "AM"],
    ["საქართველო", "GE"],
    ["ไทย", "TH"],
    // Grenzen, die bewusst Grenzen bleiben: die Langform „Land Thailand" und
    // eine Umschrift stehen so in keinem Intl-Datensatz. Lieber keine Flagge
    // als eine geratene.
    ["ประเทศไทย", null],
    ["Bharat", null],
  ])("%s → %s", (eingabe, erwartet) => {
    expect(resolveCountryCode(eingabe)).toBe(erwartet);
  });

  it("die App bleibt zweisprachig — der Resolver ist es nicht", () => {
    // Beides muss gleichzeitig gelten: die Oberfläche zeigt DE/EN, die Daten
    // dürfen in jeder Sprache ankommen.
    expect(resolveCountryCode("Schweiz")).toBe("CH");
    expect(resolveCountryCode("Switzerland")).toBe("CH");
    expect(resolveCountryCode("Sveitsi")).toBe("CH");
  });
});
