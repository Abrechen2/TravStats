/**
 * German exonyms of cities whose airports the catalogue spells in English
 * (`airports.name` / `airports.city` come from OurAirports): a rental mail
 * says "München Flughafen", the catalogue says "Munich Airport". Without this
 * table "München" found only the closed München-Riem field and stayed
 * unresolved (browser look 2026-10-01).
 *
 * The port table (`services/portExonyms.ts`) is not reusable here: it maps
 * cities to their PORT of call ("Rom" → Civitavecchia), which is wrong for an
 * airport. Keys are lower-case; values are the catalogue's spelling. Only
 * names that differ from the English one belong here — "Hamburg" needs no row.
 */
const AIRPORT_CITY_ALIASES: Readonly<Record<string, string>> = {
  münchen: "Munich",
  muenchen: "Munich",
  köln: "Cologne",
  koeln: "Cologne",
  nürnberg: "Nuremberg",
  nuernberg: "Nuremberg",
  wien: "Vienna",
  prag: "Prague",
  warschau: "Warsaw",
  brüssel: "Brussels",
  bruessel: "Brussels",
  kopenhagen: "Copenhagen",
  genf: "Geneva",
  zürich: "Zurich",
  athen: "Athens",
  rom: "Rome",
  mailand: "Milan",
  venedig: "Venice",
  neapel: "Naples",
  florenz: "Florence",
  genua: "Genoa",
  lissabon: "Lisbon",
  sevilla: "Seville",
  nizza: "Nice",
  belgrad: "Belgrade",
  bukarest: "Bucharest",
  moskau: "Moscow",
  kairo: "Cairo",
  tanger: "Tangier",
  teneriffa: "Tenerife",
  korfu: "Corfu",
  rhodos: "Rhodes",
  peking: "Beijing",
  havanna: "Havana",
  "mexiko-stadt": "Mexico City",
};

/** The catalogue spellings a place word may stand for: itself, plus its alias. */
export function airportSearchTerms(word: string): string[] {
  const alias = AIRPORT_CITY_ALIASES[word.toLowerCase()];
  return alias && alias.toLowerCase() !== word.toLowerCase() ? [word, alias] : [word];
}
