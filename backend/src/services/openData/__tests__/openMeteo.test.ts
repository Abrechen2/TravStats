import { dailyWeather, elevationsFor } from "../openMeteo";
import { mockFetch, type FetchMock } from "./fetchMock";

const STAVANGER_DAY = {
  daily: {
    time: ["2024-07-15"],
    weather_code: [53],
    temperature_2m_max: [17.7],
    temperature_2m_min: [10.9],
    precipitation_sum: [0.7],
  },
};

describe("Open-Meteo", () => {
  let fetches: FetchMock | null = null;
  afterEach(() => fetches?.restore());

  const now = new Date("2026-09-24T12:00:00Z");

  it("reads an old day from the archive", async () => {
    fetches = mockFetch([[/archive-api\.open-meteo\.com/, STAVANGER_DAY]]);
    expect(await dailyWeather(58.97, 5.73, "2024-07-15", now)).toEqual({
      code: 53,
      tMaxC: 17.7,
      tMinC: 10.9,
      precipMm: 0.7,
    });
    expect(fetches.calls[0]).toContain("start_date=2024-07-15");
  });

  it("reads a day of last week from the recent service, which the archive has not reached", async () => {
    fetches = mockFetch([
      [
        /api\.open-meteo\.com\/v1\/forecast/,
        { daily: { ...STAVANGER_DAY.daily, time: ["2026-09-20"] } },
      ],
    ]);
    expect(await dailyWeather(58.97, 5.73, "2026-09-20", now)).not.toBeNull();
    expect(fetches.calls[0]).toContain("/v1/forecast");
  });

  it("records no weather for today or a future day — a forecast is not an observation", async () => {
    fetches = mockFetch([]);
    expect(await dailyWeather(58.97, 5.73, "2026-09-24", now)).toBeNull();
    expect(await dailyWeather(58.97, 5.73, "2026-10-01", now)).toBeNull();
    expect(fetches.calls).toHaveLength(0);
  });

  it("abstains on a gap in the answer instead of reporting zero", async () => {
    fetches = mockFetch([
      [/archive-api/, { daily: { ...STAVANGER_DAY.daily, precipitation_sum: [null] } }],
    ]);
    expect(await dailyWeather(58.97, 5.73, "2024-07-15", now)).toBeNull();
  });

  it("abstains when the service fails", async () => {
    fetches = mockFetch([[/archive-api/, { reason: "boom" }, 500]]);
    expect(await dailyWeather(58.97, 5.73, "2024-07-15", now)).toBeNull();
  });

  it("asks for elevations in batches of 100 and keeps their order", async () => {
    fetches = mockFetch([
      [
        /v1\/elevation/,
        (url: string) => {
          const n = new URL(url).searchParams.get("latitude")!.split(",").length;
          return { elevation: Array.from({ length: n }, (_, i) => i) };
        },
      ],
    ]);
    const points = Array.from({ length: 150 }, (_, i): [number, number] => [6 + i * 0.001, 58]);
    const heights = await elevationsFor(points);
    expect(fetches.calls).toHaveLength(2);
    expect(heights).toHaveLength(150);
    expect(heights!.slice(99, 101)).toEqual([99, 0]);
  });

  it("gives no elevations at all when one batch comes back short", async () => {
    fetches = mockFetch([[/v1\/elevation/, { elevation: [1, 2] }]]);
    expect(
      await elevationsFor([
        [6, 58],
        [6.1, 58],
        [6.2, 58],
      ])
    ).toBeNull();
  });
});
