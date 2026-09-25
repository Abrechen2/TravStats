import { describe, it, expect } from "vitest";

import { formatObservedWeather, weatherKind } from "../observedWeather";

const t = (key: string) => key.split(".").pop() ?? key;
const day = {
  code: 53,
  tMaxC: 17.7,
  tMinC: 10.9,
  precipMm: 0.7,
  place: "Stavanger",
  lat: 58.97,
  lon: 5.73,
  source: "open-meteo" as const,
  fetchedAt: "2026-09-24T00:00:00Z",
};

describe("observed weather", () => {
  it("names the WMO groups", () => {
    expect([0, 2, 3, 45, 53, 63, 75, 81, 95].map(weatherKind)).toEqual([
      "clear",
      "partly",
      "cloudy",
      "fog",
      "drizzle",
      "rain",
      "snow",
      "showers",
      "thunder",
    ]);
  });

  it("writes high and low, what it was, and the rain", () => {
    expect(formatObservedWeather(day, t, "de")).toBe("18°/11° · drizzle · 0,7 mm");
  });

  it("leaves the rain out of a dry day rather than writing 0 mm", () => {
    expect(formatObservedWeather({ ...day, code: 0, precipMm: 0 }, t, "en")).toBe(
      "18°/11° · clear"
    );
  });
});
