/**
 * The time shapes the API speaks (ADR 0002, D3), and how the web shows them.
 *
 * MIRRORED at backend/src/shared/time — change both together.
 *
 * The server sends every time field as `{ utc, zone, offset, local, precision }`.
 * The web DISPLAYS `local` as it is and uses `utc` only to sort and to measure
 * durations; it computes no zone. That is also why `formatTimeValue` cannot
 * fail on a zone the browser does not know (a newer tzdata on the server): it
 * never looks the zone up.
 */

/** How much of a time the source actually knew. */
export type TimePrecision = "minute" | "day" | "month" | "year" | "unknown";

/** An instant at a place, as the server sends it. */
export interface TimeValue {
  /** The instant, ISO 8601 with `Z`. Sort and measure with this only. */
  utc: string;
  /** IANA zone of the place, or null where none could be resolved. */
  zone: string | null;
  /** Offset in force at that instant, e.g. `+02:00`. */
  offset: string;
  /** Wall clock at the place, `YYYY-MM-DDTHH:mm:ss`. Display this. */
  local: string;
  precision: TimePrecision;
  /**
   * `stored`: the zone was frozen with the value (D2). `catalogue`: an old
   * flight read in today's airport catalogue zone. Null with `zone: null`.
   * Optional: the web's own legacy readers (`legacy.ts`) do not set it.
   */
  zoneSource?: "stored" | "catalogue" | null;
}

/** A calendar day, as the place knew it (a stay night, a cruise day). */
export interface LocalDateValue {
  /** `YYYY-MM-DD`. */
  date: string;
  /** The zone the day belongs to; null for a floating date (a birthday). */
  zone: string | null;
  precision: TimePrecision;
}

/** What a client sends for a wall clock typed by a person (D3 "in"). */
export interface LocalTimeInput {
  local: string;
  zone?: string;
  placeRef?: { kind: string; id: string };
  fold?: "earlier" | "later";
}

const LOCAL_PATTERN = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?)?$/;

interface LocalComponents {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  hasTime: boolean;
}

function parseLocal(local: string): LocalComponents | null {
  const match = LOCAL_PATTERN.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match;
  return {
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: h === undefined ? 0 : Number(h),
    minute: mi === undefined ? 0 : Number(mi),
    hasTime: h !== undefined,
  };
}

/**
 * What a TimeValue shows, as strings and cut to its precision: `date` is
 * `YYYY-MM-DD`, `YYYY-MM` or `YYYY`; `time` (`HH:mm`) and `offset` only for
 * a minute-precise value. Taken from the payload's own `local`/`offset`, so a
 * zone the browser does not know changes nothing. This is the part the shared
 * vectors pin (op `display`); `formatTimeValue` only dresses it in a locale.
 */
export interface DisplayParts {
  date: string;
  time: string | null;
  offset: string | null;
}

const pad = (n: number, width = 2): string => String(n).padStart(width, "0");

function effectivePrecision(value: TimeValue, parsed: LocalComponents): TimePrecision {
  return value.precision === "minute" && !parsed.hasTime ? "day" : value.precision;
}

/** Null only for a `local` that is not a wall clock at all. */
export function displayParts(value: TimeValue): DisplayParts | null {
  const parsed = parseLocal(value.local);
  if (!parsed) return null;
  const year = pad(parsed.year, 4);
  const month = `${year}-${pad(parsed.month)}`;
  switch (effectivePrecision(value, parsed)) {
    case "minute":
      return {
        date: `${month}-${pad(parsed.day)}`,
        time: `${pad(parsed.hour)}:${pad(parsed.minute)}`,
        offset: value.offset,
      };
    case "month":
      return { date: month, time: null, offset: null };
    case "year":
      return { date: year, time: null, offset: null };
    default:
      // "day", and "unknown" (Q4: the date is kept, the time of day is not shown).
      return { date: `${month}-${pad(parsed.day)}`, time: null, offset: null };
  }
}

const DISPLAY_OPTIONS: Record<TimePrecision, Intl.DateTimeFormatOptions> = {
  minute: { dateStyle: "medium", timeStyle: "short" },
  day: { dateStyle: "medium" },
  // Q4: a visit whose time of day cannot be established keeps its date only.
  unknown: { dateStyle: "medium" },
  month: { year: "numeric", month: "long" },
  year: { year: "numeric" },
};

/**
 * `value.local` in the reader's language, cut to its precision. The wall
 * clock components are placed on a UTC instant and formatted in UTC, so the
 * browser's own zone cannot move them and the zone name is never consulted.
 * A `local` the parser does not recognise is returned as sent rather than
 * replaced by a guess.
 */
export function formatTimeValue(value: TimeValue, locale: string): string {
  const parsed = parseLocal(value.local);
  if (!parsed) return value.local;
  const precision = effectivePrecision(value, parsed);
  const at = new Date(
    Date.UTC(parsed.year, parsed.month - 1, parsed.day, parsed.hour, parsed.minute)
  );
  return new Intl.DateTimeFormat(locale, { ...DISPLAY_OPTIONS[precision], timeZone: "UTC" }).format(
    at
  );
}
