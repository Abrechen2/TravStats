import { describe, it, expect, vi } from "vitest";
import { render, screen, act, cleanup } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import type { JSX } from "react";
import type { BusinessStats, SeatStats } from "../../../types";
import { EVIDENCE_MEASURES } from "../../../shared/evidenceMeasures";
import { parseRankingKey } from "../../../shared/evidence";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, v?: Record<string, unknown>) => (v?.count !== undefined ? `${k}:${v.count}` : k),
    i18n: { language: "en" },
  }),
}));

import StatsDistanceSection from "../StatsDistanceSection";
import StatsChartsSection from "../StatsChartsSection";
import StatsSeatSection from "../StatsSeatSection";
import StatsBusinessSection from "../StatsBusinessSection";
import StatsOverviewCards from "../StatsOverviewCards";
import PunctualitySection from "../PunctualitySection";

/**
 * forgejo#256: every figure of the flight tab explains how it is counted and
 * opens the entries behind it. These are the sections whose figures had no
 * jump — distance, charts, seats, business, the overview's average and the
 * punctuality tiles. Each test reads the keys the buttons write into the URL
 * (the whole contract with the panel) and requires every one to be served:
 * a registered `servedIn: 1` metric, or a ranking key of a known dimension.
 */

function LocationProbe({ onChange }: { onChange: (search: string) => void }): null {
  onChange(useLocation().search);
  return null;
}

async function keysOpenedBy(section: JSX.Element): Promise<string[]> {
  cleanup();
  let search = "";
  render(
    <MemoryRouter>
      {section}
      <LocationProbe onChange={(next) => (search = next)} />
    </MemoryRouter>
  );
  const keys: string[] = [];
  for (const trigger of screen.getAllByRole("button")) {
    await act(async () => trigger.click());
    keys.push(new URLSearchParams(search).get("evidence") ?? "");
  }
  return keys;
}

function expectServed(keys: string[]): void {
  for (const raw of keys) {
    const kind = raw.slice(0, raw.indexOf(":"));
    const key = raw.slice(raw.indexOf(":") + 1);
    if (kind === "metric") {
      expect([key, EVIDENCE_MEASURES[key]?.servedIn]).toEqual([key, 1]);
    } else {
      expect([raw, kind]).toEqual([raw, "ranking"]);
      expect([raw, parseRankingKey(key) !== null]).toEqual([raw, true]);
    }
  }
}

const flight = { depIata: "FRA", arrIata: "SIN" } as never;

describe("flight-tab figures open their entries (forgejo#256)", () => {
  it("distance: every tile, the extremes to their legs", async () => {
    const keys = await keysOpenedBy(
      <StatsDistanceSection
        totalDistance={20000}
        avgDistance={5000}
        longestDistance={{ flight, distance: 10000 }}
        shortestDistance={{ flight, distance: 300 }}
      />
    );
    expect(keys).toEqual([
      "metric:distanceKmTotal",
      "metric:distanceKmTotal",
      "metric:distanceKmTotal",
      "metric:longestDistanceFlights",
      "metric:shortestDistanceFlights",
    ]);
    expectServed(keys);
    expect(screen.getByTestId("distance-counting-help")).toBeTruthy();
  });

  it("charts: each bar with flights opens its month or weekday", async () => {
    const months = Array.from({ length: 12 }, (_, i) => ({
      month: `m${i + 1}`,
      flights: i === 2 ? 4 : 0,
    }));
    const days = Array.from({ length: 7 }, (_, i) => ({ day: `d${i}`, flights: i === 0 ? 1 : 0 }));
    const keys = await keysOpenedBy(
      <StatsChartsSection seasonalData={months} weekdayData={days} hasFlights />
    );
    expect(keys).toEqual(["ranking:departureMonth:3", "ranking:departureWeekday:0"]);
    expectServed(keys);
  });

  it("seats: every bar and tile opens the flights its seat was read from", async () => {
    const seats: SeatStats = {
      windowCount: 2,
      middleCount: 1,
      aisleCount: 0,
      unknownCount: 0,
      noSeatCount: 0,
      frontCount: 3,
      middleZoneCount: 0,
      backCount: 0,
      mostCommonSeat: "3A",
      avgRowNumber: 3,
      seatClassDistribution: { economy: 3 },
    };
    const keys = await keysOpenedBy(<StatsSeatSection seatStats={seats} />);
    expect(keys).toContain("ranking:seat:position:window");
    expect(keys).toContain("ranking:seat:zone:back");
    expect(keys).toContain("ranking:seat:number:3A");
    expect(keys).toContain("ranking:seat:row:numbered");
    expect(keys).toContain("ranking:seat:class:economy");
    expectServed(keys);
    expect(screen.getByTestId("seats-counting-help")).toBeTruthy();
  });

  it("seats without data say which entries would fill the section", async () => {
    cleanup();
    render(
      <StatsSeatSection
        seatStats={{
          windowCount: 0,
          middleCount: 0,
          aisleCount: 0,
          unknownCount: 0,
          noSeatCount: 4,
          frontCount: 0,
          middleZoneCount: 0,
          backCount: 0,
          mostCommonSeat: null,
          avgRowNumber: null,
          seatClassDistribution: {},
        }}
      />
    );
    expect(screen.getByText("stats:seats.noDataHint")).toBeTruthy();
  });

  const business: BusinessStats = {
    costPerKm: 0,
    costPerHour: 0,
    totalCost: null,
    totalDistance: 1000,
    seatClassDistribution: {},
    mostCommonCategory: null,
    airportDiversity: 2,
    avgFlightDuration: 1.5,
    busiestMonth: "Mar",
    busiestMonthFlights: 4,
    categoryDistribution: {},
  };

  it("business: rates open the priced flights, the busiest month its chart bar", async () => {
    const keys = await keysOpenedBy(<StatsBusinessSection businessStats={business} />);
    expect(keys).toContain("metric:businessTotalCost");
    expect(keys).toContain("ranking:departureMonth:3");
    expectServed(keys);
    // The month in the reader's language, not the server's "Mar".
    expect(screen.getByText("stats:months.mar")).toBeTruthy();
  });

  it("business: a rate over no priced flight is a dash, never 0", () => {
    cleanup();
    render(
      <MemoryRouter>
        <StatsBusinessSection businessStats={business} />
      </MemoryRouter>
    );
    expect(screen.queryByText(/0[.,]00/)).toBeNull();
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(3);
  });

  it("overview: the average opens the flight time it divides", async () => {
    const keys = await keysOpenedBy(
      <StatsOverviewCards
        totalFlights={3}
        totalFlightTime={6}
        avgFlightDuration={2}
        airlineCount={1}
      />
    );
    expect(keys).toEqual([
      "metric:flightCount",
      "metric:flightTimeMinutes",
      "metric:flightTimeMinutes",
      "metric:airlineCount",
    ]);
    expect(screen.getByTestId("overview-counting-help")).toBeTruthy();
  });

  it("punctuality: every tile opens the delay sample it is taken over", async () => {
    const keys = await keysOpenedBy(
      <PunctualitySection
        stats={{
          sampleSize: 4,
          avgDelayMinutes: 10,
          onTimeRate: 0.5,
          bestAirline: null,
          worstAirline: null,
          worstRoute: null,
        }}
      />
    );
    expect(new Set(keys)).toEqual(new Set(["metric:punctualitySampleSize"]));
    expect(keys).toHaveLength(6);
    expect(screen.getByTestId("punctuality-counting-help")).toBeTruthy();
  });
});
