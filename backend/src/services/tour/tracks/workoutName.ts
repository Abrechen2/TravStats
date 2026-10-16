import { toLocal } from "../../../shared/time/instant";
import { zoneOf } from "../../../shared/time/zoneOf";
import { firstVertex } from "../tourDay";

/**
 * The clock in a workout's generated name, read where the workout happened.
 *
 * The Companion names an imported workout "Wanderung am 28.05.2026, 14:10" —
 * activity, date, start time — and it can only read that clock in the zone it
 * knows, the phone's profile zone: it has no coordinate-to-zone lookup. Two
 * hikes imported on 2026-10-09 while the phone was in Seoul (UTC+9) were
 * recorded in Madagascar (UTC+3) and carry the Seoul clock: a walk that began
 * at 08:10 on the trail is named 14:10, and the tour list says so forever.
 *
 * The server can answer it: the track's first point has a zone (geo-tz's full
 * dataset, `shared/time/zoneOf`). So a workout upload rewrites the date and
 * time at the END of its name — and only when they read as the track's start
 * instant on some UTC offset (a whole quarter hour, at most 14 h away), which
 * is what makes the suffix the generated clock and not a name the user wrote.
 * The date keeps the layout it came in (DD.MM.YYYY, MM/DD/YYYY, DD/MM/YYYY,
 * YYYY-MM-DD) and the field widths.
 */

const MINUTE_MS = 60_000;
const QUARTER_HOUR_MS = 15 * MINUTE_MS;
const MAX_OFFSET_MS = 14 * 60 * MINUTE_MS;

/** `<date>, <HH:MM>` at the end of a name. */
const TRAILING_CLOCK = /(\d{1,4})([./-])(\d{1,2})\2(\d{1,4}), (\d{1,2}):(\d{2})$/;

type Order = "dmy" | "mdy" | "ymd";

interface Reading {
  order: Order;
  year: number;
  month: number;
  day: number;
}

function readings(a: string, sep: string, b: string, c: string): Reading[] {
  const [x, y, z] = [Number(a), Number(b), Number(c)];
  if (sep === "-") return a.length === 4 ? [{ order: "ymd", year: x, month: y, day: z }] : [];
  if (c.length !== 4) return [];
  if (sep === ".") return [{ order: "dmy", year: z, month: y, day: x }];
  return [
    { order: "dmy", year: z, month: y, day: x },
    { order: "mdy", year: z, month: x, day: y },
  ];
}

function isRealDay(r: Reading): boolean {
  if (r.month < 1 || r.month > 12 || r.day < 1) return false;
  const d = new Date(Date.UTC(r.year, r.month - 1, r.day));
  return d.getUTCMonth() === r.month - 1 && d.getUTCDate() === r.day;
}

const pad = (value: string, like: string) => value.padStart(like.length, "0");

/**
 * The name with its trailing date and time re-read in `zone`, or null when
 * there is nothing to change: no trailing clock, a clock that is not the
 * track's start on any offset, or one that already shows the place's time.
 */
export function relocalizedWorkoutName(name: string, startedAt: Date, zone: string): string | null {
  const match = TRAILING_CLOCK.exec(name);
  if (!match) return null;
  const [whole, a, sep, b, c, hh, mm] = match;
  const startMinute = Math.floor(startedAt.getTime() / MINUTE_MS) * MINUTE_MS;
  const reading = readings(a, sep, b, c).find((r) => {
    if (!isRealDay(r)) return false;
    const wall = Date.UTC(r.year, r.month - 1, r.day, Number(hh), Number(mm));
    const offset = wall - startMinute;
    return Math.abs(offset) <= MAX_OFFSET_MS && offset % QUARTER_HOUR_MS === 0;
  });
  if (!reading) return null;

  const local = toLocal(startedAt, zone).local; // YYYY-MM-DDTHH:mm:ss
  const [year, month, day] = [local.slice(0, 4), local.slice(5, 7), local.slice(8, 10)];
  const date =
    reading.order === "ymd"
      ? `${year}-${month}-${day}`
      : reading.order === "dmy"
        ? `${pad(String(Number(day)), a)}${sep}${pad(String(Number(month)), b)}${sep}${year}`
        : `${pad(String(Number(month)), a)}${sep}${pad(String(Number(day)), b)}${sep}${year}`;
  const clock = `${pad(String(Number(local.slice(11, 13))), hh)}:${local.slice(14, 16)}`;
  const renamed = `${name.slice(0, name.length - whole.length)}${date}, ${clock}`;
  return renamed === name ? null : renamed;
}

/**
 * `relocalizedWorkoutName` for a stored or just-ingested track: the zone is
 * the one at its first point. Null when the name needs nothing, or the point
 * has no zone (then the clock cannot be read honestly, and the name stays).
 */
export function relocalizedTrackName(
  name: string | null,
  startedAt: Date,
  geometry: unknown
): string | null {
  if (!name) return null;
  const at = firstVertex(geometry);
  const zone = at ? zoneOf(at) : null;
  return zone ? relocalizedWorkoutName(name, startedAt, zone) : null;
}
