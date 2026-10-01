/**
 * The airport an airline's own confirmation means when it prints a NAME
 * instead of a code.
 *
 * Germanwings writes "07:10 Dortmund 08:20 München", Air Berlin "Munich -
 * Cologne/Bonn". A template that copied those names into `departureCode`
 * would hand the importer a city where a code belongs, so a template asks
 * this table through the `airportName` transform and gets a code or nothing.
 *
 * Deliberately NOT the regex parser's `CITY_TO_IATA`. That table maps a city
 * to its main airport — "berlin" to BER, "paris" to CDG — which is right for a
 * guess and wrong for a template: a 2008 Germanwings flight "to Berlin" landed
 * at Tegel or Schönefeld, and BER did not exist (#287). Here a city with more
 * than one airport is listed only in the forms that name the airport
 * ("Berlin-Tegel", "Mailand Malpensa"); the bare city name is absent, so the
 * template reports the code as missing rather than guessing it.
 *
 * Every entry is an airport these confirmations were measured to print
 * (private mailbox, 2026-10-01). Extending it is safe in one direction only:
 * add a name that identifies exactly one airport.
 */
const AIRPORT_BY_NAME: Readonly<Record<string, string>> = Object.freeze({
  // Germany
  muenchen: "MUC",
  munich: "MUC",
  hamburg: "HAM",
  dortmund: "DTM",
  "koeln-bonn": "CGN",
  "koeln/bonn": "CGN",
  "cologne/bonn": "CGN",
  "cologne-bonn": "CGN",
  duesseldorf: "DUS",
  dusseldorf: "DUS",
  stuttgart: "STR",
  hannover: "HAJ",
  nuernberg: "NUE",
  nuremberg: "NUE",
  leipzig: "LEJ",
  "leipzig/halle": "LEJ",
  dresden: "DRS",
  bremen: "BRE",
  "berlin-tegel": "TXL",
  "berlin tegel": "TXL",
  "berlin - tegel": "TXL",
  "berlin-schoenefeld": "SXF",
  "berlin schoenefeld": "SXF",
  "berlin - schoenefeld": "SXF",
  // Elsewhere in Europe
  wien: "VIE",
  vienna: "VIE",
  zuerich: "ZRH",
  zurich: "ZRH",
  "mailand malpensa": "MXP",
  "mailand-malpensa": "MXP",
  "milan malpensa": "MXP",
  "mailand linate": "LIN",
  "milan linate": "LIN",
  helsinki: "HEL",
  amsterdam: "AMS",
  kopenhagen: "CPH",
  copenhagen: "CPH",
  warschau: "WAW",
  warsaw: "WAW",
  palma: "PMI",
  "palma de mallorca": "PMI",
});

/** Lower case, umlauts spelt out, inner whitespace collapsed. */
function fold(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/\s+/g, " ");
}

/**
 * The IATA code for an airport name, or `""` when the name is not one this
 * table can place with certainty. An empty answer is what the engine reads as
 * "not found", so the field is reported missing instead of carrying a name.
 * A value that already IS a three-letter code passes through.
 */
export function airportCodeFromName(raw: string): string {
  const trimmed = raw.trim();
  if (/^[A-Z]{3}$/.test(trimmed)) return trimmed;
  return AIRPORT_BY_NAME[fold(trimmed)] ?? "";
}
