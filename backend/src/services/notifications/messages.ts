import type { FlightChange } from "../flightAutoUpdate";

/**
 * The words of a push (TravStats#156). Written here, in the phone's
 * language (DE primary, EN mirrored), then sealed for that phone alone — the
 * relay, Apple and Google never see them.
 *
 * Times follow the time model (ADR 0002): a real instant is shown in the
 * zone the flight was written with ("Ortszeit FRA"); with no zone it says
 * "UTC" instead of guessing one. That covers every value the provider
 * reports — it is always a real UTC instant, whatever the stored row's
 * semantics. The row's own time is read by its semantics: a legacy wall
 * clock stored as fake UTC is shown as the wall clock it is, and a
 * date-only time has no time of day, so none is shown.
 */
export type Locale = "de" | "en";

export type FlightForMessage = {
  id: string;
  flightNumber: string | null;
  depIata: string | null;
  arrIata: string | null;
  depTimezone: string | null;
  arrTimezone: string | null;
  depTimeSemantics: string;
  arrTimeSemantics: string;
};

export type Message = { title: string; body: string };

const COPY = {
  de: {
    gate: "neues Gate",
    terminal: "neues Terminal",
    departure: "neue Abflugzeit",
    arrival: "neue Ankunftszeit",
    departureAirport: "neuer Abflughafen",
    arrivalAirport: "neues Ziel",
    cancelled: "annulliert",
    diverted: "umgeleitet",
    several: "Änderungen",
    instead: "statt",
    localAt: (iata: string) => `Ortszeit ${iata}`,
    local: "Ortszeit",
    cancelledBody: "Laut Airline-Daten fällt der Flug aus.",
    divertedTo: (iata: string) => `Neues Ziel: ${iata}`,
    divertedBody: "Der Flug wurde umgeleitet.",
    departureAirportTo: (iata: string) => `Neuer Abflughafen: ${iata}`,
    confirm: " — in TravStats bestätigen",
    reminder: (hours: number) => `Abflug in ${hours} Stunden`,
  },
  en: {
    gate: "new gate",
    terminal: "new terminal",
    departure: "new departure time",
    arrival: "new arrival time",
    departureAirport: "new departure airport",
    arrivalAirport: "new destination",
    cancelled: "cancelled",
    diverted: "diverted",
    several: "changes",
    instead: "instead of",
    localAt: (iata: string) => `local time ${iata}`,
    local: "local time",
    cancelledBody: "According to airline data the flight is cancelled.",
    divertedTo: (iata: string) => `New destination: ${iata}`,
    divertedBody: "The flight was diverted.",
    departureAirportTo: (iata: string) => `New departure airport: ${iata}`,
    confirm: " — confirm in TravStats",
    reminder: (hours: number) => `departs in ${hours} hours`,
  },
} as const;

function label(flight: FlightForMessage): string {
  return flight.flightNumber || `${flight.depIata ?? "?"} → ${flight.arrIata ?? "?"}`;
}

/** Where a time came from: the provider (a real instant) or the stored row (its semantics). */
type Source = "provider" | "stored";

/** "13:25" plus how to read it, for one end of the flight; null when there is no time to show. */
function clock(
  value: unknown,
  end: "dep" | "arr",
  flight: FlightForMessage,
  locale: Locale,
  source: Source
): { time: string; zone: string } | null {
  if (value === null || value === undefined || value === "") return null;
  const date = new Date(value as string | number);
  if (Number.isNaN(date.getTime())) return null;
  const semantics =
    source === "provider"
      ? "UTC"
      : end === "dep"
        ? flight.depTimeSemantics
        : flight.arrTimeSemantics;
  if (semantics === "DATE_ONLY") return null;
  const tz = end === "dep" ? flight.depTimezone : flight.arrTimezone;
  const iata = end === "dep" ? flight.depIata : flight.arrIata;
  const c = COPY[locale];
  // A fake-UTC value read as UTC shows exactly its wall clock at the airport.
  const wallClock = semantics === "LEGACY_FAKE_UTC";
  const timeZone = wallClock || !tz ? "UTC" : tz;
  let time: string;
  try {
    time = new Intl.DateTimeFormat(locale === "de" ? "de-DE" : "en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
      timeZone,
    }).format(date);
  } catch {
    return null;
  }
  const local = iata ? c.localAt(iata) : c.local;
  const zone = wallClock ? (tz ? local : c.local) : tz ? local : "UTC";
  return { time, zone };
}

