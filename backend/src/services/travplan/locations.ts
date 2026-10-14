import { z } from "zod";
import { requestTextWithDeadline } from "../http/boundedHttp";
import { assertEnabled, configuration, reserveUsage } from "./store";
import { AppError } from "../../middleware/errorHandler";
export const locationSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  country: z.string().optional(),
  admin1: z.string().optional(),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  timezone: z.string().refine((v) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }),
});
export async function findLocations(userId: string, query: string, language: "de" | "en") {
  await assertEnabled();
  await reserveUsage(userId, "weather", (await configuration()).weatherDailyLimit);
  const params = new URLSearchParams({ name: query, language, count: "8", format: "json" });
  try {
    const body = JSON.parse(
      await requestTextWithDeadline({
        url: "https://geocoding-api.open-meteo.com/v1/search?" + params,
        method: "GET",
        timeoutMs: 10000,
        maxResponseBytes: 131072,
        label: "Travel location search",
      })
    ) as unknown;
    return z.object({ results: z.array(locationSchema).max(8).default([]) }).parse(body).results;
  } catch {
    throw new AppError("Location search unavailable", 503, "PLAN_WEATHER_UNAVAILABLE");
  }
}
