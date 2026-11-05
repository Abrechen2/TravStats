import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { isOpenDataEnabled } from "../openData/http";
import { dailyWeatherOutcome, type DailyWeather } from "../openData/openMeteo";
import type { WeatherOutcome } from "../openData/journalWeather";

export interface StationWeather extends DailyWeather {
  /** The station's day, YYYY-MM-DD — the arrival day the weather is for. */
  day: string;
  lat: number;
  lon: number;
  source: "open-meteo";
  fetchedAt: string;
}

/**
 * The measured weather on a roadtrip station's arrival day, and why there is
 * none when there is none. Nothing is stored: a roadtrip's station has no
 * weather column, so every answer is computed, and the CLIENT decides what to
 * keep — which is why a failure of the weather service is a distinct outcome
 * (`timeout`, `rateLimited`, `unavailable`) and never an empty weather.
 * `futureOrToday`, `noData` and `noLocation` are answers about the station or
 * its day; `disabled` is the instance's open data switch.
 */
export async function stationWeather(
  userId: string,
  routeId: string,
  stationId: string,
  now: Date = new Date()
): Promise<{ outcome: WeatherOutcome; weather: StationWeather | null }> {
  const station = await prisma.tripStop.findFirst({
    where: { id: stationId, routeId, viaPoint: false, route: { userId, kind: "roadtrip" } },
    select: { lat: true, lon: true, startDate: true },
  });
  if (!station) throw new AppError("Station not found", 404);
  if (!(await isOpenDataEnabled())) return { outcome: "disabled", weather: null };
  if (station.lat === null || station.lon === null || station.startDate === null) {
    return { outcome: "noLocation", weather: null };
  }
  const day = station.startDate.toISOString().slice(0, 10);
  const answer = await dailyWeatherOutcome(station.lat, station.lon, day, now);
  if (answer.kind !== "observed") return { outcome: answer.kind, weather: null };
  return {
    outcome: "observed",
    weather: {
      ...answer.weather,
      day,
      lat: station.lat,
      lon: station.lon,
      source: "open-meteo",
      fetchedAt: now.toISOString(),
    },
  };
}
