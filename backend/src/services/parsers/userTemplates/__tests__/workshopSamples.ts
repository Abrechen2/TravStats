import type { AnnotationSelection } from "../annotations";

/**
 * Invented documents for the cruise and place workshop (forgejo#124). Every
 * name, number and date here is made up; the owner's corpus is never committed.
 *
 * Each domain has the annotated SOURCE, a HELD-OUT document of the same issuer
 * the derivation never saw (the evidence that a template describes a sender,
 * not one booking), and a FOREIGN document of the same domain from another
 * issuer, which the template must decline.
 */

export function select(
  text: string,
  value: string,
  label: string,
  occurrence = 1
): AnnotationSelection {
  let start = -1;
  for (let i = 0; i < occurrence; i++) start = text.indexOf(value, start + 1);
  if (start < 0) throw new Error(`sample does not contain ${value}`);
  return { start, end: start + value.length, text: value, label };
}

// ------------------------------------------------------------------ cruise

export const CRUISE_SUBJECT = "Ihre Buchungsbestätigung – Nordlicht Seereisen";

interface Stop {
  day: number;
  weekday: string;
  date: string;
  port: string;
  times?: string;
}

const cruiseMail = (opts: {
  ref: string;
  ship: string;
  cabin: string;
  category: string;
  price: string;
  stops: Stop[];
}): string =>
  [
    "Nordlicht Seereisen GmbH · Musterkai 1 · 24100 Kiel",
    "Buchungsbestätigung",
    "",
    `Buchungsnummer: ${opts.ref}`,
    `Schiff: ${opts.ship}`,
    `Kabine: ${opts.cabin}    Kategorie: ${opts.category}`,
    `Reisepreis: ${opts.price} EUR`,
    "",
    "Ihr Reiseverlauf",
    ...opts.stops.map(
      (s) => `Tag ${s.day}  ${s.weekday} ${s.date}  ${s.port}${s.times ? `  ${s.times}` : ""}`
    ),
    "",
    "Zahlungsplan",
    "Anzahlung bis 12.03.2027",
    "Restzahlung 30 Tage vor Abreise",
  ].join("\n");

export const CRUISE_SOURCE = cruiseMail({
  ref: "NL-48213",
  ship: "MS Probestern",
  cabin: "7042",
  category: "Balkonkabine",
  price: "2.480,00",
  stops: [
    { day: 1, weekday: "Mo", date: "02.06.2027", port: "Kiel", times: "ab 18:00" },
    { day: 2, weekday: "Di", date: "03.06.2027", port: "Seetag" },
    { day: 3, weekday: "Mi", date: "04.06.2027", port: "Oslo", times: "08:00 - 17:00" },
    { day: 4, weekday: "Do", date: "05.06.2027", port: "Kiel", times: "an 09:00" },
  ],
});

export const CRUISE_HELD_OUT = cruiseMail({
  ref: "NL-50977",
  ship: "MS Morgenwind",
  cabin: "5110",
  category: "Innenkabine",
  price: "1.150,00",
  stops: [
    { day: 1, weekday: "Fr", date: "13.08.2027", port: "Warnemünde", times: "ab 17:00" },
    { day: 2, weekday: "Sa", date: "14.08.2027", port: "Kopenhagen", times: "07:00 - 15:00" },
    { day: 3, weekday: "So", date: "15.08.2027", port: "Seetag" },
    {
      day: 4,
      weekday: "Mo",
      date: "16.08.2027",
      port: "Las Palmas de Probe",
      times: "09:00 - 18:00",
    },
    { day: 5, weekday: "Di", date: "17.08.2027", port: "Warnemünde", times: "an 08:00" },
  ],
});

/**
 * The same line's PDF layout: each itinerary day over two lines — the day
 * and its date WITHOUT a year above, the port below — and the start date in
 * the header. A voyage over New Year, so the year must roll over.
 */
const cruiseMailTwoLine = (opts: {
  ref: string;
  ship: string;
  start: string;
  stops: Array<{ day: number; weekday: string; date: string; port: string; times?: string }>;
}): string =>
  [
    "Nordlicht Seereisen GmbH · Musterkai 1 · 24100 Kiel",
    "Buchungsbestätigung",
    "",
    `Buchungsnummer: ${opts.ref}`,
    `Schiff: ${opts.ship}`,
    `Reisebeginn: ${opts.start}`,
    "",
    "Ihr Reiseverlauf",
    ...opts.stops.flatMap((s) => [
      `Tag ${s.day}  ${s.weekday} ${s.date}`,
      `${s.port}${s.times ? `  ${s.times}` : ""}`,
    ]),
    "",
    "Zahlungsplan",
    "Anzahlung bis 12.03.2026",
  ].join("\n");

