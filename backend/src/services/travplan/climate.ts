/**
 * Climate means per route station (spec §5.7): outside the forecast horizon a station gets the
 * average of the last ten full years of measured weather for its own calendar window, labelled as
 * such. A provider failure, a closed open-data switch or a sample too thin to average leaves the
 * stored values untouched and says why - never a made-up figure.
 */
import { AppError } from "../../middleware/errorHandler";
import { fetchOpenData, isOpenDataEnabled } from "../openData/http";
import { configuration, reserveUsage, hash, assertEnabled } from "./store";
import { commitWeather } from "./weather";
import { isRemote, planAccess, type PlanActor } from "./access";
import { parseState } from "./upgrade";
import { scheduleRoute } from "./routeSchedule";
import { stationWeatherSchema } from "./schema";
import type { PlanState, PlanStationWeather, PlanView } from "./types";
import { z } from "zod";
import { prisma } from "../../db";

const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const YEARS = 10;
/** A day-of-year mean needs this many measured years, or it is withheld. */
const MIN_YEARS = 5;
const MAX_WINDOW_DAYS = 62;
const CACHE_TTL_MS = 30 * 86_400_000;
const CACHE_MAX = 300;
const RAIN_DAY_MM = 1;
const DAY_MS = 86_400_000;

const archiveSchema = z.object({
  daily: z.object({
    time: z.array(z.string()),
    temperature_2m_max: z.array(z.number().nullable()),
    temperature_2m_min: z.array(z.number().nullable()),
    precipitation_sum: z.array(z.number().nullable()),
  }),
});
type Archive = z.infer<typeof archiveSchema>["daily"];

