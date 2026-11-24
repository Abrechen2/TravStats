import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import YearCard from "./YearCard";
import type { YearCardData } from "../../../types/yearStats";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
    i18n: { language: "de" },
  }),
}));

const months = (over: Record<number, Partial<YearCardData["months"][number]>>) =>
  Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    loggedKm: null,
    byDomain: {},
    recordedKm: null,
    ...over[i + 1],
  }));

const renderCard = (card: YearCardData) =>
  render(
    <MemoryRouter>
      <YearCard card={card} />
    </MemoryRouter>
  );

describe("YearCard", () => {
  it("links the year to the map and shows only the months that have a distance as bars", () => {
    renderCard({
      year: 2024,
      loggedKm: 1500,
      recordedKm: null,
      months: months({
        3: { loggedKm: 1000, byDomain: { flight: 1000 } },
        7: { loggedKm: 500, byDomain: { rail: 500 } },
      }),
    });
    expect(screen.getByTestId("year-map-link-2024").getAttribute("href")).toBe(
      "/dashboard?year=2024"
    );
    expect((screen.getByTestId("year-bar-2024-3") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByTestId("year-bar-2024-4") as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByTestId("year-bar-2024-4").children).toHaveLength(0);
  });

  it("a year with no measured distance says so and draws no chart or zero bar", () => {
    renderCard({ year: 2021, loggedKm: null, recordedKm: null, months: months({}) });
    expect(screen.getByTestId("year-total-2021").textContent).toBe("stats:years.noDistance");
    expect(screen.queryByTestId("year-bar-2021-1")).toBeNull();
  });

  it("a month click lists its domains, each linking to that domain's logbook for the year", () => {
    renderCard({
      year: 2024,
      loggedKm: 1500,
      recordedKm: null,
      months: months({ 3: { loggedKm: 1500, byDomain: { flight: 1000, rail: 500 } } }),
    });
    fireEvent.click(screen.getByTestId("year-bar-2024-3"));
    const links = screen.getAllByTestId(/year-month-link-/);
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/flights?year=2024&month=3",
      "/rail?year=2024",
    ]);
  });

  it("shows recorded km on its own line, apart from the logged total", () => {
    renderCard({
      year: 2024,
      loggedKm: 300,
      recordedKm: 310,
      months: months({ 5: { loggedKm: 300, byDomain: { rail: 300 }, recordedKm: 310 } }),
    });
    expect(screen.getByText(/stats:years.recordedLine/)).toBeTruthy();
    expect(screen.getByTestId("year-total-2024").textContent).not.toContain("610");
  });
});
