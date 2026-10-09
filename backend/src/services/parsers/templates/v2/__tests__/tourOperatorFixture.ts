/**
 * An INVENTED tour-operator invoice and the template that reads it. Every
 * name, address and number here is made up — the operator, the travellers,
 * the hotels and the booking number exist nowhere.
 */
export const TOUR_INVOICE = [
  "Sonnenweg Reisen GmbH · Musterstraße 1 · 12345 Beispielstadt",
  "RECHNUNG / REISEBESTÄTIGUNG",
  "Buchungsnummer: SW-482913",
  "Rechnungsdatum: 02.03.26",
  "Reisende: Frau Erika Beispiel, Herr Max Muster",
  "",
  "Ihre Flüge",
  "FRA - ADD ET 707 18.05.26 21:35 06:25+1",
  "ADD - NBO ET 308 19.05.26 08:40 10:55",
  "NBO - ADD ET 309 30.05.26 12:00 14:10",
  "ADD - FRA ET 706 30.05.26 23:15 05:50+1",
  "",
  "Ihre Unterkünfte",
  "19.05.26 - 23.05.26 Savanna Example Lodge",
  "Parkweg 7, Beispielort, Kenia",
  "23.05.26 - 30.05.26 Hotel Seeblick Muster",
  "Uferweg 12, Musterhausen, Kenia",
  "",
  "Leistungen",
  "Rundreise laut Programm, Transfers, Reiseleitung",
  "Gesamtpreis: 3.249,00 EUR",
].join("\n");

const DATE = String.raw`\d{2}\.\d{2}\.\d{2}`;
const STAY_HEAD = String.raw`^${DATE}\s*-\s*${DATE}`;

export function tourOperatorTemplate() {
  return {
    id: "package:sonnenweg-example",
    domain: "package" as const,
    version: "2026.10.09",
    issuer: { name: "Sonnenweg Reisen", kind: "tour-operator" as const },
    markets: ["DE"],
    match: { markers: ["sonnenweg reisen"], anchors: ["buchungsnummer", "reisebestätigung"] },
    extraction: {
      fields: {
        bookingNumber: { patterns: [String.raw`Buchungsnummer:\s*(?<v>[A-Z0-9-]+)`] },
        issuedOn: { patterns: [String.raw`Rechnungsdatum:\s*(\S+)`], transform: "date" as const },
        total: { patterns: [String.raw`Gesamtpreis:\s*([\d.,]+)`], transform: "money" as const },
        currency: {
          patterns: [String.raw`Gesamtpreis:\s*[\d.,]+\s*(\S+)`],
          transform: "currency" as const,
        },
        operator: { value: "Sonnenweg Reisen" },
      },
      repeats: {
        flights: {
          mode: "matchAll" as const,
          within: { startAfter: "^Ihre Flüge$", endBefore: "^Ihre Unterkünfte$" },
          pattern: String.raw`^(?<from>[A-Z]{3})\s*-\s*(?<to>[A-Z]{3})\s+(?<fn>[A-Z0-9]{2}\s?\d{1,4})\s+(?<date>${DATE})\s+(?<dep>\d{2}:\d{2})\s+(?<arr>\d{2}:\d{2})(?<off>\+\d)?`,
          minimum: 2,
          fields: {
            from: { group: "from", transform: "iata" as const },
            to: { group: "to", transform: "iata" as const },
            flightNumber: { group: "fn", transform: "flightNumber" as const },
            date: { group: "date", transform: "date" as const },
            departs: { group: "dep", transform: "time" as const },
            arrives: { group: "arr", transform: "time" as const },
            arrivalDayOffset: { group: "off", transform: "dayOffset" as const },
          },
        },
        stays: {
          mode: "split" as const,
          within: { startAfter: "^Ihre Unterkünfte$", endBefore: "^Leistungen$" },
          splitPattern: STAY_HEAD,
          fields: {
            checkIn: { patterns: [`^(${DATE})`], transform: "date" as const },
            checkOut: {
              patterns: [String.raw`^${DATE}\s*-\s*(${DATE})`],
              transform: "date" as const,
            },
            name: { patterns: [String.raw`${STAY_HEAD}\s+(.+)$`], transform: "text" as const },
            address: { patterns: [String.raw`\n(?<v>[^\n]+)`], transform: "text" as const },
          },
        },
      },
      required: ["bookingNumber", "total", "currency", "flights", "stays"],
    },
    testCases: [
      {
        name: "the invoice is read",
        input: TOUR_INVOICE,
        expect: "match" as const,
        expected: {
          bookingNumber: "SW-482913",
          total: 3249,
          flights: [
            { from: "FRA", arrivalDayOffset: 1 },
            { to: "NBO" },
            {},
            { flightNumber: "ET706" },
          ],
          stays: [{ checkIn: "2026-05-19" }, { name: "Hotel Seeblick Muster" }],
        },
      },
      {
        name: "a newsletter from the same operator is declined",
        input: "Sonnenweg Reisen Newsletter: neue Rundreisen im Herbst",
        expect: "decline" as const,
      },
    ],
  };
}
