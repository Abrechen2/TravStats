import { afterEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import RoadtripDetailPage from "../RoadtripDetailPage";
import { roadtripsApi } from "../../lib/api/roadtrips";
import { useRoadtripColorStore } from "../../store/roadtripColorStore";
import type { RoadtripDetail } from "../../types/roadtrip";

const drawn: Array<Array<{ rgb?: [number, number, number] }>> = [];
vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/Trips/TripMap", () => ({
  default: ({ tourGeometries }: { tourGeometries: Array<{ rgb?: [number, number, number] }> }) => {
    drawn.push(tourGeometries);
    return <div data-testid="map" />;
  },
}));
vi.mock("../../components/Roadtrips/StationEditor", () => ({ default: () => <div /> }));
vi.mock("../../lib/api/roadtrips", () => ({ roadtripsApi: { get: vi.fn() } }));
vi.mock("../../lib/api/tours", () => ({
  toursApi: {
    geometry: vi.fn(async () => ({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          geometry: {
            type: "LineString",
            coordinates: [
              [10, 50],
              [11, 51],
            ],
          },
          properties: {},
        },
      ],
    })),
  },
}));
vi.mock("../../lib/api/rerouteRuns", () => ({
  roadtripRerouteApi: { start: vi.fn(), latest: vi.fn(async () => null), cancel: vi.fn() },
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

const DETAIL = {
  roadtrip: { id: "rt", name: "Fjorde", color: "#8fa3b8", distanceKm: 0 },
  countries: [],
  trip: null,
  startDate: null,
  endDate: null,
  nights: { stayNights: 0, freeNights: 0, nights: 0, nightsKnown: true, placesSlept: 0 },
  stations: [],
  legs: [],
  tours: [],
  routingAvailable: true,
  expenses: [],
  costs: {
    total: {},
    totalBase: { currency: "EUR", amount: 0, unconverted: {} },
    byStation: [],
    byLeg: [],
    unpinned: {},
  },
} as unknown as RoadtripDetail;

afterEach(() => {
  drawn.length = 0;
  vi.clearAllMocks();
});

describe("RoadtripDetailPage map colour (#412)", () => {
  it("draws the roadtrip in its picked colour on its own page even in the single-colour mode", async () => {
    useRoadtripColorStore.setState({ mode: "single" });
    vi.mocked(roadtripsApi.get).mockResolvedValue(DETAIL);
    render(
      <MemoryRouter initialEntries={["/roadtrips/rt"]}>
        <Routes>
          <Route path="/roadtrips/:id" element={<RoadtripDetailPage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(drawn.some((g) => g.length > 0)).toBe(true));
    const last = drawn.filter((g) => g.length > 0).at(-1)!;
    expect(last[0].rgb).toEqual([0x8f, 0xa3, 0xb8]);
  });
});
