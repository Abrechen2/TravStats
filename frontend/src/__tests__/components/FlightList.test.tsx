import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
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
