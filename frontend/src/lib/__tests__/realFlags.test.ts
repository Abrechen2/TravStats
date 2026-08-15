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
