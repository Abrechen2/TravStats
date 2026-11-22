/**
 * The clock times a boarding pass PRINTS — departure, arrival, boarding — read
 * from OCR text without a language model.
 *
 * A BCBP barcode carries a day of the year and no clock at all, so after a
 * barcode hit the departure time used to stay at the date-only placeholder
 * `T00:00`, and the only reader that ever filled it was the LLM. The pass that
 * prompted this (United, 2016) prints all of it in plain words:
 *
 *     Boarding Begins 12:01 PM   Flight Departs: 12:46 PM   Flight Arrives: 2:49 PM
 *
 * Labels are matched loosely because Tesseract reads thin dot-matrix print as
 * "Flight Departls", "Flight Arriv" or "9:50 AN"; a time must sit on the SAME
 * line, a few characters after its label, so a column heading with no time
 * next to it reads nothing rather than borrowing a clock from elsewhere.
 *
 * Abstains rather than guesses: no label, no time. The boarding time is never
 * taken as the departure time — it is the other clock printed beside the date,
 * which is exactly the mistake this file must not make.
 */

export interface PrintedDate {
  readonly month: number;
  readonly day: number;
  readonly year?: number;
}

export interface PrintedTimes {
  /** "YYYY-MM-DD" when a full date (with year) is printed; month+day otherwise lacks a year. */
  readonly date?: PrintedDate;
  /** Every date printed, in reading order — the issue date may come first. */
  readonly dates: readonly PrintedDate[];
  /** A year printed beside a month even where the day was unreadable ("JAN 2016"). */
  readonly yearsByMonth: ReadonlyMap<number, number>;
  readonly boarding?: string;
  readonly departure?: string;
  readonly arrival?: string;
}

const MONTHS: Record<string, number> = {
  JAN: 1,
  FEB: 2,
  MAR: 3,
  MÄR: 3,
  MRZ: 3,
  APR: 4,
  MAY: 5,
  MAI: 5,
  JUN: 6,
  JUL: 7,
  AUG: 8,
  SEP: 9,
  OCT: 10,
  OKT: 10,
  NOV: 11,
  DEC: 12,
  DEZ: 12,
};
const MONTH_RE = Object.keys(MONTHS).join("|");

/**
 * "12:46 PM", "9:50 AN" (OCR for AM), "17.50"; "0950" is NOT accepted (too
 * ambiguous). A lone "A"/"P" is not a meridiem: OCR turned "5:50 PM" into
 * "5:50 A 3" on the United pass, and the anchors below read it right.
 */
const TIME = String.raw`(\d{1,2})\s?[:.]\s?(\d{2})(?:\s?([AaPp])\.?\s?[MmNn]\.?(?![A-Za-z]))?`;
/** At most this many non-digit characters between a label and its time. */
const GAP = String.raw`[^\d\n]{0,18}?`;

const LABELS = {
  departure: String.raw`(?:fl\w{0,3}ght\s*)?dep\w{0,6}|abflug\w{0,4}|departure\s*time|std\b`,
  arrival: String.raw`(?:fl\w{0,3}ght\s*)?arr\w{0,6}|ankunft\w{0,4}|sta\b`,
  // "Boarding Ends", "Boarding Group/Gruppe" and "Boarding Pass" are other things.
  boarding: String.raw`boarding(?!\s*(?:end|grou|grp|gru|pass|zone))(?:\s*(?:begins?|time|starts?|zeit))?|einstieg\w{0,4}`,
  // A second anchor for a lost AM/PM: the departure follows these by minutes.
  boardingEnds: String.raw`boarding\s*end\w{0,2}|gate\s*clos\w{0,4}|gate\s*schlie\w{0,6}`,
} as const;

interface Clock {
  readonly hour: number;
  readonly minute: number;
  /** "A" / "P" when printed, undefined on a 24-hour pass. */
  readonly meridiem?: "A" | "P";
}

function findClock(text: string, label: string): Clock | undefined {
  const re = new RegExp(`\\b(?:${label})${GAP}${TIME}`, "i");
  const m = text.match(re);
  if (!m) return undefined;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return undefined;
  const meridiem = m[3] ? (m[3].toUpperCase() as "A" | "P") : undefined;
  if (meridiem && (hour < 1 || hour > 12)) return undefined;
  return { hour, minute, ...(meridiem ? { meridiem } : {}) };
}

/** 12 PM is noon, 12 AM midnight; a bare clock is 24-hour. */
function to24(c: Clock): number {
  if (c.meridiem === "P") return c.hour === 12 ? 12 : c.hour + 12;
  if (c.meridiem === "A") return c.hour === 12 ? 0 : c.hour;
  return c.hour;
}

const fmt = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const MAX_BOARDING_LEAD_MIN = 180;
const MAX_BOARDING_END_LEAD_MIN = 60;

interface Anchor {
  readonly at: number;
  readonly maxLead: number;
}

/**
 * A clock whose AM/PM the OCR lost, on a pass that prints AM/PM elsewhere:
 * departure follows boarding (and boarding's end) by minutes, never by hours,
 * so of the two readings take the one that fits an anchor. UA 952 read as
 * "Flight Departs 5:50" beside "Boarding Ends: 5:35 PM" is 17:50. With no
 * anchor the clock stays as printed (24-hour reading).
 */
