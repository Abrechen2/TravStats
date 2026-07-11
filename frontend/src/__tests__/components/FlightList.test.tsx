import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import FlightList from "../../components/FlightList";
import type { Flight } from "../../types";

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, opts?: Record<string, unknown>) => (opts ? `${k}:${JSON.stringify(opts)}` : k),
  }),
}));

vi.mock("../../components/DataSourceBadges", () => ({
  default: () => null,
}));

vi.mock("../../components/AirlineLogo", () => ({
  default: (props: { iata?: string; flightNumber?: string }) => (
    <div data-testid="airline-logo" data-iata={props.iata ?? ""} />
  ),
}));

const baseFlight: Flight = {
  id: "1",
  userId: "u1",
  airline: "LH",
  flightNumber: "LH123",
  depLat: 50.033,
  depLon: 8.571,
  arrLat: 48.354,
  arrLon: 11.786,
  departureTime: "2026-06-01T10:00:00.000Z",
  arrivalTime: "2026-06-01T11:00:00.000Z",
  status: "flown",
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("FlightList delay + CO₂", () => {
  it("shows delay badge when delayMinutes > 0", () => {
    render(
      <FlightList
        flights={[{ ...baseFlight, delayMinutes: 25 }]}
        onFlightClick={vi.fn()}
        onEditFlight={vi.fn()}
        onDeleteFlight={vi.fn()}
      />
    );
    expect(document.querySelector('[data-testid="delay-badge"]')).not.toBeNull();
  });

  it("shows early badge when delayMinutes < 0", () => {
    render(
      <FlightList
        flights={[{ ...baseFlight, delayMinutes: -10 }]}
        onFlightClick={vi.fn()}
        onEditFlight={vi.fn()}
        onDeleteFlight={vi.fn()}
      />
    );
    expect(document.querySelector('[data-testid="delay-badge"]')).not.toBeNull();
  });

  it("shows CO₂ chip when co2Kg is set", () => {
    render(
      <FlightList
        flights={[{ ...baseFlight, co2Kg: 78 }]}
        onFlightClick={vi.fn()}
        onEditFlight={vi.fn()}
        onDeleteFlight={vi.fn()}
      />
    );
    expect(document.querySelector('[data-testid="co2-chip"]')).not.toBeNull();
  });

  it("does not show delay badge when delayMinutes is undefined", () => {
    render(
      <FlightList
        flights={[baseFlight]}
        onFlightClick={vi.fn()}
        onEditFlight={vi.fn()}
        onDeleteFlight={vi.fn()}
      />
    );
    expect(document.querySelector('[data-testid="delay-badge"]')).toBeNull();
  });
});

describe("FlightList airline code resolution (issue #178)", () => {
  it("resolves an ICAO airline code to its full name", () => {
    render(
      <FlightList
        flights={[{ ...baseFlight, airline: "DLH", flightNumber: "DLH123" }]}
        onFlightClick={vi.fn()}
        onEditFlight={vi.fn()}
        onDeleteFlight={vi.fn()}
      />
    );
    expect(screen.getByText(/Lufthansa/)).toBeInTheDocument();
  });

  it("shows the raw code for an unknown airline code, never empty or 'undefined'", () => {
    render(
      <FlightList
        flights={[{ ...baseFlight, airline: "ZZZ", flightNumber: "ZZZ123" }]}
        onFlightClick={vi.fn()}
        onEditFlight={vi.fn()}
        onDeleteFlight={vi.fn()}
      />
    );
    expect(screen.getByText(/ZZZ/)).toBeInTheDocument();
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });

  it("passes the resolved IATA code to the logo when only an ICAO code is stored", () => {
    render(
      <FlightList
        flights={[{ ...baseFlight, airline: "DLH", flightNumber: "DLH123" }]}
        onFlightClick={vi.fn()}
        onEditFlight={vi.fn()}
        onDeleteFlight={vi.fn()}
      />
    );
    expect(screen.getByTestId("airline-logo").getAttribute("data-iata")).toBe("LH");
  });

  it("passes the structured airlineIcao column's IATA to the logo, preferring it over free text", () => {
    render(
      <FlightList
        flights={[
          { ...baseFlight, airline: "unrelated text", airlineIcao: "EWG", flightNumber: "EW123" },
        ]}
        onFlightClick={vi.fn()}
        onEditFlight={vi.fn()}
        onDeleteFlight={vi.fn()}
      />
    );
    expect(screen.getByTestId("airline-logo").getAttribute("data-iata")).toBe("EW");
  });
});
