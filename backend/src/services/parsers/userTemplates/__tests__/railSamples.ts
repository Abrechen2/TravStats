import type { AnnotationSelection } from "../annotations";
import { select } from "./workshopSamples";

/**
 * Invented rail documents for the rail workshop (forgejo#309). Every station
 * pairing, number, price and date is made up; no real booking is committed.
 * SOURCE is annotated, HELD_OUT is the same operator's next booking the
 * derivation never saw (a return section and a ride past midnight), FOREIGN
 * another operator's that the template must decline.
 */

export const RAIL_SUBJECT = "Ihre Reiseverbindung mit der Probebahn";

interface Leg {
  from: string;
  dep: string;
  to: string;
  arr: string;
  train: string;
}

const railDoc = (opts: {
  ref: string;
  price: string;
  outbound: { date: string; legs: Leg[] };
  back?: { date: string; legs: Leg[] };
}): string => {
  const row = (l: Leg) => `${l.from}  ${l.dep}  →  ${l.to}  ${l.arr}  ${l.train}`;
  return [
    "Probebahn Reisezentrum · Musterplatz 1 · 86150 Musterstadt",
    "Ihre Reiseverbindung",
    "",
    `Auftragsnummer: ${opts.ref}`,
    "Klasse: 2. Klasse",
    `Gesamtpreis: ${opts.price} EUR`,
    "",
    `Hinfahrt am ${opts.outbound.date}`,
    ...opts.outbound.legs.map(row),
    ...(opts.back ? ["", `Rückfahrt am ${opts.back.date}`, ...opts.back.legs.map(row)] : []),
    "",
    "Gute Fahrt wünscht Ihr Probebahn-Team",
  ].join("\n");
};

export const RAIL_SOURCE = railDoc({
  ref: "PB4711XY",
  price: "23,40",
  outbound: {
    date: "14.11.2027",
    legs: [
      { from: "Augsburg Hbf", dep: "08:12", to: "München Hbf", arr: "08:48", train: "RE 89" },
      {
        from: "München Hbf",
        dep: "09:02",
        to: "München Flughafen Terminal",
        arr: "09:42",
        train: "S 1",
      },
    ],
  },
});

export const RAIL_HELD_OUT = railDoc({
  ref: "PB5822ZQ",
  price: "61,90",
  outbound: {
    date: "03.12.2027",
    legs: [
      { from: "Ulm Hbf", dep: "06:05", to: "Augsburg Hbf", arr: "06:51", train: "RE 57" },
      { from: "Augsburg Hbf", dep: "07:02", to: "Nürnberg Hbf", arr: "08:15", train: "ICE 1208" },
    ],
  },
  back: {
    date: "05.12.2027",
    legs: [{ from: "Nürnberg Hbf", dep: "23:40", to: "Ulm Hbf", arr: "00:55", train: "IC 2013" }],
  },
});

export const RAIL_FOREIGN = [
  "Schienenfern Express · Bahnhofstraße 9 · 10115 Probehausen",
  "Ticketbestätigung",
  "",
  "Buchungscode: SX-31337",
  "Fahrt am 14.11.2027",
  "Probehausen Ost  10:00  →  Probehausen West  10:30  RB 12",
].join("\n");

export const RAIL_SELECTIONS: AnnotationSelection[] = [
  select(RAIL_SOURCE, "PB4711XY", "bookingReference"),
  select(RAIL_SOURCE, "2. Klasse", "travelClass"),
  select(RAIL_SOURCE, "23,40", "price"),
  select(RAIL_SOURCE, "14.11.2027", "departureDate"),
  select(RAIL_SOURCE, "Augsburg Hbf", "depStation"),
  select(RAIL_SOURCE, "08:12", "departureTime"),
  select(RAIL_SOURCE, "München Hbf", "arrStation"),
  select(RAIL_SOURCE, "08:48", "arrivalTime"),
  select(RAIL_SOURCE, "RE 89", "train"),
];