export const CRUISE_TWO_LINE_SOURCE = cruiseMailTwoLine({
  ref: "NL-61002",
  ship: "MS Probestern",
  start: "30.12.2026",
  stops: [
    { day: 1, weekday: "Mi", date: "30.12.", port: "Kiel", times: "ab 18:00" },
    { day: 2, weekday: "Do", date: "31.12.", port: "Seetag" },
    { day: 3, weekday: "Fr", date: "01.01.", port: "Oslo", times: "08:00 - 17:00" },
    { day: 4, weekday: "Sa", date: "02.01.", port: "Kiel", times: "an 09:00" },
  ],
});

export const CRUISE_TWO_LINE_HELD_OUT = cruiseMailTwoLine({
  ref: "NL-61377",
  ship: "MS Morgenwind",
  start: "14.08.2027",
  stops: [
    { day: 1, weekday: "Sa", date: "14.08.", port: "Warnemünde", times: "ab 17:00" },
    { day: 2, weekday: "So", date: "15.08.", port: "Las Palmas de Probe", times: "09:00 - 18:00" },
    { day: 3, weekday: "Mo", date: "16.08.", port: "Warnemünde", times: "an 08:00" },
  ],
});

export const CRUISE_TWO_LINE_SELECTIONS: AnnotationSelection[] = [
  select(CRUISE_TWO_LINE_SOURCE, "Nordlicht Seereisen", "cruiseLine"),
  select(CRUISE_TWO_LINE_SOURCE, "NL-61002", "bookingReference"),
  select(CRUISE_TWO_LINE_SOURCE, "MS Probestern", "shipName"),
  select(CRUISE_TWO_LINE_SOURCE, "30.12.2026", "startDate"),
  // "30.12." also stands inside the start date above; the row's is the second.
  select(CRUISE_TWO_LINE_SOURCE, "30.12.", "stopDate", 2),
  select(CRUISE_TWO_LINE_SOURCE, "Kiel", "stopPort", 2),
];

/** Another cruise line, same domain: the derived template must not claim it. */
export const CRUISE_FOREIGN = [
  "Südwind Kreuzfahrten AG",
  "Ihre Reisebestätigung",
  "Vorgangsnummer: SW-1234",
  "Ihr Reiseverlauf",
  "Tag 1  Mo 02.06.2027  Genua  ab 18:00",
  "Tag 2  Di 03.06.2027  Marseille  08:00 - 17:00",
].join("\n");

export const CRUISE_SELECTIONS: AnnotationSelection[] = [
  select(CRUISE_SOURCE, "Nordlicht Seereisen", "cruiseLine"),
  select(CRUISE_SOURCE, "NL-48213", "bookingReference"),
  select(CRUISE_SOURCE, "MS Probestern", "shipName"),
  select(CRUISE_SOURCE, "7042", "cabinNumber"),
  select(CRUISE_SOURCE, "Balkonkabine", "cabinType"),
  select(CRUISE_SOURCE, "2.480,00 EUR", "price"),
  select(CRUISE_SOURCE, "02.06.2027", "stopDate"),
  select(CRUISE_SOURCE, "Kiel", "stopPort", 2),
  select(CRUISE_SOURCE, "Seetag", "seaDay"),
];

// ------------------------------------------------------------------ place

export const PLACE_SUBJECT = "Ihr Ticket – Museum am Probeufer";

const placeTicket = (opts: { date: string; ticket: string; visitor: string }): string =>
  [
    "Museum am Probeufer",
    "Uferweg 12, 10999 Musterstadt",
    "",
    "Online-Ticket",
    `Ticketnummer: ${opts.ticket}`,
    `Besuchstag: ${opts.date}`,
    `Besucher: ${opts.visitor}`,
    "Kategorie: Museum",
    "",
    "Bitte zeigen Sie dieses Ticket am Einlass vor.",
  ].join("\n");

export const PLACE_SOURCE = placeTicket({
  date: "14.09.2027",
  ticket: "MP-20931",
  visitor: "Erika Beispiel",
});

export const PLACE_HELD_OUT = placeTicket({
  date: "02.11.2027",
  ticket: "MP-31877",
  visitor: "Max Probe",
});

/** Another museum, same domain: the derived template must not claim it. */
export const PLACE_FOREIGN = [
  "Galerie Neuland",
  "Online-Ticket",
  "Ticketnummer: GN-1",
  "Besuchstag: 14.09.2027",
].join("\n");

export const PLACE_SELECTIONS: AnnotationSelection[] = [
  select(PLACE_SOURCE, "Museum am Probeufer", "name"),
  select(PLACE_SOURCE, "Uferweg 12, 10999 Musterstadt", "address"),
  select(PLACE_SOURCE, "14.09.2027", "visitedAt"),
  select(PLACE_SOURCE, "Museum", "category", 2),
];