function resolveAgainst(c: Clock, anchors: readonly Anchor[], uses12h: boolean): number {
  const direct = to24(c) * 60 + c.minute;
  if (c.meridiem || !uses12h || anchors.length === 0 || c.hour > 12) return direct;
  const candidates = [c.hour % 12, (c.hour % 12) + 12].map((h) => h * 60 + c.minute);
  for (const anchor of anchors) {
    const fit = candidates.find((m) => m - anchor.at >= 0 && m - anchor.at <= anchor.maxLead);
    if (fit !== undefined) return fit;
  }
  return direct;
}

function findDates(text: string): PrintedDate[] {
  const out: PrintedDate[] = [];
  const re = new RegExp(
    String.raw`\b(\d{1,2})\s?(${MONTH_RE})[A-Z]*\.?\s?(\d{4}|\d{2}(?!\s?[:.]\d))?`,
    "gi"
  );
  for (const m of text.matchAll(re)) {
    const day = Number(m[1]);
    const month = MONTHS[m[2].toUpperCase()];
    if (day < 1 || day > 31 || !month) continue;
    const year = m[3] ? expandYear(m[3]) : undefined;
    out.push({ day, month, ...(year ? { year } : {}) });
  }
  for (const m of text.matchAll(/\b(20\d{2})-(\d{2})-(\d{2})\b/g)) {
    out.push({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) });
  }
  for (const m of text.matchAll(/\b(\d{1,2})\.(\d{1,2})\.(20\d{2})\b/g)) {
    out.push({ day: Number(m[1]), month: Number(m[2]), year: Number(m[3]) });
  }
  return out;
}

/** A plausible flight year only: OCR reads "2016" as "2816" often enough. */
function expandYear(raw: string): number | undefined {
  const y = raw.length === 2 ? 2000 + Number(raw) : Number(raw);
  const now = new Date().getUTCFullYear();
  return y >= 1990 && y <= now + 2 ? y : undefined;
}

function yearsByMonth(text: string): Map<number, number> {
  const out = new Map<number, number>();
  const re = new RegExp(String.raw`(${MONTH_RE})[A-Z]*\.?\s?(\d{4})\b`, "gi");
  for (const m of text.matchAll(re)) {
    const month = MONTHS[m[1].toUpperCase()];
    const year = expandYear(m[2]);
    if (month && year && !out.has(month)) out.set(month, year);
  }
  return out;
}

export function readPrintedTimes(text: string): PrintedTimes {
  const uses12h = /\d\s?[AP]\.?\s?M\b/i.test(text);
  const boardingClock = findClock(text, LABELS.boarding);
  const boarding = boardingClock ? to24(boardingClock) * 60 + boardingClock.minute : undefined;
  const endsClock = findClock(text, LABELS.boardingEnds);
  const anchors: Anchor[] = [
    ...(boarding !== undefined ? [{ at: boarding, maxLead: MAX_BOARDING_LEAD_MIN }] : []),
    // Only an end time with its own AM/PM can anchor a clock that lost one.
    ...(endsClock?.meridiem
      ? [{ at: to24(endsClock) * 60 + endsClock.minute, maxLead: MAX_BOARDING_END_LEAD_MIN }]
      : []),
  ];
  const depClock = findClock(text, LABELS.departure);
  const departure = depClock ? resolveAgainst(depClock, anchors, uses12h) : undefined;
  const arrClock = findClock(text, LABELS.arrival);
  const arrival = arrClock ? to24(arrClock) * 60 + arrClock.minute : undefined;
  const dates = findDates(text);
  return {
    ...(dates[0] ? { date: dates[0] } : {}),
    dates,
    yearsByMonth: yearsByMonth(text),
    ...(boarding !== undefined ? { boarding: fmt(boarding) } : {}),
    ...(departure !== undefined ? { departure: fmt(departure) } : {}),
    ...(arrival !== undefined ? { arrival: fmt(arrival) } : {}),
  };
}

/** "2016-01-08" + n days, in pure calendar arithmetic (no host zone). */
export function addDays(isoDate: string, days: number): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/**
 * Departure and arrival as local "YYYY-MM-DDTHH:mm" on a known flight date.
 * An arrival clock earlier than the departure clock lands the next day — a
 * pass prints the clock, never the arrival date (UA 952: departs 17:50,
 * arrives 09:50, on the 9th).
 */
export function legTimesOn(
  flightDate: string,
  times: Pick<PrintedTimes, "departure" | "arrival">
): { departureTime?: string; arrivalTime?: string } {
  const out: { departureTime?: string; arrivalTime?: string } = {};
  if (times.departure) out.departureTime = `${flightDate}T${times.departure}`;
  if (times.arrival) {
    const rolls = times.departure !== undefined && times.arrival < times.departure;
    out.arrivalTime = `${rolls ? addDays(flightDate, 1) : flightDate}T${times.arrival}`;
  }
  return out;
}
