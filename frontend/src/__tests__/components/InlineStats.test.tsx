import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { InlineStats } from "../../components/FlightPanel/InlineStats";
import type { Flight } from "../../types";

const baseFlight: Flight = {
  id: "f1",
  userId: "u1",
  airline: "LH",
  flightNumber: "LH404",
  depLat: 48.35,
  depLon: 11.79,
  arrLat: 40.64,
  arrLon: -73.78,
  departureTime: "2024-03-14T10:00:00Z",
  arrivalTime: "2024-03-14T19:45:00Z",
  status: "flown",
  createdAt: "2024-03-14T00:00:00Z",
};

describe("InlineStats", () => {
  it("shows distance derived from coordinates", () => {
    render(<InlineStats flight={baseFlight} />);
    // MUC to JFK is ~8280 km, expect some distance text
    expect(screen.getByText(/km/)).toBeInTheDocument();
  });

  it("prefers routeDistance over calculated distance", () => {
    render(<InlineStats flight={{ ...baseFlight, routeDistance: 9999 }} />);
    expect(screen.getByText(/9\.999 km/)).toBeInTheDocument();
  });

  it("shows duration", () => {
    render(<InlineStats flight={baseFlight} />);
    expect(screen.getByText(/9h 45m/)).toBeInTheDocument();
  });

  it("shows CO₂ when present", () => {
    render(<InlineStats flight={{ ...baseFlight, co2Kg: 0.9 }} />);
    expect(screen.getByText(/CO₂: 0\.9t/)).toBeInTheDocument();
  });

  it("shows aircraft when present", () => {
    render(<InlineStats flight={{ ...baseFlight, aircraft: "A350" }} />);
    expect(screen.getByText(/A350/)).toBeInTheDocument();
  });
});
