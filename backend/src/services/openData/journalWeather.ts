import { prisma } from "../../db";
import { Prisma } from "../../prisma";
import { isOpenDataEnabled } from "./http";
import { dailyWeather, type DailyWeather } from "./openMeteo";

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

/**
 * Where the trip was on `day`: a stop with coordinates whose span covers it.
 * Of several (a travel day), the one reached LAST — where the day ended and
 * the night was spent. None when no stop covers the day: a journal entry is
 * never given the weather of a place it may not have been.
 */
export async function placeOfDay(
  tripId: string,
  day: string
): Promise<{ title: string; lat: number; lon: number } | null> {
  const stops = await prisma.tripStop.findMany({
    where: { tripId, lat: { not: null }, lon: { not: null }, startDate: { not: null } },
    select: { title: true, lat: true, lon: true, startDate: true, endDate: true },
  });
  const covering = stops
    .filter((s) => {
      const start = dayOf(s.startDate!);
      const end = s.endDate ? dayOf(s.endDate) : start;
      return start <= day && day <= end;
    })
    .sort((a, b) => b.startDate!.getTime() - a.startDate!.getTime());
  const stop = covering[0];
  return stop ? { title: stop.title, lat: stop.lat!, lon: stop.lon! } : null;
}

/** The day's measured weather for a journal entry, or null when it cannot be known. */
export async function observeWeather(
  tripId: string,
  date: Date,
  now: Date = new Date()
): Promise<ObservedWeather | null> {
  const day = dayOf(date);
  const place = await placeOfDay(tripId, day);
  if (!place) return null;
  const weather = await dailyWeather(place.lat, place.lon, day, now);
  if (!weather) return null;
  return {
    ...weather,
    place: place.title,
    lat: place.lat,
    lon: place.lon,
    source: "open-meteo",
    fetchedAt: now.toISOString(),
  };
}

/**
 * Fetch and store the weather of one entry. Returns the entry as stored.
 *
 * Writes null when the day has no answer, because a value from the entry's
 * PREVIOUS date must not outlive a date change. Does nothing at all while the
 * instance's open data switch is off.
 */
export async function refreshJournalWeather(entryId: string) {
  const entry = await prisma.tripJournalEntry.findUniqueOrThrow({ where: { id: entryId } });
  if (!(await isOpenDataEnabled())) return entry;
  const observed = await observeWeather(entry.tripId, entry.date);
  return prisma.tripJournalEntry.update({
    where: { id: entryId },
    data: {
      observedWeather:
        observed === null ? Prisma.DbNull : (observed as unknown as Prisma.InputJsonValue),
    },
  });
}

/** Fill every entry of a trip that has no weather yet. Returns how many got one. */
export async function fillTripJournalWeather(tripId: string): Promise<number> {
  const entries = await prisma.tripJournalEntry.findMany({
    where: { tripId, observedWeather: { equals: Prisma.DbNull } },
    select: { id: true },
  });
  let filled = 0;
  for (const { id } of entries) {
    const stored = await refreshJournalWeather(id);
    if (stored.observedWeather !== null) filled++;
  }
  return filled;
}
