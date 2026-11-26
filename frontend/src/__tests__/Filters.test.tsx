import { yearTrigger, openYearGrid } from "./helpers/yearPicker";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Filters from "../components/Filters";
import { flightsApi } from "../lib/api";
import type { Flight } from "../types";

vi.mock("../lib/api");

describe("Filters", () => {
  const mockOnFilterChange = vi.fn();

  const mockFlight: Flight = {
    id: "1",
    userId: "user-1",
    airline: "Lufthansa",
    flightNumber: "LH100",
    depIata: "FRA",
    depName: "Frankfurt Airport",
    depLat: 50.0333,
    depLon: 8.5706,
    arrIata: "MUC",
    arrName: "Munich Airport",
    arrLat: 48.3538,
    arrLon: 11.7861,
    departureTime: "2024-01-15T10:00:00Z",
    arrivalTime: "2024-01-15T12:00:00Z",
    status: "flown",
    createdAt: "2024-01-15T08:00:00Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(flightsApi.getAll).mockResolvedValue({
      flights: [mockFlight],
      total: 1,
      limit: 500,
      offset: 0,
    });
  });

  it("should render filter button", () => {
    render(<Filters onFilterChange={mockOnFilterChange} />);

    // Button text is i18n key: map:filters.title
    expect(screen.getByText(/map:filters\.title/i)).toBeInTheDocument();
  });

  it("should open filter panel on click", async () => {
    render(<Filters onFilterChange={mockOnFilterChange} />);

    const filterButton = screen.getByText(/map:filters\.title/i);
    fireEvent.click(filterButton);

    await waitFor(() => {
      // The panel opens and shows filter-specific content like allYears
      expect(yearTrigger("map:filters.timePeriod")).toBeInTheDocument();
    });
  });

  it("should apply year filter", async () => {
    render(<Filters onFilterChange={mockOnFilterChange} />);

    const filterButton = screen.getByText(/map:filters\.title/i);
    fireEvent.click(filterButton);

    // The years come from the flights the component loads, so the cell arrives async.
    await waitFor(() =>
      expect(openYearGrid("map:filters.timePeriod").map((b) => b.textContent)).toContain("2024")
    );
    mockOnFilterChange.mockClear();
    fireEvent.click(
      openYearGrid("map:filters.timePeriod").find((b) => b.textContent === "2024") as HTMLElement
    );

    await waitFor(() => {
      expect(mockOnFilterChange).toHaveBeenCalled();
    });
  });
});
