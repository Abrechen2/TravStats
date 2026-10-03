import { DOMAINS } from "../../shared/domains";
import type { LocalDateValue, TimeValue } from "../../shared/time/wire";
import type { MailBlock, MailContent, MailFact, MailFooterPart } from "./mailShell";
import {
  formatDurationMinutes,
  formatHoursUntil,
  formatLocalDate,
  formatTimeValue,
  type ReminderLang,
} from "./reminderFormat";

/**
 * What each reminder mail SAYS — one pure builder per domain, returning the
 * `MailContent` the shell renders to HTML and to plain text (forgejo#189).
 *
 * Builders pass plain strings and never escape: the shell does. They decide
 * only which facts the entry has, and a fact the entry does not have is left
 * out — `fact()` drops null, empty and non-positive values, so the mail never
 * prints "null", an empty row or a "0 nights" that means "unknown".
 *
 * Every time shown is a `TimeValue` / `LocalDateValue` already resolved to the
 * place's own clock by the domain's times DTO; nothing here reads a zone.
 */

export type ReminderDomain = "flight" | "cruise" | "rail" | "lodging";

/**
 * Colours are the domain registry's (`shared/domains.ts`, which a test ties to
 * `design/tokens.json` `domainColor.*`; lodging is the token file's `hotel`).
 * Read, not restated: a copied hex outlives the next palette change unseen.
 */
export const REMINDER_DOMAIN_COLORS: Record<ReminderDomain, string> = {
  flight: DOMAINS.flight.color,
  cruise: DOMAINS.cruise.color,
  rail: DOMAINS.rail.color,
  lodging: DOMAINS.lodging.color,
};

const DOMAIN_NAME: Record<ReminderLang, Record<ReminderDomain, string>> = {
  de: { flight: "Flug", cruise: "Kreuzfahrt", rail: "Bahn", lodging: "Unterkunft" },
  en: { flight: "Flight", cruise: "Cruise", rail: "Rail", lodging: "Stay" },
};

const CTA_LABEL: Record<ReminderLang, string> = {
  de: "In TravStats öffnen",
  en: "Open in TravStats",
};

const LOCAL_TIME_NOTE: Record<ReminderLang, string> = {
  de: "Alle Zeiten sind Ortszeiten.",
  en: "All times are local.",
};

/** Where the mail links to: the instance's frontend base URL, no trailing slash. */
export interface ReminderLinks {
  base: string;
}

type Maybe = string | number | null | undefined;

/** A fact row, or nothing when the entry does not carry the value. */
function fact(rows: MailFact[], label: string, value: Maybe, mono = false): void {
  if (value === null || value === undefined) return;
  const text = typeof value === "number" ? (value > 0 ? String(value) : "") : value.trim();
  if (!text) return;
  rows.push(mono ? { label, value: text, mono } : { label, value: text });
}

const present = (value: string | null | undefined): string | null => {
  const text = value?.trim();
  return text ? text : null;
};

const joined = (parts: Array<string | null | undefined>, separator: string): string | null =>
  present(
    parts
      .map(present)
      .filter((part): part is string => part !== null)
      .join(separator)
  );

/**
 * The app's wording for a stored vocabulary value (seat class, rail class,
 * board). A value outside the vocabulary is left out rather than printed raw
 * — own keys only, so a stored "constructor" finds nothing either.
 */
function worded(words: Record<string, string>, key: string | null | undefined): string | null {
  return key && Object.hasOwn(words, key) ? words[key] : null;
}

function footer(lang: ReminderLang, links: ReminderLinks): MailFooterPart[] {
  // The settings page resolves a section to the group it lives in
  // (`SettingsLegacyRedirect`), so the mail need not know that group. The old
  // `/settings/notifications` named a group that does not exist.
  const url = `${links.base}/settings?section=notifications`;
  return lang === "de"
    ? [
        "Diese Erinnerung lässt sich unter ",
        { label: "Einstellungen → Benachrichtigungen", url },
        " abschalten.",
      ]
    : ["You can turn this reminder off under ", { label: "Settings → Notifications", url }, "."];
}