export interface DayMean {
  min: number | null;
  max: number | null;
  rainProbability: number | null;
  precipitationMm: number | null;
  years: number;
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const mean = (values: number[]) =>
  values.length ? round1(values.reduce((a, b) => a + b, 0) / values.length) : null;

/** Per calendar day (`MM-DD`) means over the measured years; a thin sample stays null. */
export function climateByCalendarDay(daily: Archive): Map<string, DayMean> {
  type Metric = "min" | "max" | "rain";
  const buckets = new Map<string, Record<Metric, Map<string, number>>>();
  daily.time.forEach((day, i) => {
    const key = day.slice(5),
      year = day.slice(0, 4);
    const b = buckets.get(key) ?? { min: new Map(), max: new Map(), rain: new Map() };
    const lo = daily.temperature_2m_min[i],
      hi = daily.temperature_2m_max[i],
      rain = daily.precipitation_sum[i];
    if (lo != null) b.min.set(year, lo);
    if (hi != null) b.max.set(year, hi);
    if (rain != null) b.rain.set(year, rain);
    buckets.set(key, b);
  });
  // Each figure needs its own sample: five years of temperature say nothing about rain.
  const enough = (m: Map<string, number>) => m.size >= MIN_YEARS;
  const out = new Map<string, DayMean>();
  for (const [key, b] of buckets) {
    const rain = [...b.rain.values()];
    out.set(key, {
      min: enough(b.min) ? mean([...b.min.values()]) : null,
      max: enough(b.max) ? mean([...b.max.values()]) : null,
      precipitationMm: enough(b.rain) ? mean(rain) : null,
      rainProbability: enough(b.rain)
        ? Math.round((100 * rain.filter((mm) => mm >= RAIN_DAY_MM).length) / rain.length)
        : null,
      years: Math.max(b.min.size, b.max.size, b.rain.size),
    });
  }
  return out;
}

const cache = new Map<string, { at: number; table: Map<string, DayMean> }>();
const cacheKey = (lat: number, lon: number, lastYear: number) =>
  `${lat.toFixed(1)},${lon.toFixed(1)},${lastYear}`;

/** Test hook: the cache is process-wide. */
export const clearClimateCache = () => cache.clear();

type Failure = "timeout" | "rateLimited" | "unavailable";
async function climateTable(
  lat: number,
  lon: number,
  now: Date,
  beforeFetch: () => Promise<void>
): Promise<
  { table: Map<string, DayMean>; years: [number, number] } | { failure: Failure | "invalid" }
> {
  const last = now.getUTCFullYear() - 1,
    first = last - YEARS + 1;
  const key = cacheKey(lat, lon, last);
  const hit = cache.get(key);
  if (hit && now.getTime() - hit.at < CACHE_TTL_MS)
    return { table: hit.table, years: [first, last] };
  await beforeFetch();
  const params = new URLSearchParams({
    latitude: Number(lat.toFixed(1)).toString(),
    longitude: Number(lon.toFixed(1)).toString(),
    start_date: `${first}-01-01`,
    end_date: `${last}-12-31`,
    daily: "temperature_2m_max,temperature_2m_min,precipitation_sum",
    timezone: "auto",
  });
  const answer = await fetchOpenData("open-meteo-climate", `${ARCHIVE_URL}?${params}`, {
    timeoutMs: 25_000,
  });
  if (!answer.ok) return { failure: answer.failure };
  const parsed = archiveSchema.safeParse(answer.body);
  if (!parsed.success) return { failure: "invalid" };
  const table = climateByCalendarDay(parsed.data.daily);
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(key, { at: now.getTime(), table });
  return { table, years: [first, last] };
}

/** The station's own days, arrival to departure. */
function windowDays(arrive: string, nights: number): string[] {
  const days: string[] = [];
  for (let n = 0; n <= nights; n++)
    days.push(new Date(Date.parse(`${arrive}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10));
  return days;
}

export async function refreshStationClimate(
  actor: PlanActor,
  tripId: string,
  stationId: string,
  request: { clientRef: string; baseRevision: number },
  now: Date = new Date()
): Promise<PlanView> {
  await assertEnabled();
  const access = await planAccess(actor, tripId),
    row = access.row,
    state = parseState(row.state),
    payloadHash = hash({ type: "climate", stationId, ...request });
  const receipt = await prisma.travelPlanMutation.findUnique({
    where: { planId_clientRef: { planId: row.id, clientRef: request.clientRef } },
  });
  if (receipt) {
    if (
      receipt.payloadHash !== payloadHash ||
      (receipt.actorMemberId && receipt.actorMemberId !== access.member.id)
    )
      throw new AppError("Mutation key has different content", 409, "PLAN_IDEMPOTENCY_CONFLICT");
    return receipt.result as unknown as PlanView;
  }
  if (row.revision !== request.baseRevision)
    throw new AppError("Plan changed", 409, "PLAN_REVISION_CONFLICT");
  const station = state.stations.find((s) => s.id === stationId);
  if (!station) throw new AppError("Station not found", 404, "PLAN_ITEM_NOT_FOUND");
  const arrive = scheduleRoute(state).stations.find((s) => s.stationId === stationId)?.arriveDay;
  if (!arrive) throw new AppError("The station has no day yet", 409, "PLAN_STATION_UNDATED");
  const days = windowDays(arrive, station.nights);
  if (days.length > MAX_WINDOW_DAYS)
    throw new AppError("The stay is too long for a climate window", 400, "PLAN_WEATHER_HORIZON");
  if (!(await isOpenDataEnabled()))
    throw new AppError(
      "Open data services are switched off on this server",
      409,
      "PLAN_WEATHER_DISABLED"
    );
  const got = await climateTable(station.place.lat, station.place.lon, now, async () =>
    reserveUsage(
      isRemote(actor) ? access.ownerId : actor,
      "weather",
      (await configuration()).weatherDailyLimit
    )
  );
  if ("failure" in got)
    throw new AppError(
      "Weather provider is unavailable; the saved climate is unchanged",
      got.failure === "invalid" ? 502 : 503,
      got.failure === "invalid" ? "PLAN_WEATHER_INVALID" : "PLAN_WEATHER_UNAVAILABLE",
      undefined,
      { reason: got.failure }
    );
  const rows = days.map((day) => ({ day, mean: got.table.get(day.slice(5)) }));
  // A partial answer must not replace a complete stored one: every day needs a temperature range.
  if (rows.some((r) => !r.mean || r.mean.max === null || r.mean.min === null))
    throw new AppError("No measurements for this place and season", 404, "PLAN_WEATHER_NO_DATA");
  const entry: PlanStationWeather = stationWeatherSchema.parse({
    stationId,
    kind: "climate",
    source: "https://open-meteo.com/en/docs/historical-weather-api",
    fetchedAt: now.toISOString(),
    window: `${got.years[0]}-${got.years[1]}`,
    days: rows.map(({ day, mean: m }) => ({
      day,
      min: m?.min ?? null,
      max: m?.max ?? null,
      rainProbability: m?.rainProbability ?? null,
      precipitationMm: m?.precipitationMm ?? null,
    })),
  });
  const next: PlanState = {
    ...state,
    stationWeather: [...state.stationWeather.filter((w) => w.stationId !== stationId), entry],
  };
  if (Buffer.byteLength(JSON.stringify(next)) > 1024 * 1024)
    throw new AppError("Plan is too large", 413, "PLAN_TOO_LARGE");
  await assertEnabled();
  return commitWeather(access, state, next, tripId, request, payloadHash);
}
