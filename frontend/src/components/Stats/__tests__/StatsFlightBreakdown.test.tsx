import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: { count?: number }) =>
      opts?.count !== undefined ? `${k}:${opts.count}` : k,
    i18n: { language: "de" },
  }),
}));

import StatsFlightBreakdown from "../StatsFlightBreakdown";

// forgejo#81 — the four flights without an airline used to form a group whose
// label was "", drawn as an empty row in "Top Fluggesellschaften".
describe("StatsFlightBreakdown — airlines", () => {
  it("renders no row for flights without an airline, and says how many were left out", () => {
    // The "without airline" note is a real `<button>` since Task 9, which
    // needs `useSearchParams`; so are the airport/aircraft rows below it.
    render(
      <MemoryRouter>
        <StatsFlightBreakdown
          sortedAirlines={[
            ["iata:LH", { label: "Lufthansa", count: 3, totalDuration: 6, flights: [] }],
          ]}
          flightsWithoutAirline={4}
          sortedAirports={[]}
          seatClassStats={{}}
          sortedAircraft={[]}
          statusStats={{}}
          boardingGroupStats={{}}
          longestFlight={undefined}
          shortestFlight={undefined}
          totalFlights={7}
        />
      </MemoryRouter>
    );

    expect(screen.getByText("Lufthansa")).toBeInTheDocument();
    expect(screen.getByText("stats:airlines.withoutAirline:4")).toBeInTheDocument();
  });

  it("says nothing when every flight names its airline", () => {
    render(
      <MemoryRouter>
        <StatsFlightBreakdown
          sortedAirlines={[
            ["iata:LH", { label: "Lufthansa", count: 3, totalDuration: 6, flights: [] }],
          ]}
          flightsWithoutAirline={0}
          sortedAirports={[]}
          seatClassStats={{}}
          sortedAircraft={[]}
          statusStats={{}}
          boardingGroupStats={{}}
          longestFlight={undefined}
          shortestFlight={undefined}
          totalFlights={3}
        />
      </MemoryRouter>
    );

    expect(screen.queryByText(/withoutAirline/)).toBeNull();
  });
});
