import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AirportTooltip } from "./AirportTooltip";
import type { GeoJSONFeature } from "../types";

// Mock i18next used by useTranslation hook
vi.mock("../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: { count?: number }) => {
      if (key === "dashboard:airport.flightsTotal" && opts?.count === 1) return "flight total";
      if (key === "dashboard:airport.flightsTotal") return "flights total";
      if (key === "dashboard:airport.topRoutes") return "Top Routes";
      if (key === "dashboard:airport.flown") return "flown";
      return key;
    },
    i18n: { language: "en" },
  }),
}));

vi.mock("../hooks/useLocale", () => ({
  useLocale: () => "en-US",
}));

function makeFeature(overrides: Partial<GeoJSONFeature["properties"]> = {}): GeoJSONFeature {
  return {
    type: "Feature",
    properties: {
      id: "1",
      airline: "Lufthansa",
      flightNumber: "LH123",
      departureAirport: {
        iata: "MUC",
        icao: "EDDM",
        name: "Munich Airport",
        lat: 48.354,
        lon: 11.786,
      },
      arrivalAirport: {
        iata: "FRA",
        icao: "EDDF",
        name: "Frankfurt Airport",
        lat: 50.033,
        lon: 8.571,
      },
      departureTime: "2024-01-01T08:00:00Z",
      arrivalTime: "2024-01-01T09:00:00Z",
      status: "flown",
      distance: 300,
      ...overrides,
    },
    geometry: {
      type: "LineString",
      coordinates: [
        [11.786, 48.354],
        [8.571, 50.033],
      ],
    },
  };
}

describe("AirportTooltip", () => {
  it("shows IATA code", () => {
    render(
      <AirportTooltip
        iata="MUC"
        screenX={100}
        screenY={100}
        flights={[makeFeature()]}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("MUC")).toBeInTheDocument();
  });

  it("counts flights touching the airport", () => {
    render(
      <AirportTooltip
        iata="MUC"
        screenX={100}
        screenY={100}
        flights={[makeFeature(), makeFeature({ id: "2" })]}
        onClose={() => {}}
      />
    );
    // Two departures from MUC → "2" total with 2↑ 0↓
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText(/2↑ 0↓/)).toBeInTheDocument();
  });

  it("shows ICAO code from departure flight", () => {
    render(
      <AirportTooltip
        iata="MUC"
        screenX={100}
        screenY={100}
        flights={[makeFeature()]}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("EDDM")).toBeInTheDocument();
  });

  it("shows ICAO code from arrival flight", () => {
    render(
      <AirportTooltip
        iata="FRA"
        screenX={100}
        screenY={100}
        flights={[makeFeature()]}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("EDDF")).toBeInTheDocument();
  });

  it("airport km line sums flown flights only", () => {
    render(
      <AirportTooltip
        iata="MUC"
        screenX={100}
        screenY={100}
        flights={[
          makeFeature({ id: "1", status: "flown", distance: 1000 }),
          makeFeature({ id: "2", status: "scheduled", distance: 5000 }),
        ]}
        onClose={() => {}}
      />
    );
    expect(screen.getByText(/1,000 km/)).toBeInTheDocument();
    expect(screen.queryByText(/6,000 km/)).toBeNull();
  });

  it("does not render ICAO when unavailable", () => {
    const feature = makeFeature({
      departureAirport: { iata: "MUC", name: "Munich Airport" },
      arrivalAirport: { iata: "FRA", name: "Frankfurt Airport" },
    });
    render(
      <AirportTooltip
        iata="MUC"
        screenX={100}
        screenY={100}
        flights={[feature]}
        onClose={() => {}}
      />
    );
    // no 4-letter ICAO visible
    expect(screen.queryByText("EDDM")).toBeNull();
  });
});