type Part = { title: string; body: string };

function partFor(change: FlightChange, flight: FlightForMessage, locale: Locale): Part | null {
  const c = COPY[locale];
  const was = (v: unknown) => (v === null || v === undefined || v === "" ? null : String(v));
  switch (change.field) {
    case "gate": {
      const old = was(change.oldValue);
      const now = was(change.newValue);
      if (!now) return null;
      return { title: c.gate, body: old ? `${now} ${c.instead} ${old}` : `Gate ${now}` };
    }
    case "terminal": {
      const old = was(change.oldValue);
      const now = was(change.newValue);
      if (!now) return null;
      return {
        title: c.terminal,
        body: old ? `Terminal ${now} ${c.instead} ${old}` : `Terminal ${now}`,
      };
    }
    case "departureTime":
    case "arrivalTime": {
      const end = change.field === "departureTime" ? "dep" : "arr";
      const now = clock(change.newValue, end, flight, locale, "provider");
      if (!now) return null;
      const old = clock(change.oldValue, end, flight, locale, "stored");
      // A legacy row can read as the very clock the provider reports: not a change.
      if (old && old.time === now.time && old.zone === now.zone) return null;
      const body = !old
        ? `${now.time} (${now.zone})`
        : old.zone === now.zone
          ? `${now.time} ${c.instead} ${old.time} (${now.zone})`
          : `${now.time} (${now.zone}) ${c.instead} ${old.time} (${old.zone})`;
      return { title: end === "dep" ? c.departure : c.arrival, body };
    }
    case "depIata": {
      const now = was(change.newValue);
      return now ? { title: c.departureAirport, body: c.departureAirportTo(now) } : null;
    }
    case "arrIata": {
      const now = was(change.newValue);
      return now ? { title: c.arrivalAirport, body: c.divertedTo(now) } : null;
    }
    default:
      return null;
  }
}

/**
 * The push for a detected change, or null when nothing in it is worth a
 * notification (aircraft type, route geometry, …).
 */
export function flightChangedMessage(
  flight: FlightForMessage,
  changes: readonly FlightChange[],
  opts: { pending: boolean; cancelled?: boolean; diverted?: boolean },
  locale: Locale
): Message | null {
  const c = COPY[locale];
  const name = label(flight);
  const suffix = opts.pending ? c.confirm : "";

  const cancelled =
    opts.cancelled === true ||
    changes.some((ch) => ch.field === "status" && ch.newValue === "cancelled");
  if (cancelled) return { title: `${name}: ${c.cancelled}`, body: c.cancelledBody + suffix };

  if (opts.diverted) {
    const to = changes.find((ch) => ch.field === "arrIata")?.newValue;
    return {
      title: `${name}: ${c.diverted}`,
      body: (to ? c.divertedTo(String(to)) : c.divertedBody) + suffix,
    };
  }

  const parts = changes
    .map((ch) => partFor(ch, flight, locale))
    .filter((p): p is Part => p !== null);
  if (parts.length === 0) return null;
  if (parts.length === 1)
    return { title: `${name}: ${parts[0].title}`, body: parts[0].body + suffix };
  return { title: `${name}: ${c.several}`, body: parts.map((p) => p.body).join(" · ") + suffix };
}

/** The departure reminder, 24 h or 2 h before. */
export function reminderMessage(
  flight: FlightForMessage & { departureTime: Date },
  hoursAhead: 24 | 2,
  locale: Locale
): Message {
  const c = COPY[locale];
  const at = clock(flight.departureTime.toISOString(), "dep", flight, locale, "stored");
  const route = `${flight.depIata ?? "?"} → ${flight.arrIata ?? "?"}`;
  const when = at ? ` · ${at.time} ${at.zone === "UTC" ? "UTC" : c.local}` : "";
  return { title: `${label(flight)}: ${c.reminder(hoursAhead)}`, body: route + when };
}
