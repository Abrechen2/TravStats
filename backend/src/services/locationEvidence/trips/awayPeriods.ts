/**
 * Away periods (TravTrack plan L4): which local days TravTrack saw the user
 * away from home, read from the account's stored TravTrack history through
 * the one derivation read (E2) — so privacy zones, zone tombstones and deleted
 * ranges are already out, masked fixes are dropped and fixes inside a flight's
 * air time are marked, and they count for nothing here.
 *
 * A day is named in the zone of the residence the user had that day (the home
 * period's zone; the profile zone where the residence has none); a fix belongs
 * to the period whose own local days hold it (`confirmedHomes`). A day is
 *   - `away` when more than half of its ground fixes lie more than `AWAY_KM`
 *     from that day's CONFIRMED residence (`loadHomePeriods`),
 *   - `home` when at least half lie within it,
 *   - `unknown` when it has no ground fix, or no confirmed residence to
 *     measure from. Absence of data is not presence (review focus 27): an
 *     unknown day is never home, and it never joins two runs.
 *
 * A run is a block of consecutive away days, kept when it holds at least two
 * days or one away night — the night before (the previous day's last fix and
 * this day's first are away) or after. An away night also stretches the run
 * over the day it began or ended on: a trip left on an evening starts that
 * day.
 *
 * Without any confirmed residence nothing is inferred (`noResidence`): a home
 * migrated from the old airport list is the airport, not where the user lives.
 */
import { localDay } from "../../../shared/time/instant";
import { profileZoneOf } from "../../../shared/time/profileZone";
import { zoneOfCoordinates } from "../../../shared/time/resolveInput";
import { periodAt, type HomePeriod } from "../../../utils/homeAirport";
import { getCountryResolver } from "../../geo/countryFromCoordinates";
import { loadHomePeriods } from "../../home/homeStore";
import type { Coverage } from "../../locationProvider/types";
import { distanceM } from "../../travtrack/classify";
import { readTravTrackDerivation } from "../derivationRead";

/** Further than this from the residence is away. */
export const AWAY_KM = 50;
const DAY_MS = 86_400_000;

export type DayState = "away" | "home" | "unknown";

export type AwayPoint = { atMs: number; lat: number; lon: number; inFlight: boolean };

/** The confirmed residence on a local day, with the zone that day is named in. */
export type HomeAt = (day: string) => { lat: number; lon: number; zone: string } | null;

export type AwayDay = {
  day: string;
  zone: string;
  state: DayState;
  /** Ground fixes of the day. */
  pointCount: number;
  /** Whether the day's first / last ground fix was away; null on an unknown day. */
  firstAway: boolean | null;
  lastAway: boolean | null;
  /** The farthest ground fix from the residence, km; 0 on an unknown day. */
  maxKm: number;
  /** Countries of the day's away fixes (ISO alpha-2), sorted. */
  countries: string[];
};

export type AwayRun = {
  /** The trip's span: the away days, stretched over a day an away night began or ended on. */
  fromDay: string;
  toDay: string;
  zone: string;
  awayDays: string[];
  /** The farthest any away day took the user from the residence, km, rounded. */
  km: number;
  countries: string[];
  /** The run touches the first / last day read: it may have begun before / go on after it. */
  openStart: boolean;
  openEnd: boolean;
};

export type AwayRead =
  | { status: "noResidence" }
  | { status: "cancelled" }
  | {
      status: "ok";
      days: AwayDay[];
      runs: AwayRun[];
      generation: bigint;
      coverage: Coverage;
    };

/** `day` moved by `n` calendar days (`YYYY-MM-DD`). */
export function shiftDay(day: string, n: number): string {
  return new Date(Date.parse(`${day}T00:00:00.000Z`) + n * DAY_MS).toISOString().slice(0, 10);
}

/** Every day from `from` to `to`, both included. */
export function dayRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = shiftDay(d, 1)) out.push(d);
  return out;
}

const unknownDay = (day: string, zone: string): AwayDay => ({
  day,
  zone,
  state: "unknown",
  pointCount: 0,
  firstAway: null,
  lastAway: null,
  maxKm: 0,
  countries: [],
});

/** Which local day a fix belongs to. */
export type DayOf = (atMs: number) => string;

/** Pure: `days` classified from `points` (any order). */
export function classifyDays(
  points: readonly AwayPoint[],
  days: readonly string[],
  homeAt: HomeAt,
  opts: {
    fallbackZone: string;
    countryAt?: (lat: number, lon: number) => string | null;
    /** The day a fix belongs to; the fallback zone's day unless the homes say (`confirmedHomes`). */
    dayOf?: DayOf;
  }
): AwayDay[] {
  const byDay = new Map<string, AwayPoint[]>();
  const ground = points.filter((p) => !p.inFlight).sort((a, b) => a.atMs - b.atMs);
  const dayOf = opts.dayOf ?? ((atMs: number) => localDay(new Date(atMs), opts.fallbackZone));
  for (const p of ground) {
    const d = dayOf(p.atMs);
    const list = byDay.get(d);
    if (list) list.push(p);
    else byDay.set(d, [p]);
  }
  return days.map((day) => {
    const home = homeAt(day);
    const zone = home?.zone ?? opts.fallbackZone;
    const list = byDay.get(day) ?? [];
    if (!home || list.length === 0) return unknownDay(day, zone);
    const km = list.map((p) => distanceM(p, home) / 1000);
    const away = km.map((k) => k > AWAY_KM);
    const awayCount = away.filter(Boolean).length;
    const countries = new Set<string>();
    if (opts.countryAt) {
      list.forEach((p, i) => {
        const code = away[i] ? opts.countryAt?.(p.lat, p.lon) : null;
        if (code) countries.add(code);
      });
    }
    return {
      day,
      zone,
      state: awayCount * 2 > list.length ? "away" : "home",
      pointCount: list.length,
      firstAway: away[0],
      lastAway: away[away.length - 1],
      maxKm: Math.max(...km),
      countries: [...countries].sort(),
    };
  });
}

