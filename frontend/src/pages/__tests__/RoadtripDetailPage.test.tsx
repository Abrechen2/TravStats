import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import RoadtripDetailPage from "../RoadtripDetailPage";
import { roadtripsApi } from "../../lib/api/roadtrips";
import type { RoadtripDetail } from "../../types/roadtrip";

vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/Trips/TripMap", () => ({ default: () => <div data-testid="map" /> }));
vi.mock("../../components/Roadtrips/StationEditor", () => ({
  default: ({ start }: { start: string }) => <div data-testid="editor">{start}</div>,
}));
vi.mock("../../lib/api/roadtrips", () => ({ roadtripsApi: { get: vi.fn() } }));
vi.mock("../../lib/api/tours", () => ({
  toursApi: { geometry: vi.fn(async () => ({ type: "FeatureCollection", features: [] })) },
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && "day" in o ? `${k}:${String(o.day)}` : k),
    i18n: { language: "de" },
  }),
}));

const at = (d: string) => `${d}T00:00:00.000Z`;

const DETAIL: RoadtripDetail = {
  roadtrip: {
    id: "rt",
    name: "Fjorde 2026",
    vehicle: "campervan",
    vehicleName: "Bulli Fritz",
    distanceKm: 1542,
    drivenKm: 1370,
    startOdometerKm: 84210,
    endOdometerKm: null,
  } as never,
  countries: ["DE", "DK", "NO"],
  trip: null,
  startDate: at("2026-09-18"),
  endDate: at("2026-09-28"),
  nights: { stayNights: 8, freeNights: 2, nights: 10, nightsKnown: false, placesSlept: 6 },
  stations: [],
  legs: [],
  tours: [],
  routingAvailable: true,
};

function renderAt(path: string): void {
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/roadtrips/:id" element={<RoadtripDetailPage />} />
      </Routes>
    </MemoryRouter>
  );
}

describe("RoadtripDetailPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 25, 12));
    vi.mocked(roadtripsApi.get).mockResolvedValue(DETAIL);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("heads the page with where the trip stands and its figures, ≈ where a night is a guess", async () => {
    renderAt("/roadtrips/rt");
    expect(await screen.findByText("Fjorde 2026")).toBeInTheDocument();
    expect(screen.getByText("roadtrips:phase.underway:8")).toBeInTheDocument();
    expect(screen.getByText("1.370 km")).toBeInTheDocument();
    expect(screen.getByText("≈ 10")).toBeInTheDocument();
    expect(screen.getAllByText("roadtrips:detail.approxHint").length).toBeGreaterThan(0);
  });

  it("turns the stations into the editor in place", async () => {
    renderAt("/roadtrips/rt");
    fireEvent.click(await screen.findByText("roadtrips:detail.edit"));
    expect(screen.getByTestId("editor")).toHaveTextContent("plain");
    expect(screen.getByTestId("map")).toBeInTheDocument();
  });

  it("arrives from “Heutige Nacht eintragen” with the editor open on tonight", async () => {
    renderAt("/roadtrips/rt?station=heute");
    expect(await screen.findByTestId("editor")).toHaveTextContent("today");
  });
});
