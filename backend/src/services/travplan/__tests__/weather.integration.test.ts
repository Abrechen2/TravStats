import { randomUUID } from "node:crypto";
import { prisma } from "../../../db";
import { createPlan, readPlan, writePlan } from "../store";
import { refreshForecast } from "../weather";
import { requestTextWithDeadline } from "../../http/boundedHttp";
jest.mock("../../http/boundedHttp", () => ({ requestTextWithDeadline: jest.fn() }));
const fetchWeather = jest.mocked(requestTextWithDeadline);
let userId: string;
beforeEach(async () => {
  userId = (
    await prisma.user.create({
      data: { username: "weather-plan-" + randomUUID(), passwordHash: "not-a-password" },
    })
  ).id;
  await prisma.travelPlanConfig.upsert({
    where: { id: "default" },
    create: { enabled: true },
    update: { enabled: true },
  });
  fetchWeather.mockReset();
});
afterAll(async () => {
  await prisma.$disconnect();
});
async function plan() {
  return createPlan(userId, {
    name: "Forecast trip",
    clientRef: randomUUID(),
    settings: { latitude: 32, longitude: -16, timezone: "Atlantic/Madeira" },
  });
}
it("persists real provider data with provenance and replays once", async () => {
  const p = await plan(),
    request = { baseRevision: p.revision, clientRef: randomUUID() },
    today = new Date().toISOString().slice(0, 10);
  fetchWeather.mockResolvedValue(
    JSON.stringify({
      timezone: "Atlantic/Madeira",
      daily: {
        time: [today],
        temperature_2m_min: [15],
        temperature_2m_max: [21],
        precipitation_probability_max: [60],
        wind_speed_10m_max: [12],
      },
    })
  );
  const a = await refreshForecast(userId, p.tripId, request),
    b = await refreshForecast(userId, p.tripId, request);
  expect(b).toEqual(a);
  expect(fetchWeather).toHaveBeenCalledTimes(1);
  expect(a.state.forecast?.days[0].rainProbability).toBe(60);
  expect(a.state.forecast?.source).toContain("open-meteo");
});
it("keeps saved data intact when the provider fails", async () => {
  const p = await plan();
  fetchWeather.mockRejectedValue(new Error("network"));
  await expect(
    refreshForecast(userId, p.tripId, { baseRevision: p.revision, clientRef: randomUUID() })
  ).rejects.toMatchObject({ code: "PLAN_WEATHER_UNAVAILABLE" });
  expect((await readPlan(userId, p.tripId)).revision).toBe(p.revision);
});
it("does not query a provider outside its forecast horizon", async () => {
  const p = await plan(),
    q = await writePlan(userId, p.tripId, {
      baseRevision: p.revision,
      clientRef: randomUUID(),
      operation: { type: "settings", values: { startDay: "2099-01-01" } },
    });
  await expect(
    refreshForecast(userId, p.tripId, { baseRevision: q.revision, clientRef: randomUUID() })
  ).rejects.toMatchObject({ code: "PLAN_WEATHER_HORIZON" });
  expect(fetchWeather).not.toHaveBeenCalled();
});
