import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { isOpenDataEnabled, type OpenDataFailure } from "./http";
import { dailyWeatherOutcome, type DailyWeather } from "./openMeteo";

/** What `TripJournalEntry.observedWeather` holds. */
export interface ObservedWeather extends DailyWeather {
  /** The stop the day was measured at, so the reader can see where. */
  place: string;
  lat: number;
  lon: number;
  source: "open-meteo";
  fetchedAt: string;
}

const dayOf = (d: Date): string => d.toISOString().slice(0, 10);

interface DaySpan {
  title: string;
  lat: number;
  lon: number;
  start: Date;
  end: Date | null;
}

/** A stop with coordinates and a start day, as a span. */
async function stopSpans(tripId: string): Promise<DaySpan[]> {
  const stops = await prisma.tripStop.findMany({
    where: { tripId, lat: { not: null }, lon: { not: null }, startDate: { not: null } },
    select: { title: true, lat: true, lon: true, startDate: true, endDate: true },
  });
  return stops.map((s) => ({
    title: s.title,
    lat: s.lat!,
    lon: s.lon!,
    start: s.startDate!,
    end: s.endDate,
  }));
}

/**
 * The trip's dated stays whose hotel has coordinates, as spans. A stay is
 * where the night was spent — the strongest evidence of where a day was —
 * and a trip whose itinerary lives in its stays has no stops at all:
 * acceptance 2026-09-26 found "Wetter nachtragen" answering noLocation for a
 * Barcelona trip with a geocoded stay, because only stops were asked.
 * Only DAY precision counts: a "July 2011" stay does not say which day.
 */
async function staySpans(tripId: string): Promise<DaySpan[]> {
  const stays = await prisma.lodgingStay.findMany({
    where: {
      tripId,
      datePrecision: "DAY",
      checkIn: { not: null },
      status: { not: "cancelled" },
      lodging: { lat: { not: null }, lon: { not: null } },
    },
    select: {
      checkIn: true,
      checkOut: true,
      lodging: { select: { name: true, lat: true, lon: true } },
    },
  });
  return stays.map((s) => ({
    title: s.lodging.name,
    lat: s.lodging.lat!,
    lon: s.lodging.lon!,
    start: s.checkIn!,
    end: s.checkOut,
  }));
}

/**
 * Where the trip was on `day`: a stop or a stay with coordinates whose span
 * covers it. Of several (a travel day), the one reached LAST — where the day
 * ended and the night was spent. None when nothing covers the day: a journal
 * entry is never given the weather of a place it may not have been.
 */
export async function placeOfDay(
  tripId: string,
  day: string
): Promise<{ title: string; lat: number; lon: number } | null> {
  const spans = [...(await stopSpans(tripId)), ...(await staySpans(tripId))];
  const covering = spans
    .filter((s) => {
      const start = dayOf(s.start);
      const end = s.end ? dayOf(s.end) : start;
      return start <= day && day <= end;
    })
    .sort((a, b) => b.start.getTime() - a.start.getTime());
  const span = covering[0];
  return span ? { title: span.title, lat: span.lat, lon: span.lon } : null;
}

/**
 * What fetching one entry's weather came to (2026-09-26), as the UI needs it.
 * It used to be one null: an Open-Meteo timeout, a 429, a day with no stop and
 * an entry dated today all read "no place with coordinates" — and the null
 * was WRITTEN, so a busy weather service deleted weather that had been
 * stored before.
 */
export type WeatherOutcome =
  "observed" | "noLocation" | "futureOrToday" | "noData" | OpenDataFailure | "disabled";

const SERVICE_FAILURES: ReadonlySet<WeatherOutcome> = new Set<WeatherOutcome>([
  "timeout",
  "rateLimited",
  "unavailable",
]);

/** A failure of the SERVICE, which says nothing about the day's weather. */
export function isServiceFailure(outcome: WeatherOutcome): boolean {
  return SERVICE_FAILURES.has(outcome);
}

/** The day's measured weather for a journal entry, and why there is none when there is none. */
export async function observeWeather(
  tripId: string,
  date: Date,
  now: Date = new Date()
): Promise<{ outcome: WeatherOutcome; observed: ObservedWeather | null }> {
  const day = dayOf(date);
  const place = await placeOfDay(tripId, day);
  if (!place) return { outcome: "noLocation", observed: null };
  const answer = await dailyWeatherOutcome(place.lat, place.lon, day, now);
  if (answer.kind !== "observed") return { outcome: answer.kind, observed: null };
  return {
    outcome: "observed",
    observed: {
      ...answer.weather,
      place: place.title,
      lat: place.lat,
      lon: place.lon,
      source: "open-meteo",
      fetchedAt: now.toISOString(),
    },
  };
}

/**
 * Fetch and store the weather of one entry. Returns the entry as stored and
 * what the fetch came to.
 *
 * An answer about the DAY is written, null included: a value from the entry's
 * previous date must not outlive a date change, and a day with no stop has no
 * weather to show. A failure of the SERVICE writes nothing — the stored value
 * is the best one there is — unless `storedIsForAnotherDay` says the stored
 * value belongs to a date the entry no longer has. Does nothing at all while
 * the instance's open data switch is off.
 */
export async function refreshJournalWeather(
  entryId: string,
  options: { storedIsForAnotherDay?: boolean; now?: Date } = {}
) {
  const entry = await prisma.tripJournalEntry.findUniqueOrThrow({ where: { id: entryId } });
  if (!(await isOpenDataEnabled())) return { entry, outcome: "disabled" as WeatherOutcome };
  const { outcome, observed } = await observeWeather(entry.tripId, entry.date, options.now);
  if (isServiceFailure(outcome) && !options.storedIsForAnotherDay) {
    return { entry, outcome };
  }
  const stored = await prisma.tripJournalEntry.update({
    where: { id: entryId },
    data: {
      observedWeather:
        observed === null ? Prisma.DbNull : (observed as unknown as Prisma.InputJsonValue),
    },
  });
  return { entry: stored, outcome };
}

export interface EntryWeatherOutcome {
  entryId: string;
  /** The entry's day, YYYY-MM-DD. */
  date: string;
  outcome: WeatherOutcome;
}

/**
 * Fill every entry of a trip that has no weather yet, one after the other,
 * and say for each what came of it. Stops asking once the service answers
 * 429: the remaining entries are reported rate-limited rather than hammered.
 */
export async function fillTripJournalWeather(
  tripId: string
): Promise<{ filled: number; outcomes: EntryWeatherOutcome[] }> {
  const entries = await prisma.tripJournalEntry.findMany({
    where: { tripId, observedWeather: { equals: Prisma.DbNull } },
    select: { id: true, date: true },
    orderBy: { date: "asc" },
  });
  const outcomes: EntryWeatherOutcome[] = [];
  let limited = false;
  for (const { id, date } of entries) {
    const outcome: WeatherOutcome = limited
      ? "rateLimited"
      : (await refreshJournalWeather(id)).outcome;
    if (outcome === "rateLimited") limited = true;
    outcomes.push({ entryId: id, date: dayOf(date), outcome });
  }
  return { filled: outcomes.filter((o) => o.outcome === "observed").length, outcomes };
}
