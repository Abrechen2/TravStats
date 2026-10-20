import type { AnnotationSelection } from "../annotations";
import { select } from "./workshopSamples";

/**
 * Invented coach and ferry tickets for the bus/ferry workshop (forgejo#309).
 * Every operator, terminal, number, price and date is made up; no real
 * booking is committed. SOURCE is annotated, HELD_OUT the same operator's
 * next ticket the derivation never saw (a return section, a ride past
 * midnight), FOREIGN another operator's that the template must decline.
 */

// ------------------------------------------------------------------ bus

export const BUS_SUBJECT = "Deine Buchung bei Fernbus Probeland";

interface Ride {
  from: string;
  dep: string;
  to: string;
  arr: string;
  line: string;
}

const busDoc = (opts: {
  ref: string;
  price: string;
  outbound: { date: string; rides: Ride[] };
  back?: { date: string; rides: Ride[] };
}): string => {
  const row = (r: Ride) => `${r.dep}  ${r.from}  →  ${r.arr}  ${r.to}  ${r.line}`;
  return [
    "Fernbus Probeland · Haltestellenweg 3 · 99999 Probestadt",
    "Deine Buchungsbestätigung",
    "",
    `Buchungsnummer: ${opts.ref}`,
    `Gesamtpreis: ${opts.price} EUR`,
    "",
    `Hinfahrt am ${opts.outbound.date}`,
    ...opts.outbound.rides.map(row),
    ...(opts.back ? ["", `Rückfahrt am ${opts.back.date}`, ...opts.back.rides.map(row)] : []),
    "",
    "Gute Reise wünscht Fernbus Probeland",
  ].join("\n");
};

export const BUS_SOURCE = busDoc({
  ref: "FBP-204711",
  price: "19,99",
  outbound: {
    date: "02.03.2028",
    rides: [
      { from: "Probestadt ZOB", dep: "07:30", to: "Musterhafen ZOB", arr: "11:05", line: "N 42" },
    ],
  },
});

export const BUS_HELD_OUT = busDoc({
  ref: "FBP-309922",
  price: "44,50",
  outbound: {
    date: "10.04.2028",
    rides: [
      { from: "Beispielberg", dep: "09:15", to: "Probestadt ZOB", arr: "10:40", line: "N 7" },
      { from: "Probestadt ZOB", dep: "11:00", to: "Musterhafen ZOB", arr: "14:25", line: "N 42" },
    ],
  },
  back: {
    date: "12.04.2028",
    rides: [
      { from: "Musterhafen ZOB", dep: "22:50", to: "Beispielberg", arr: "02:10", line: "N 43" },
    ],
  },
});

export const BUS_FOREIGN = [
  "Reisebus Fernweh · Am Busbahnhof 1 · 88888 Fernwehdorf",
  "Ticket",
  "",
  "Ticketnummer: RF-1",
  "Fahrt am 02.03.2028",
  "08:00  Fernwehdorf  →  09:00  Probestadt ZOB  RF 5",
].join("\n");

export const BUS_SELECTIONS: AnnotationSelection[] = [
  select(BUS_SOURCE, "FBP-204711", "bookingReference"),
  select(BUS_SOURCE, "19,99", "price"),
  select(BUS_SOURCE, "02.03.2028", "departureDate"),
  select(BUS_SOURCE, "07:30", "departureTime"),
  select(BUS_SOURCE, "Probestadt ZOB", "depStop"),
  select(BUS_SOURCE, "11:05", "arrivalTime"),
  select(BUS_SOURCE, "Musterhafen ZOB", "arrStop"),
  select(BUS_SOURCE, "N 42", "line"),
];

// ------------------------------------------------------------------ ferry

export const FERRY_SUBJECT = "Buchungsbestätigung – Inselfähren Probesee";

const ferryDoc = (opts: {
  ref: string;
  vessel: string;
  price: string;
  crossings: { date: string; from: string; dep: string; to: string; arr: string }[];
}): string =>
  [
    "Inselfähren Probesee AG · Kaistraße 1 · 77777 Probehafen",
    "Ihre Überfahrt ist gebucht",
    "",
    `Buchungsnummer: ${opts.ref}`,
    `Schiff: ${opts.vessel}`,
    `Gesamtbetrag: ${opts.price} EUR`,
    "",
    "Überfahrten",
    ...opts.crossings.map((c) => `${c.date}  ${c.from} ab ${c.dep}  –  ${c.to} an ${c.arr}`),
    "",
    "Bitte seien Sie 30 Minuten vor Abfahrt am Anleger.",
  ].join("\n");

export const FERRY_SOURCE = ferryDoc({
  ref: "IPS884213",
  vessel: "MS Probewind",
  price: "86,00",
  crossings: [
    { date: "18.07.2028", from: "Probehafen", dep: "08:45", to: "Musterinsel", arr: "10:15" },
    { date: "25.07.2028", from: "Musterinsel", dep: "17:30", to: "Probehafen", arr: "19:00" },
  ],
});

export const FERRY_HELD_OUT = ferryDoc({
  ref: "IPS990001",
  vessel: "MS Seebrise Probe",
  price: "43,00",
  crossings: [
    { date: "01.08.2028", from: "Probehafen", dep: "23:30", to: "Beispieloog", arr: "01:05" },
  ],
});

export const FERRY_FOREIGN = [
  "Nordfähre Fremdland · Hafen 2 · 66666 Fremdhafen",
  "Ticket",
  "Buchungsnummer: NF-77",
  "18.07.2028  Fremdhafen ab 09:00  –  Fremdinsel an 10:00",
].join("\n");

export const FERRY_SELECTIONS: AnnotationSelection[] = [
  select(FERRY_SOURCE, "IPS884213", "bookingReference"),
  select(FERRY_SOURCE, "MS Probewind", "vessel"),
  select(FERRY_SOURCE, "86,00", "price"),
  select(FERRY_SOURCE, "18.07.2028", "departureDate"),
  select(FERRY_SOURCE, "Probehafen", "depPort", 2),
  select(FERRY_SOURCE, "08:45", "departureTime"),
  select(FERRY_SOURCE, "Musterinsel", "arrPort"),
  select(FERRY_SOURCE, "10:15", "arrivalTime"),
];
