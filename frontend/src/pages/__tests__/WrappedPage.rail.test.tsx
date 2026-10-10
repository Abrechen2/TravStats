import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import type { Wrapped } from "../../types/wrapped";

/**
 * Dein Jahr tells a year of train rides (2.7) — only where rail is visible,
 * like every rail surface, and with its straight-line kilometres said as such
 * (owner decision 7 of the rail spec).
 */

const getWrappedMock = vi.fn();
vi.mock("../../lib/api", () => ({
  statsApi: { getWrapped: (year?: number) => getWrappedMock(year) },
}));

vi.mock("../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: ["flight"],
    isEnabled: (key: string) => key === "flight",
  }),
}));

vi.mock("../../components/NavigationBar", () => ({
  default: () => <div data-testid="nav-stub" />,
}));

import WrappedPage from "../WrappedPage";

const railYear: Wrapped = {
  year: 2025,
  availableYears: [2025],
  rank: "other",
  comparisonYear: null,
  flights: 0,
  distanceKm: 0,
  earthFactor: 0,
  newCountries: 2,
  // Cruises are switched off for this reader: the server abstains.
  cruises: null,
  railRides: 3,
  railKm: 721,
  railStraightLineKm: 300,
  topAirline: null,
  topRoute: null,
};

const renderPage = (): void => {
  render(
    <MemoryRouter initialEntries={["/wrapped"]}>
      <Routes>
        <Route path="/wrapped" element={<WrappedPage />} />
      </Routes>
    </MemoryRouter>
  );
};

describe("WrappedPage — rail", () => {
  beforeEach(() => {
    getWrappedMock.mockReset();
    getWrappedMock.mockResolvedValue(railYear);
  });

  it("tells a year of train rides with the straight-line part named", async () => {
    renderPage();
    expect(await screen.findByText("stats:wrapped.rail")).toBeInTheDocument();
    expect(screen.getByText("stats:wrapped.railDescStraight")).toBeInTheDocument();
    expect(screen.queryByText("stats:wrapped.emptyYear")).not.toBeInTheDocument();
  });

  // forgejo#265: the server answers null for rail the reader does not see,
  // and the page follows the payload.
  it("keeps rail out, and calls the year empty, while rail is not visible", async () => {
    getWrappedMock.mockResolvedValue({
      ...railYear,
      railRides: null,
      railKm: null,
      railStraightLineKm: null,
    });
    renderPage();
    expect(await screen.findByText("stats:wrapped.emptyYear")).toBeInTheDocument();
    expect(screen.queryByText("stats:wrapped.rail")).not.toBeInTheDocument();
  });
});
