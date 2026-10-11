import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { TripGroundLists, groundRideCount } from "../TripGroundLists";
import type { Trip } from "../../../types";

/**
 * The logistics tab listed flights, cruises and train rides and not the bus
 * ride beside them, and called a bus-only trip empty (forgejo#288 sweep).
 */
const ride = {
  id: "b1",
  depStationName: "Busstadt ZOB",
  arrStationName: "Probeburg ZOB",
  depTimezone: "Europe/Berlin",
  arrTimezone: "Europe/Berlin",
  departureTime: "2026-07-01T08:00:00.000Z",
  arrivalTime: "2026-07-01T11:00:00.000Z",
};

describe("TripGroundLists", () => {
  it("counts a bus ride as something the trip holds", () => {
    expect(groundRideCount({ busJourneys: [ride] } as unknown as Trip)).toBe(1);
    expect(groundRideCount({} as Trip)).toBe(0);
  });

  it("lists a bus ride and links it to its own page", () => {
    render(
      <MemoryRouter>
        <TripGroundLists trip={{ busJourneys: [ride] } as unknown as Trip} />
      </MemoryRouter>
    );
    expect(screen.getByTestId("trip-bus-list")).toBeInTheDocument();
    expect(screen.getByText(/Busstadt ZOB/)).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/bus/b1");
  });

  it("draws no bus list for a trip without bus rides", () => {
    render(
      <MemoryRouter>
        <TripGroundLists trip={{ busJourneys: [] } as unknown as Trip} />
      </MemoryRouter>
    );
    expect(screen.queryByTestId("trip-bus-list")).toBeNull();
  });
});
