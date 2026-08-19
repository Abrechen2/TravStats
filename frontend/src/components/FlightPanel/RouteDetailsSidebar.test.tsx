import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RouteDetailsSidebar } from "./RouteDetailsSidebar";
import type { Flight } from "../../types";

// Mock i18next used by useTranslation hook — mirrors AirportTooltip.test.tsx.
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      if (key === "dashboard:flown") return "geflogen";
      if (key === "dashboard:planned") return "geplant";
      if (key === "common:buttons.back") return "Zurück";
      if (key === "dashboard:flightsOnRoute") return "Flüge auf dieser Route";
      return key;
    },
    i18n: { language: "de" },
  }),
}));

vi.mock("../../hooks/useLocale", () => ({
  useLocale: () => "de-DE",
}));

function makeFlight(overrides: Partial<Flight> = {}): Flight {
  return {
    id: "f1",
    userId: "u1",
    airline: "Lufthansa",
    flightNumber: "LH123",
    depIata: "MUC",
    depName: "Munich",
    depLat: 48.35,
    depLon: 11.78,
    arrIata: "FRA",
    arrName: "Frankfurt",
    arrLat: 50.03,
    arrLon: 8.57,
    departureTime: "2024-01-01T08:00:00Z",
    arrivalTime: "2024-01-01T09:00:00Z",
    status: "flown",
    createdAt: "2024-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("RouteDetailsSidebar", () => {
  it("route sidebar separates flown and planned legs", () => {
    const flights = [
      makeFlight({ id: "1", status: "flown" }),
      makeFlight({ id: "2", status: "flown" }),
      makeFlight({ id: "3", status: "scheduled" }),
    ];
    render(<RouteDetailsSidebar flights={flights} onBack={() => {}} />);
    expect(screen.getByText(/2× geflogen/)).toBeInTheDocument();
    expect(screen.getByText(/1× geplant/)).toBeInTheDocument();
    expect(screen.queryByText(/3× geflogen/)).toBeNull();
    expect(screen.queryByText(/3× geplant/)).toBeNull();
  });

  it("falls back to the legacy label when nothing is flown or planned (cancelled-only)", () => {
    const flights = [makeFlight({ id: "1", status: "cancelled" })];
    render(<RouteDetailsSidebar flights={flights} onBack={() => {}} />);
    expect(screen.getByText(/1× geflogen/)).toBeInTheDocument();
  });
});
