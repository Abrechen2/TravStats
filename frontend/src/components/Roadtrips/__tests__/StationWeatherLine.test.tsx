import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import StationWeatherLine from "../StationWeatherLine";
import type { StationWeather } from "../../../types/roadtrip";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

const w: StationWeather = {
  code: 0,
  tMaxC: 21,
  tMinC: 11,
  precipMm: 0,
  day: "2026-07-01",
  lat: 1,
  lon: 2,
  source: "open-meteo",
  fetchedAt: "x",
};

describe("StationWeatherLine", () => {
  it("shows the kept measurement AND says the failed reload left it standing", () => {
    render(<StationWeatherLine state={{ weather: w, problem: "timeout" }} />);
    expect(screen.getByTestId("station-weather")).toHaveTextContent("21°/11°");
    expect(screen.getByRole("status")).toHaveTextContent("openData:weather.outcome.timeoutKept");
  });

  it("says why there is no weather instead of drawing nothing", () => {
    render(<StationWeatherLine state={{ weather: null, problem: "noData" }} />);
    expect(screen.queryByTestId("station-weather")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("openData:weather.outcome.noData");
  });
});
