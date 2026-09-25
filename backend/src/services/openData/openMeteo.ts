import { z } from "zod";

import { fetchOpenDataJson } from "./http";

/**
 * Open-Meteo: a day's measured weather, and ground elevations.
 *
 * Free and keyless for non-commercial use, which a self-hosted logbook is;
 * the data is CC BY 4.0 and is credited under Settings → About. Two hosts for
 * the weather, because the reanalysis archive runs a few days behind: a day
 * older than `ARCHIVE_AFTER_DAYS` is read from the archive, a more recent one
 * from the forecast service, which keeps the last months of observed days.
 */

const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const RECENT_URL = "https://api.open-meteo.com/v1/forecast";
const ELEVATION_URL = "https://api.open-meteo.com/v1/elevation";

const ARCHIVE_AFTER_DAYS = 7;
/** The forecast service keeps observed days this far back. */
const RECENT_WINDOW_DAYS = 90;
/** Open-Meteo answers at most this many points per elevation request. */
const ELEVATION_BATCH = 100;

export interface DailyWeather {
  /** WMO weather interpretation code (0 clear … 99 thunderstorm with hail). */
  code: number;
  tMaxC: number;
  tMinC: number;
  precipMm: number;
}

const dailySchema = z.object({
  daily: z.object({
    time: z.array(z.string()),
    weather_code: z.array(z.number().nullable()),
    temperature_2m_max: z.array(z.number().nullable()),
    temperature_2m_min: z.array(z.number().nullable()),
    precipitation_sum: z.array(z.number().nullable()),
  }),
});

const elevationSchema = z.object({ elevation: z.array(z.number()) });

const DAY_MS = 86_400_000;

function daysAgo(day: string, now: Date): number {
  return Math.floor((now.getTime() - Date.parse(`${day}T00:00:00Z`)) / DAY_MS);
}

/**
 * The measured weather on `day` (YYYY-MM-DD, local to the place) at a point.
 *
 * Null for today and any future day — a forecast is not what a logbook
 * records — for a day the recent service no longer keeps and the archive does
 * not yet, and for any failed or incomplete answer. Never a guess.
 */
export async function dailyWeather(
  lat: number,
  lon: number,
  day: string,
  now: Date = new Date()
): Promise<DailyWeather | null> {
  const age = daysAgo(day, now);
  if (!Number.isFinite(age) || age < 1) return null;
  const base = age > ARCHIVE_AFTER_DAYS ? ARCHIVE_URL : RECENT_URL;
  if (base === RECENT_URL && age > RECENT_WINDOW_DAYS) return null;

  const params = new URLSearchParams({
    latitude: lat.toFixed(4),
    longitude: lon.toFixed(4),
    start_date: day,
    end_date: day,
    daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum",
    timezone: "auto",
  });
  const parsed = dailySchema.safeParse(
    await fetchOpenDataJson("open-meteo", `${base}?${params.toString()}`)
  );
  if (!parsed.success) return null;

  const { daily } = parsed.data;
  const i = daily.time.indexOf(day);
  if (i < 0) return null;
  const [code, tMaxC, tMinC, precipMm] = [
    daily.weather_code[i],
    daily.temperature_2m_max[i],
    daily.temperature_2m_min[i],
    daily.precipitation_sum[i],
  ];
  if (code == null || tMaxC == null || tMinC == null || precipMm == null) return null;
  return { code, tMaxC, tMinC, precipMm };
}

/**
 * Ground elevation in metres for each point, in order. Null when any batch
 * fails: a profile with holes in it would draw a climb that is not there.
 */
export async function elevationsFor(
  points: ReadonlyArray<readonly [number, number]>
): Promise<number[] | null> {
  const out: number[] = [];
  for (let start = 0; start < points.length; start += ELEVATION_BATCH) {
    const batch = points.slice(start, start + ELEVATION_BATCH);
    const params = new URLSearchParams({
      latitude: batch.map(([, lat]) => lat.toFixed(5)).join(","),
      longitude: batch.map(([lon]) => lon.toFixed(5)).join(","),
    });
    const parsed = elevationSchema.safeParse(
      await fetchOpenDataJson("open-meteo-elevation", `${ELEVATION_URL}?${params.toString()}`)
    );
    if (!parsed.success || parsed.data.elevation.length !== batch.length) return null;
    out.push(...parsed.data.elevation);
  }
  return out;
}
