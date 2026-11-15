import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import AircraftRankingCard from "../AircraftRankingCard";
import type { AircraftRankingItem } from "../../../types/aircraft";

const hull = (n: number, over: Partial<AircraftRankingItem> = {}): AircraftRankingItem => ({
  registration: `D-AB${String(n).padStart(2, "0")}`,
  count: 20 - n,
  airline: "Lufthansa",
  aircraft: "Airbus A320neo",
  totalDistanceKm: 1000,
  firstFlightDate: "2025-01-02T06:00:00.000Z",
  lastFlightDate: "2026-03-04T06:00:00.000Z",
  ...over,
});

const renderCard = (data: Parameters<typeof AircraftRankingCard>[0]["aircraft"]) =>
  render(
    <MemoryRouter>
      <AircraftRankingCard aircraft={data} />
    </MemoryRouter>
  );

describe("the aircraft section (forgejo#303)", () => {
  it("lists a registration with its type, airline and flight count", () => {
    renderCard({ aircraft: [hull(1)], total: 1, withoutRegistration: 0 });
    const row = within(screen.getByTestId("aircraft-table")).getByText("D-AB01").closest("tr")!;
    expect(within(row).getByText("Airbus A320neo")).toBeInTheDocument();
    expect(within(row).getByText("Lufthansa")).toBeInTheDocument();
    expect(within(row).getByText("19")).toBeInTheDocument();
  });

  it("states flights without a registration apart, and says nothing when there are none", () => {
    const { unmount } = renderCard({ aircraft: [hull(1)], total: 1, withoutRegistration: 3 });
    expect(screen.getByTestId("aircraft-unregistered")).toBeInTheDocument();
    unmount();
    renderCard({ aircraft: [hull(1)], total: 1, withoutRegistration: 0 });
    expect(screen.queryByTestId("aircraft-unregistered")).toBeNull();
  });

  it("shows a missing type or airline as a dash, never as 'unknown'", () => {
    renderCard({
      aircraft: [hull(1, { aircraft: null, airline: null })],
      total: 1,
      withoutRegistration: 0,
    });
    const row = screen.getByText("D-AB01").closest("tr")!;
    expect(within(row).getAllByText("—").length).toBeGreaterThanOrEqual(2);
  });

  it("shows the first ten and reveals every registration on request", () => {
    const aircraft = Array.from({ length: 12 }, (_, i) => hull(i + 1));
    renderCard({ aircraft, total: 12, withoutRegistration: 0 });
    expect(screen.queryByText("D-AB12")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: /showAll/ }));
    expect(screen.getByText("D-AB12")).toBeInTheDocument();
  });
});

describe("the aircraft section with no registration at all (forgejo#303)", () => {
  it("still states how many flights lack one", () => {
    render(
      <MemoryRouter>
        <AircraftRankingCard aircraft={{ aircraft: [], total: 0, withoutRegistration: 5 }} />
      </MemoryRouter>
    );
    expect(screen.getByTestId("aircraft-unregistered")).toBeInTheDocument();
  });
});
