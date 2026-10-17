import { z } from "zod";
import { prisma } from "../../db";
import { AppError } from "../../middleware/errorHandler";
import { requestTextWithDeadline } from "../http/boundedHttp";
import {
  configuration,
  reserveUsage,
  readPlan,
  ownedPlan,
  asJson,
  hash,
  view,
  assertEnabled,
} from "./store";
import { forecastSchema } from "./schema";
import { parseState } from "./upgrade";
import type { PlanView } from "./types";
const nullableNumbers = z.array(z.number().finite().nullable()).max(16);
const responseSchema = z.object({
  timezone: z.string(),
  daily: z.object({
    time: z.array(z.string()).max(16),
    temperature_2m_min: nullableNumbers,
    temperature_2m_max: nullableNumbers,
    precipitation_probability_max: nullableNumbers,
    wind_speed_10m_max: nullableNumbers,
  }),
});
export async function refreshForecast(
  userId: string,
  tripId: string,
  request: { clientRef: string; baseRevision: number }
): Promise<PlanView> {
  await assertEnabled();
  const row = await ownedPlan(userId, tripId),
    state = parseState(row.state),
    payloadHash = hash({ type: "forecast", ...request });
  const receipt = await prisma.travelPlanMutation.findUnique({
    where: { planId_clientRef: { planId: row.id, clientRef: request.clientRef } },
  });
  if (receipt) {
    if (receipt.payloadHash !== payloadHash)
      throw new AppError("Mutation key has different content", 409, "PLAN_IDEMPOTENCY_CONFLICT");
    return receipt.result as unknown as PlanView;
  }
  if (row.revision !== request.baseRevision)
    throw new AppError("Plan changed", 409, "PLAN_REVISION_CONFLICT");
  if (state.latitude === null || state.longitude === null)
    throw new AppError("Choose a weather location first", 400, "PLAN_WEATHER_LOCATION");
  const today = new Date().toISOString().slice(0, 10),
    last = new Date(Date.parse(today) + 15 * 864e5).toISOString().slice(0, 10);
  if (state.startDay && state.startDay > last)
    throw new AppError("This trip is outside the forecast horizon", 400, "PLAN_WEATHER_HORIZON");
  if (state.endDay && state.endDay < today)
    throw new AppError(
      "This trip is in the past; use observed weather in TravStats",
      400,
      "PLAN_WEATHER_PAST"
    );
  if (
    state.forecast &&
    state.forecast.latitude === state.latitude &&
    state.forecast.longitude === state.longitude &&
    Date.now() - Date.parse(state.forecast.fetchedAt) < 3600000
  )
    return readPlan(userId, tripId);
  await reserveUsage(userId, "weather", (await configuration()).weatherDailyLimit);
  const query = new URLSearchParams({
    latitude: String(state.latitude),
    longitude: String(state.longitude),
    daily: "temperature_2m_min,temperature_2m_max,precipitation_probability_max,wind_speed_10m_max",
    forecast_days: "16",
    timezone: state.timezone || "auto",
  });
  let body: unknown;
  try {
    const text = await requestTextWithDeadline({
      url: "https://api.open-meteo.com/v1/forecast?" + query,
      method: "GET",
      timeoutMs: 10000,
      maxResponseBytes: 262144,
      label: "Travel forecast",
    });
    body = JSON.parse(text);
  } catch {
    throw new AppError(
      "Weather provider is unavailable; the saved forecast is unchanged",
      503,
      "PLAN_WEATHER_UNAVAILABLE"
    );
  }
  const parsed = responseSchema.safeParse(body);
  if (!parsed.success)
    throw new AppError(
      "Weather provider returned an invalid response",
      502,
      "PLAN_WEATHER_INVALID"
    );
  const daily = parsed.data.daily,
    forecast = forecastSchema.parse({
      latitude: state.latitude,
      longitude: state.longitude,
      timezone: parsed.data.timezone,
      source: "https://open-meteo.com/en/docs",
      fetchedAt: new Date().toISOString(),
      days: daily.time.map((day, i) => ({
        day,
        min: daily.temperature_2m_min[i] ?? null,
        max: daily.temperature_2m_max[i] ?? null,
        rainProbability: daily.precipitation_probability_max[i] ?? null,
        wind: daily.wind_speed_10m_max[i] ?? null,
      })),
    });
  if (Buffer.byteLength(JSON.stringify({ ...state, forecast })) > 1024 * 1024)
    throw new AppError("Plan is too large", 413, "PLAN_TOO_LARGE");
  await assertEnabled();
  return prisma.$transaction(async (tx) => {
    const changed = await tx.travelPlan.updateMany({
      where: { id: row.id, revision: request.baseRevision },
      data: { revision: { increment: 1 }, state: asJson({ ...state, forecast }) },
    });
    if (changed.count !== 1)
      throw new AppError("Plan changed while fetching weather", 409, "PLAN_REVISION_CONFLICT");
    const result = view(
      { ...row, revision: row.revision + 1, state: asJson({ ...state, forecast }) },
      row.trip.name
    );
    const mutation = await tx.travelPlanMutation.create({
      data: {
        planId: row.id,
        clientRef: request.clientRef,
        payloadHash,
        baseRevision: row.revision,
        revision: result.revision,
        before: asJson({ state, name: row.trip.name }),
        result: asJson(result),
      },
    });
    result.lastMutationId = mutation.id;
    await tx.travelPlanMutation.update({
      where: { id: mutation.id },
      data: { result: asJson(result) },
    });
    await tx.trip.update({ where: { id: tripId }, data: { updatedAt: new Date() } });
    return result;
  });
}