function assemble(
  domain: ReminderDomain,
  lang: ReminderLang,
  links: ReminderLinks,
  parts: { subject: string; heading: string; blocks: MailBlock[]; path: string; zoned: boolean }
): MailContent {
  const blocks = [...parts.blocks];
  if (parts.zoned) blocks.push({ kind: "text", text: LOCAL_TIME_NOTE[lang], muted: true });
  blocks.push({ kind: "button", label: CTA_LABEL[lang], url: `${links.base}/${parts.path}` });
  return {
    lang,
    subject: parts.subject,
    preheader: parts.heading,
    accent: REMINDER_DOMAIN_COLORS[domain],
    eyebrow: `TravStats · ${DOMAIN_NAME[lang][domain]}`,
    heading: parts.heading,
    blocks,
    footer: footer(lang, links),
  };
}

/** True when the value is shown on a place's own clock (so the "local time" note is honest). */
const isZoned = (tv: TimeValue | null | undefined): boolean =>
  Boolean(tv && tv.zone !== null && tv.precision === "minute");

// ─── Flight ─────────────────────────────────────────────────────────────────

export interface FlightReminderData {
  id: string;
  tripId: string | null;
  flightNumber: string | null;
  airline: string | null;
  aircraft: string | null;
  seatNumber: string | null;
  seatClass?: string | null;
  terminal?: string | null;
  gate?: string | null;
  bookingReference?: string | null;
  depName: string | null;
  depIata: string | null;
  arrName: string | null;
  arrIata: string | null;
  departure: TimeValue | null;
  arrival: TimeValue | null;
  durationMinutes: number | null;
}

/** `Flight.seatClass` is a fixed vocabulary; anything else is left out rather than printed raw. */
const SEAT_CLASS: Record<string, string> = {
  economy: "Economy",
  premium_economy: "Premium Economy",
  business: "Business",
  first: "First",
};

/** An airport as code + name; the name alone when there is no code. */
function airportEnd(
  iata: string | null,
  name: string | null,
  time: string | null
): { primary: string; secondary: string | null; time: string | null } {
  const code = present(iata);
  const label = present(name);
  return {
    primary: code ?? label ?? "?",
    secondary: code && label && label !== code ? label : null,
    time,
  };
}

export function flightReminderContent(
  flight: FlightReminderData,
  hoursUntilDeparture: number,
  lang: ReminderLang,
  links: ReminderLinks
): MailContent {
  const de = lang === "de";
  const flightNumber = present(flight.flightNumber);
  const until = formatHoursUntil(hoursUntilDeparture, lang);
  const numberPart = flightNumber ? ` ${flightNumber}` : "";

  const rows: MailFact[] = [];
  fact(rows, de ? "Flug" : "Flight", flightNumber, true);
  fact(rows, "Airline", flight.airline);
  fact(rows, "Terminal", flight.terminal, true);
  fact(rows, "Gate", flight.gate, true);
  const seatClass = worded(SEAT_CLASS, flight.seatClass);
  if (present(flight.seatNumber)) {
    fact(rows, de ? "Sitzplatz" : "Seat", joined([flight.seatNumber, seatClass], " · "), true);
  } else {
    fact(rows, de ? "Klasse" : "Class", seatClass);
  }
  fact(rows, de ? "Buchungscode" : "Booking reference", flight.bookingReference, true);
  fact(rows, de ? "Flugzeug" : "Aircraft", flight.aircraft);
  fact(rows, de ? "Flugdauer" : "Duration", formatDurationMinutes(flight.durationMinutes, lang));

  return assemble("flight", lang, links, {
    subject: de
      ? `Flug-Erinnerung: ${flightNumber ?? "N/A"} in ${hoursUntilDeparture}h`
      : `Flight reminder: ${flightNumber ?? "N/A"} in ${hoursUntilDeparture}h`,
    heading: de
      ? `Dein Flug${numberPart} geht ${until}`
      : `Your flight${numberPart} leaves ${until}`,
    blocks: [
      {
        kind: "route",
        from: airportEnd(flight.depIata, flight.depName, formatTimeValue(flight.departure, lang)),
        to: airportEnd(flight.arrIata, flight.arrName, formatTimeValue(flight.arrival, lang)),
      },
      { kind: "facts", rows },
    ],
    path: flight.tripId ? `trips/${flight.tripId}` : `flights/${flight.id}`,
    zoned: isZoned(flight.departure) || isZoned(flight.arrival),
  });
}

