import { randomUUID } from "node:crypto";
import { prisma } from "../../../db";
import { createPlan, writePlan } from "../store";
import { refreshStationClimate, clearClimateCache, climateByCalendarDay } from "../climate";
import { fetchOpenData, isOpenDataEnabled } from "../../openData/http";

jest.mock("../../openData/http", () => ({
  fetchOpenData: jest.fn(),
  isOpenDataEnabled: jest.fn(),
}));
const fetchMock = jest.mocked(fetchOpenData);
const enabled = jest.mocked(isOpenDataEnabled);
const NOW = new Date("2026-11-01T12:00:00Z");
let userId: string;

beforeAll(async () => {
  await prisma.travelPlanConfig.upsert({
    where: { id: "default" },
    create: { enabled: true },
    update: { enabled: true },
  });
});
beforeEach(async () => {
  userId = (
    await prisma.user.create({ data: { username: "climate-" + randomUUID(), passwordHash: "x" } })
  ).id;
  fetchMock.mockReset();
  enabled.mockReset().mockResolvedValue(true);
  clearClimateCache();
});
afterAll(async () => {
  await prisma.$disconnect();
});

/** Ten years of 1 Jul..3 Jul: 20 degrees by day, 10 by night, rain on every second year. */
function archive() {
  const time: string[] = [],
    max: number[] = [],
    min: number[] = [],
    rain: number[] = [];
  for (let y = 2016; y <= 2025; y++)
    for (const d of ["07-01", "07-02", "07-03"]) {
      time.push(`${y}-${d}`);
      max.push(20 + (y % 2));
      min.push(10);
      rain.push(y % 2 ? 4 : 0);
    }
  return {
    ok: true as const,
    body: {
      daily: {
        time,
        temperature_2m_max: max,
        temperature_2m_min: min,
        precipitation_sum: rain,
      },
    },
  };
}

async function routePlan() {
  const p = await createPlan(userId, { name: "Climate", clientRef: randomUUID(), settings: {} });
  let revision = p.revision;
  const send = async (operation: object) => {
    const r = await writePlan(userId, p.tripId, {
      clientRef: randomUUID(),
      baseRevision: revision,
      operation,
    } as never);
    revision = r.revision;
  };
  const id = randomUUID();
  await send({ type: "route_settings", shape: "route" });
  await send({ type: "settings", values: { startDay: "2027-07-01", endDay: "2027-07-10" } });
  await send({
    type: "upsert",
    collection: "stations",
    value: {
      id,
      title: "Bergen",
      place: {
        name: "Bergen",
        lat: 60.39,
        lon: 5.32,
        country: "NO",
        zone: "Europe/Oslo",
        ref: null,
      },
      nights: 2,
      pinnedDay: null,
      night: { kind: "spontaneous" },
      note: "",
    },
  });
  return {
    tripId: p.tripId,
    stationId: id,
    get revision() {
      return revision;
    },
  };
}

describe("climate means per station (spec 5.7)", () => {
  it("stores the ten-year mean for the station's own days, labelled with the years", async () => {
    const plan = await routePlan();
    fetchMock.mockResolvedValue(archive());
    const out = await refreshStationClimate(
      userId,
      plan.tripId,
      plan.stationId,
      { clientRef: randomUUID(), baseRevision: plan.revision },
      NOW
    );
    const w = out.state.stationWeather[0];
    expect(w).toMatchObject({ kind: "climate", stationId: plan.stationId, window: "2016-2025" });
    expect(w.days.map((d) => d.day)).toEqual(["2027-07-01", "2027-07-02", "2027-07-03"]);
    expect(w.days[0]).toMatchObject({
      max: 20.5,
      min: 10,
      precipitationMm: 2,
      rainProbability: 50,
    });
  });

  it("serves a second station of the same place from the cache without asking the provider again", async () => {
    const plan = await routePlan();
    fetchMock.mockResolvedValue(archive());
    const first = await refreshStationClimate(
      userId,
      plan.tripId,
      plan.stationId,
      {
        clientRef: randomUUID(),
        baseRevision: plan.revision,
      },
      NOW
    );
    await refreshStationClimate(
      userId,
      plan.tripId,
      plan.stationId,
      {
        clientRef: randomUUID(),
        baseRevision: first.revision,
      },
      NOW
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("keeps the stored climate and names the reason when the provider fails", async () => {
    const plan = await routePlan();
    fetchMock.mockResolvedValueOnce(archive());
    const stored = await refreshStationClimate(
      userId,
      plan.tripId,
      plan.stationId,
      {
        clientRef: randomUUID(),
        baseRevision: plan.revision,
      },
      NOW
    );
    clearClimateCache();
    fetchMock.mockResolvedValueOnce({ ok: false, failure: "rateLimited", status: 429 });
    await expect(
      refreshStationClimate(
        userId,
        plan.tripId,
        plan.stationId,
        {
          clientRef: randomUUID(),
          baseRevision: stored.revision,
        },
        NOW
      )
    ).rejects.toMatchObject({
      statusCode: 503,
      code: "PLAN_WEATHER_UNAVAILABLE",
      extra: { reason: "rateLimited" },
    });
    const row = await prisma.travelPlan.findFirstOrThrow({ where: { tripId: plan.tripId } });
    expect(row.revision).toBe(stored.revision);
    expect((row.state as { stationWeather: unknown[] }).stationWeather).toHaveLength(1);
  });

  it("refuses when open data is switched off instead of storing nothing quietly", async () => {
    const plan = await routePlan();
    enabled.mockResolvedValue(false);
    await expect(
      refreshStationClimate(
        userId,
        plan.tripId,
        plan.stationId,
        {
          clientRef: randomUUID(),
          baseRevision: plan.revision,
        },
        NOW
      )
    ).rejects.toMatchObject({ statusCode: 409, code: "PLAN_WEATHER_DISABLED" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("withholds a day-of-year mean measured in fewer than five years", () => {
    const table = climateByCalendarDay({
      time: ["2024-07-01", "2025-07-01"],
      temperature_2m_max: [20, 22],
      temperature_2m_min: [10, 12],
      precipitation_sum: [0, 0],
    });
    expect(table.get("07-01")).toMatchObject({ max: null, min: null, years: 2 });
  });
});
