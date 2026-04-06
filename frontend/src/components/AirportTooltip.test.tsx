import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { AirportTooltip } from "./AirportTooltip";
import type { Flight } from "../types";

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

function makeFlight(overrides: Partial<Flight> = {}): Flight {
  return {
    id: "1",
    userId: "u1",
    depIata: "MUC",
    depIcao: "EDDM",
    arrIata: "FRA",
    arrIcao: "EDDF",
    depName: "Munich Airport",
    arrName: "Frankfurt Airport",
    depLat: 48.354,
    depLon: 11.786,
    arrLat: 50.033,
    arrLon: 8.571,
    airline: "Lufthansa",
    status: "flown",
    ...overrides,
  } as Flight;
}

describe("AirportTooltip", () => {
  it("shows IATA code", () => {
    render(
      <AirportTooltip
        iata="MUC"
        screenX={100}
        screenY={100}
        flights={[makeFlight()]}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("MUC")).toBeInTheDocument();
  });

  it("shows ICAO code from departure flight", () => {
    render(
      <AirportTooltip
        iata="MUC"
        screenX={100}
        screenY={100}
        flights={[makeFlight({ depIata: "MUC", depIcao: "EDDM" })]}
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
        flights={[makeFlight({ arrIata: "FRA", arrIcao: "EDDF" })]}
        onClose={() => {}}
      />
    );
    expect(screen.getByText("EDDF")).toBeInTheDocument();
  });

  it("does not render ICAO when unavailable", () => {
    const flight = makeFlight({ depIata: "MUC", depIcao: undefined, arrIcao: undefined });
    render(
      <AirportTooltip
        iata="MUC"
        screenX={100}
        screenY={100}
        flights={[flight]}
        onClose={() => {}}
      />
    );
    // no 4-letter ICAO visible
    expect(screen.queryByText("EDDM")).toBeNull();
  });
});