// ─── Cruise ─────────────────────────────────────────────────────────────────

export interface CruiseReminderData {
  id: string;
  tripId: string | null;
  shipName: string | null;
  cruiseLine: string | null;
  routeName?: string | null;
  portName: string | null;
  portCity: string | null;
  portCountry: string | null;
  cabinType: string | null;
  cabinNumber: string | null;
  deck: number | null;
  bookingReference?: string | null;
  departure: TimeValue;
  /** The day the cruise ends, as the arrival port knows it. */
  endDay?: LocalDateValue | null;
}

export function cruiseReminderContent(
  cruise: CruiseReminderData,
  hoursUntilDeparture: number,
  lang: ReminderLang,
  links: ReminderLinks
): MailContent {
  const de = lang === "de";
  const named = present(cruise.shipName);
  const ship = named ?? (de ? "Dein Schiff" : "Your ship");
  const until = formatHoursUntil(hoursUntilDeparture, lang);

  // A port whose name already is its city ("Kiel", "Kiel") is named once.
  const port = present(cruise.portName);
  const city = present(cruise.portCity);
  const place = joined([port, city && city !== port ? city : null, cruise.portCountry], ", ");

  const rows: MailFact[] = [];
  fact(rows, de ? "Schiff" : "Ship", named);
  fact(rows, de ? "Hafen" : "Port", place);
  fact(rows, de ? "Ablegen" : "Departure", formatTimeValue(cruise.departure, lang));
  fact(rows, de ? "Reederei" : "Cruise line", cruise.cruiseLine);
  fact(rows, "Route", cruise.routeName);
  fact(rows, de ? "Kabine" : "Cabin", joined([cruise.cabinType, cruise.cabinNumber], " "));
  fact(rows, "Deck", cruise.deck);
  fact(
    rows,
    de ? "Rückkehr" : "Return",
    cruise.endDay?.precision === "day" ? formatLocalDate(cruise.endDay.date, lang) : null
  );
  fact(rows, de ? "Buchungscode" : "Booking reference", cruise.bookingReference, true);

  return assemble("cruise", lang, links, {
    subject: de
      ? `Kreuzfahrt-Erinnerung: ${named ?? "Abfahrt"} in ${hoursUntilDeparture}h`
      : `Cruise reminder: ${named ?? "Departure"} in ${hoursUntilDeparture}h`,
    heading: de ? `${ship} legt ${until} ab` : `${ship} departs ${until}`,
    blocks: [{ kind: "facts", rows }],
    path: cruise.tripId ? `trips/${cruise.tripId}` : `cruises/${cruise.id}`,
    zoned: isZoned(cruise.departure),
  });
}

// ─── Rail ───────────────────────────────────────────────────────────────────

export interface RailReminderData {
  id: string;
  tripId: string | null;
  operator: string | null;
  trainCategory: string | null;
  trainNumber: string | null;
  travelClass?: string | null;
  coach: string | null;
  seat: string | null;
  bookingReference?: string | null;
  depStationName: string;
  arrStationName: string;
  departure: TimeValue;
  arrival: TimeValue | null;
}

/** `RailJourney.travelClass` (schemas/rail.ts `RAIL_TRAVEL_CLASSES`), as the app words it. */
const RAIL_CLASS: Record<ReminderLang, Record<string, string>> = {
  de: { first: "1. Klasse", second: "2. Klasse", sleeper: "Schlafwagen", couchette: "Liegewagen" },
  en: { first: "1st class", second: "2nd class", sleeper: "Sleeper", couchette: "Couchette" },
};