/** Whether the night between two consecutive known days was spent away. */
const awayNight = (before: AwayDay | undefined, after: AwayDay | undefined) =>
  !!before &&
  !!after &&
  before.state !== "unknown" &&
  after.state !== "unknown" &&
  before.lastAway === true &&
  after.firstAway === true;

/** Pure: the runs of away days in `days` (consecutive, oldest first). */
export function awayRuns(days: readonly AwayDay[]): AwayRun[] {
  const runs: AwayRun[] = [];
  for (let i = 0; i < days.length; i++) {
    if (days[i].state !== "away") continue;
    let j = i;
    while (j + 1 < days.length && days[j + 1].state === "away") j++;
    const block = days.slice(i, j + 1);
    const nightBefore = awayNight(days[i - 1], days[i]);
    const nightAfter = awayNight(days[j], days[j + 1]);
    if (block.length >= 2 || nightBefore || nightAfter) {
      runs.push({
        fromDay: nightBefore ? days[i - 1].day : days[i].day,
        toDay: nightAfter ? days[j + 1].day : days[j].day,
        zone: days[i].zone,
        awayDays: block.map((d) => d.day),
        km: Math.round(Math.max(...block.map((d) => d.maxKm))),
        countries: [...new Set(block.flatMap((d) => d.countries))].sort(),
        openStart: i === 0,
        openEnd: j === days.length - 1,
      });
    }
    i = j;
  }
  return runs;
}

export type Homes = {
  /** The confirmed residence on a local day, with that day's zone. */
  at: HomeAt;
  /**
   * The local day a fix belongs to: the day, in a home period's OWN zone,
   * that the period holds (`[fromDate, toDate)`). Around a move between zones
   * the fix's UTC date can name the other period — the evening of a Honolulu
   * day is already the next UTC date — so the period is chosen by its own
   * local-day boundaries. A fix no period holds (the hours a move skips) is
   * named in the profile zone.
   */
  dayOf: DayOf;
};

const covers = (p: HomePeriod, day: string) =>
  p.fromDate <= day && (p.toDate === null || day < p.toDate);

/** The confirmed residences of an account, or null when it has none at all. */
export function confirmedHomes(periods: readonly HomePeriod[], fallbackZone: string): Homes | null {
  if (!periods.some((p) => p.residenceConfirmed && p.residence)) return null;
  const zoneOf = (p: HomePeriod | null) =>
    (p?.residence && zoneOfCoordinates(p.residence.lat, p.residence.lon)) || fallbackZone;
  const zones = periods.map((p) => ({ period: p, zone: zoneOf(p) }));
  return {
    at: (day) => {
      const period = periodAt(periods, day);
      const residence = period?.residenceConfirmed ? period.residence : null;
      if (!residence) return null;
      return { lat: residence.lat, lon: residence.lon, zone: zoneOf(period) };
    },
    dayOf: (atMs) => {
      for (const { period, zone } of zones) {
        const day = localDay(new Date(atMs), zone);
        if (covers(period, day)) return day;
      }
      return localDay(new Date(atMs), fallbackZone);
    },
  };
}

/**
 * "Today" as the account's home names it: the local day, in the zone of the
 * home period that holds this instant, that `nowMs` falls on — so "finished
 * days" are counted on the same clock the days are classified on. Null
 * without a confirmed residence.
 */
export async function homeToday(userId: string, nowMs: number): Promise<string | null> {
  const { zone: fallbackZone } = await profileZoneOf(userId);
  return confirmedHomes(await loadHomePeriods(userId), fallbackZone)?.dayOf(nowMs) ?? null;
}

/**
 * The away days and runs over the local days `[fromDay, untilDay]`. A read
 * that stopped early (truncated) leaves every day from its last fix on
 * `unknown`: a day read in part is not judged.
 */
export async function awayPeriods(
  userId: string,
  window: { fromDay: string; untilDay: string },
  opts: { isAllowed?: () => Promise<boolean> } = {}
): Promise<AwayRead> {
  const { zone: fallbackZone } = await profileZoneOf(userId);
  const homes = confirmedHomes(await loadHomePeriods(userId), fallbackZone);
  if (!homes) return { status: "noResidence" };
  // A UTC day either side: a local day of any zone lies inside.
  const read = await readTravTrackDerivation(
    userId,
    {
      fromMs: Date.parse(`${window.fromDay}T00:00:00.000Z`) - DAY_MS,
      untilMs: Date.parse(`${window.untilDay}T00:00:00.000Z`) + 2 * DAY_MS,
    },
    { isAllowed: opts.isAllowed }
  );
  if (read.cancelled) return { status: "cancelled" };
  const resolver = await getCountryResolver();
  const days = classifyDays(read.points, dayRange(window.fromDay, window.untilDay), homes.at, {
    fallbackZone,
    countryAt: resolver.countryAt,
    dayOf: homes.dayOf,
  });
  const last = read.points[read.points.length - 1];
  const cutDay = read.coverage === "complete" ? null : last ? homes.dayOf(last.atMs) : "";
  const judged =
    cutDay === null ? days : days.map((d) => (d.day >= cutDay ? unknownDay(d.day, d.zone) : d));
  return {
    status: "ok",
    days: judged,
    runs: awayRuns(judged),
    generation: read.generation,
    coverage: read.coverage,
  };
}
