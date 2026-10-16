import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

import type { FerryJourney } from "../../../../types/ferry";

/**
 * Ferry had figures on the overview card and no tab of its own. The tab draws
 * the card's own figures (`adaptFerry`), for the picked year on the departure
 * port's calendar, counts only completed crossings, abstains on hours no
 * crossing can answer, and says a failed load instead of drawing zeros.
 */
const crossing = (over: Partial<FerryJourney>): FerryJourney =>
  ({
    id: "f",
    status: "completed",
    operator: "Stena Line",
    depStationName: "Kiel",
    arrStationName: "Göteborg",
    depCountry: "DE",
    arrCountry: "SE",
    depTimezone: "Europe/Berlin",
    arrTimezone: "Europe/Stockholm",
    departureTime: "2025-06-10T16:45:00.000Z",
    arrivalTime: "2025-06-11T07:15:00.000Z",
    distanceKm: 432,
    distanceSource: "great_circle",
    ...over,
  }) as FerryJourney;

const CROSSINGS = [
  crossing({ id: "a" }),
  crossing({ id: "b", departureTime: "2024-07-01T08:00:00.000Z", arrivalTime: null }),
  crossing({ id: "c", status: "cancelled" }),
];

const listAll = vi.fn(async () => CROSSINGS);
vi.mock("../../../../lib/api/ferry", () => ({ ferryApi: { listAll: () => listAll() } }));

import FerryStatsSection from "../FerryStatsSection";

const visibility = { isVisible: () => true, toggle: vi.fn(), reset: vi.fn(), hiddenCount: 0 };
const draw = (year: number | null) =>
  render(<FerryStatsSection scope={{ year }} visibility={visibility} />);

describe("FerryStatsSection", () => {
  beforeEach(() => listAll.mockClear());

  it("counts the completed crossings of the picked year only", async () => {
    draw(2025);
    expect(await screen.findByTestId("ferry-stats")).toBeTruthy();
    expect(screen.getByText("ferry:stats.crossings").parentElement?.textContent).toContain("1");
    expect(screen.getByTestId("ferry-km-split").textContent).toContain("ferry:stats.kmStraight");
  });

  it("abstains on hours when no crossing of the year carries both times", async () => {
    draw(2024);
    await screen.findByTestId("ferry-stats");
    expect(screen.getByText("ferry:stats.hours").parentElement?.textContent).toContain("–");
  });

  it("says a year without crossings is empty", async () => {
    draw(2019);
    expect(await screen.findByTestId("ferry-stats-empty")).toBeTruthy();
  });

  it("says a failed load instead of drawing zeros", async () => {
    listAll.mockRejectedValueOnce(new Error("offline"));
    draw(null);
    expect(await screen.findByText("ferry:stats.loadError")).toBeTruthy();
  });
});
