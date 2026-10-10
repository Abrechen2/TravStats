import type { AnnotationSelection } from "../annotations";
import { select } from "./workshopSamples";

/**
 * Invented tour-operator documents for the package workshop (forgejo#124).
 * Every name, number and date is made up. SOURCE is annotated, HELD_OUT is
 * the same operator's next booking the derivation never saw, FOREIGN another
 * operator's that the template must decline.
 */

export const PACKAGE_SUBJECT = "Ihre Reisebestätigung – Sonnenfern Reisen";

interface Flight {
  date: string;
  number: string;
  from: string;
  to: string;
  dep: string;
  arr: string;
}

interface Stay {
  hotel: string;
  city: string;
  from: string;
  to: string;
}

const packageDoc = (opts: {
  ref: string;
  issued: string;
  trip: string;
  span: string;
  flights: Flight[];
  stays: Stay[];
}): string =>
  [
    "Sonnenfern Reisen GmbH · Probeweg 3 · 20095 Musterhafen",
    "Reisebestätigung / Rechnung",
    "",
    `Vorgangsnummer: ${opts.ref}`,
    `Rechnungsdatum: ${opts.issued}`,
    `Reise: ${opts.trip}`,
    `Reisezeitraum: ${opts.span}`,
    "",
    "Ihre Flüge",
    ...opts.flights.map((f) => `${f.date}  ${f.number}  ${f.from} - ${f.to}  ${f.dep} - ${f.arr}`),
    "",
    "Ihre Unterkünfte",
    ...opts.stays.map((s) => `${s.hotel}, ${s.city}  ${s.from} - ${s.to}`),
    "",
    "Zahlungsbedingungen",
    "Anzahlung 20 % bei Buchung",
  ].join("\n");

export const PACKAGE_SOURCE = packageDoc({
  ref: "SF-204417",
  issued: "12.05.2027",
  trip: "Rundreise Probeland",
  span: "01.07.2027 - 08.07.2027",
  flights: [
    { date: "01.07.2027", number: "XQ 1234", from: "HAM", to: "AYT", dep: "06:10", arr: "10:40" },
    { date: "08.07.2027", number: "XQ 1235", from: "AYT", to: "HAM", dep: "11:30", arr: "14:15" },
  ],
  stays: [{ hotel: "Hotel Probebucht", city: "Antalya", from: "01.07.2027", to: "08.07.2027" }],
});

export const PACKAGE_HELD_OUT = packageDoc({
  ref: "SF-219930",
  issued: "03.02.2028",
  trip: "Inselhüpfen Testmeer",
  span: "10.04.2028 - 20.04.2028",
  flights: [
    { date: "10.04.2028", number: "XQ 2001", from: "MUC", to: "HER", dep: "07:00", arr: "11:05" },
    { date: "15.04.2028", number: "XQ 2140", from: "HER", to: "RHO", dep: "09:15", arr: "10:05" },
    { date: "20.04.2028", number: "XQ 2002", from: "RHO", to: "MUC", dep: "12:00", arr: "14:20" },
  ],
  stays: [
    { hotel: "Hotel Kretablick", city: "Heraklion", from: "10.04.2028", to: "15.04.2028" },
    { hotel: "Villa Probehafen", city: "Rhodos", from: "15.04.2028", to: "20.04.2028" },
  ],
});

export const PACKAGE_FOREIGN = [
  "Wolkenweit Touristik AG",
  "Buchungsbestätigung",
  "Buchungscode: WW-5512",
  "Ausgestellt am 01.03.2027",
  "01.06.2027  XQ 9001  FRA - PMI  08:00 - 10:20",
].join("\n");

export const PACKAGE_SELECTIONS: AnnotationSelection[] = [
  select(PACKAGE_SOURCE, "SF-204417", "bookingReference"),
  select(PACKAGE_SOURCE, "12.05.2027", "issuedOn"),
  select(PACKAGE_SOURCE, "Rundreise Probeland", "tripName"),
  // The first flight row; its date also stands in the trip span above it.
  select(PACKAGE_SOURCE, "01.07.2027", "flightDate", 2),
  select(PACKAGE_SOURCE, "XQ 1234", "flightNumber"),
  select(PACKAGE_SOURCE, "HAM", "flightDepIata"),
  select(PACKAGE_SOURCE, "AYT", "flightArrIata"),
  select(PACKAGE_SOURCE, "06:10", "flightDepTime"),
  select(PACKAGE_SOURCE, "10:40", "flightArrTime"),
  // The hotel row.
  select(PACKAGE_SOURCE, "Hotel Probebucht", "stayName"),
  select(PACKAGE_SOURCE, "Antalya", "stayCity"),
  select(PACKAGE_SOURCE, "01.07.2027", "stayCheckIn", 3),
  select(PACKAGE_SOURCE, "08.07.2027", "stayCheckOut", 3),
];
