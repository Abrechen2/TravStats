import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import type { BusStats } from "../../../../types/bus";

/**
 * forgejo#263 — the bus tab draws the server's figures, names each sample,
 * abstains where a ride says nothing, and compares a running year with the
 * same span of another.
 */
const STATS: BusStats = {
  rides: 4,
  distance: { totalKm: 825, straightLineKm: 255, routeKm: 290, ticketKm: 280, unmeasuredRides: 1 },
  hoursOnBoard: { hours: 0, measuredRides: 0 },
  countries: ["CZ", "DE"],
  operators: [{ label: "FlixBus", count: 3 }],
  rideKinds: [
    { label: "unknown", count: 3 },
    { label: "intercity", count: 1 },
  ],
  terminals: [{ label: "Berlin ZOB", count: 4 }],
  terminalsVisited: 3,
  longest: {
    id: "4b0c5c7e-7e53-4d8c-8d67-0b2b9e1e1a11",
    depStationName: "Berlin ZOB",
    arrStationName: "Praha Florenc",
    distanceKm: 290,
    distanceSource: "route",
  },
  delays: {
    recordedRides: 0,
    averageMinutes: null,
    buckets: [0, 5, 15, 30, 60, null].map((upToMinutes) => ({ upToMinutes, count: 0 })),
  },
  byYear: [
    { year: 2024, rides: 1, km: 255 },
    { year: 2025, rides: 3, km: 570 },
  ],
  journeys: { total: 3, withTransfer: 1 },
  transfers: { count: 1, averageMinutes: 45 },
  favouriteConnections: [],
  newDestinations: { inScope: 2, byYear: [{ year: 2025, count: 2 }] },
  longestReturn: null,
  night: { rides: 1, nights: 1 },
};

vi.mock("../../../../lib/api/bus", () => ({
  busApi: { stats: vi.fn(async () => STATS) },
}));

import BusStatsSection from "../BusStatsSection";
import { busApi } from "../../../../lib/api/bus";
import { EVIDENCE_MEASURES } from "../../../../shared/evidenceMeasures";
import { evidenceOpenedBy } from "../../__tests__/evidenceKeysOpened";
import { expectNoNestedTriggers } from "../../__tests__/noNestedTriggers";

const visibility = { isVisible: () => true, toggle: vi.fn(), reset: vi.fn(), hiddenCount: 0 };
const draw = (scope = { year: null as number | null, compareYear: null as number | null }) =>
  render(
    <MemoryRouter>
      <BusStatsSection scope={scope} visibility={visibility} />
    </MemoryRouter>
  );

describe("BusStatsSection", () => {
  beforeEach(() => vi.mocked(busApi.stats).mockClear());

  it("draws km per source and abstains on hours nobody measured", async () => {
    draw();
    expect(await screen.findByTestId("bus-km-split")).toHaveTextContent("bus:stats.kmRoute");
    expect(screen.getByTestId("bus-km-split")).toHaveTextContent("bus:stats.kmStraight");
    const hours = screen.getByRole("heading", { name: "bus:stats.hours" }).parentElement!;
    expect(within(hours).getByText("–")).toBeInTheDocument();
    // An unrecorded delay is no figure: the chart says so instead of a zero bar.
    expect(screen.getByText("bus:stats.noDelays")).toBeInTheDocument();
    expect(screen.getByText("bus:stats.kindUnknown")).toBeInTheDocument();
  });

  it("compares a running year with the same span of the other", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(Date.UTC(2026, 8, 26, 12)));
    try {
      draw({ year: 2026, compareYear: 2025 });
      await waitFor(() => expect(busApi.stats).toHaveBeenCalledWith(2025, "09-26"));
      expect(busApi.stats).toHaveBeenCalledWith(2026, "09-26");
    } finally {
      vi.useRealTimers();
    }
  });

  it("says what fills an empty tab instead of drawing zeros", async () => {
    vi.mocked(busApi.stats).mockResolvedValueOnce({ ...STATS, rides: 0 });
    draw();
    expect(await screen.findByTestId("bus-stats-empty")).toHaveTextContent("bus:stats.empty");
  });

  // forgejo#263 — hours, change time, longest pause and longest ride opened nothing.
  it("opens served measures from every figure; the longest pause is lifetime", async () => {
    vi.mocked(busApi.stats).mockResolvedValue({
      ...STATS,
      longestReturn: { days: 40, terminal: "Berlin ZOB" },
    });
    const { opened, container } = await evidenceOpenedBy(
      <BusStatsSection scope={{ year: 2025, compareYear: null }} visibility={visibility} />,
      () => screen.findByTestId("bus-km-split")
    );
    const keys = opened.map((o) => o.key);
    expect(keys).toEqual(
      expect.arrayContaining([
        "busHoursOnBoard",
        "busTransferCount",
        "busLongestReturn",
        "busLongestRide",
      ])
    );
    expect(keys.filter((key) => EVIDENCE_MEASURES[key]?.servedIn !== 1)).toEqual([]);
    expect(opened.find((o) => o.key === "busLongestReturn")?.scope).toEqual({ period: "allTime" });
    expect(opened.find((o) => o.key === "busLongestRide")?.scope).toEqual({
      period: "year",
      year: 2025,
    });
    expectNoNestedTriggers(container);
    vi.mocked(busApi.stats).mockImplementation(async () => STATS);
  });
});