export function railReminderContent(
  journey: RailReminderData,
  hoursUntilDeparture: number,
  lang: ReminderLang,
  links: ReminderLinks
): MailContent {
  const de = lang === "de";
  const train = joined([journey.trainCategory, journey.trainNumber], " ");
  const until = formatHoursUntil(hoursUntilDeparture, lang);
  const trainPart = train ? ` ${train}` : "";

  const rows: MailFact[] = [];
  fact(rows, de ? "Zug" : "Train", train, true);
  fact(rows, de ? "Betreiber" : "Operator", journey.operator);
  fact(rows, de ? "Klasse" : "Class", worded(RAIL_CLASS[lang], journey.travelClass));
  fact(rows, de ? "Wagen" : "Coach", journey.coach, true);
  fact(rows, de ? "Platz" : "Seat", journey.seat, true);
  fact(rows, de ? "Buchungscode" : "Booking reference", journey.bookingReference, true);

  return assemble("rail", lang, links, {
    subject: de
      ? `Zug-Erinnerung: ${train ?? journey.depStationName} in ${hoursUntilDeparture}h`
      : `Rail reminder: ${train ?? journey.depStationName} in ${hoursUntilDeparture}h`,
    heading: de
      ? `Deine Zugfahrt${trainPart} startet ${until}`
      : `Your train${trainPart} leaves ${until}`,
    blocks: [
      {
        kind: "route",
        from: { primary: journey.depStationName, time: formatTimeValue(journey.departure, lang) },
        to: { primary: journey.arrStationName, time: formatTimeValue(journey.arrival, lang) },
      },
      { kind: "facts", rows },
    ],
    path: journey.tripId ? `trips/${journey.tripId}` : `rail/${journey.id}`,
    zoned: isZoned(journey.departure) || isZoned(journey.arrival),
  });
}

// ─── Lodging ────────────────────────────────────────────────────────────────

export interface LodgingReminderData {
  /** The stay. */
  id: string;
  /** The property — what `/lodging/:id` opens; a stay has no page of its own. */
  lodgingId: string;
  tripId: string | null;
  lodgingName: string;
  address?: string | null;
  city: string | null;
  country: string | null;
  roomNumber: string | null;
  roomCategory: string | null;
  board?: string | null;
  guests?: number | null;
  /** Null when the span is unknown — never 0 for "unknown". */
  nights?: number | null;
  bookingReference?: string | null;
  checkInAt: TimeValue | null;
  checkInDay: LocalDateValue;
  checkOutDay?: LocalDateValue | null;
}

/** `LodgingStay.board` (schemas/lodging.ts `BOARD_TYPES`), worded as in the app's `lodging:board.*`. */
const BOARD: Record<ReminderLang, Record<string, string>> = {
  de: {
    none: "Ohne Verpflegung",
    breakfast: "Frühstück",
    half: "Halbpension",
    full: "Vollpension",
    all_inclusive: "All-inclusive",
  },
  en: {
    none: "No board",
    breakfast: "Breakfast",
    half: "Half board",
    full: "Full board",
    all_inclusive: "All-inclusive",
  },
};

export function lodgingReminderContent(
  stay: LodgingReminderData,
  lang: ReminderLang,
  links: ReminderLinks
): MailContent {
  const de = lang === "de";
  const name = present(stay.lodgingName) ?? (de ? "deiner Unterkunft" : "your accommodation");

  const rows: MailFact[] = [];
  fact(rows, de ? "Unterkunft" : "Property", present(stay.lodgingName));
  fact(rows, de ? "Adresse" : "Address", stay.address);
  fact(rows, de ? "Ort" : "Location", joined([stay.city, stay.country], ", "));
  fact(
    rows,
    "Check-in",
    formatTimeValue(stay.checkInAt, lang) ?? formatLocalDate(stay.checkInDay.date, lang)
  );
  fact(
    rows,
    "Check-out",
    stay.checkOutDay?.precision === "day" ? formatLocalDate(stay.checkOutDay.date, lang) : null
  );
  fact(rows, de ? "Nächte" : "Nights", stay.nights);
  fact(rows, de ? "Zimmer" : "Room", stay.roomNumber, true);
  fact(rows, de ? "Kategorie" : "Category", stay.roomCategory);
  fact(rows, de ? "Verpflegung" : "Board", worded(BOARD[lang], stay.board));
  fact(rows, de ? "Gäste" : "Guests", stay.guests);
  fact(rows, de ? "Buchungscode" : "Booking reference", stay.bookingReference, true);

  return assemble("lodging", lang, links, {
    subject: de ? `Check-in heute: ${stay.lodgingName}` : `Check-in today: ${stay.lodgingName}`,
    heading: de ? `Heute Check-in bei ${name}` : `Check-in today at ${name}`,
    blocks: [{ kind: "facts", rows }],
    path: stay.tripId ? `trips/${stay.tripId}` : `lodging/${stay.lodgingId}`,
    zoned: isZoned(stay.checkInAt),
  });
}
