import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

import RoadtripDetailPage from "../RoadtripDetailPage";
import { roadtripsApi } from "../../lib/api/roadtrips";
import { toursApi } from "../../lib/api/tours";
import type { RoadtripDetail } from "../../types/roadtrip";

vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/Trips/TripMap", () => ({ default: () => <div data-testid="map" /> }));
vi.mock("../../components/Roadtrips/StationEditor", () => ({
  default: ({ start }: { start: string }) => <div data-testid="editor">{start}</div>,
}));
vi.mock("../../lib/api/roadtrips", () => ({ roadtripsApi: { get: vi.fn() } }));
vi.mock("../../lib/api/tours", () => ({
  toursApi: {
    geometry: vi.fn(async () => ({ type: "FeatureCollection", features: [] })),
    removeStandalone: vi.fn(),
  },
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
  expenses: [],
  costs: { total: {}, byStation: [], byLeg: [], unpinned: {} },
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
    vi.setSystemTime(new Date("2026-09-25T12:00:00.000Z")); // an instant, not the host's noon
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

  it("asks once more before deleting a roadtrip's costs with it, then sends the opt-in", async () => {
    // forgejo#140: a roadtrip with costs and no trip answers 409 with the count.
    vi.mocked(toursApi.removeStandalone)
      .mockRejectedValueOnce(
        Object.assign(new Error("conflict"), {
          isAxiosError: true,
          response: { status: 409, data: { code: "SECTION_HAS_EXPENSES", expenseCount: 2 } },
        })
      )
      .mockResolvedValueOnce(undefined);
    renderAt("/roadtrips/rt");
    fireEvent.click(await screen.findByText("roadtrips:delete"));
    fireEvent.click(screen.getByText("roadtrips:deleteConfirm.confirm"));
    fireEvent.click(await screen.findByText("roadtrips:deleteWithCosts.confirm"));
    await waitFor(() => expect(toursApi.removeStandalone).toHaveBeenCalledTimes(2));
    expect(vi.mocked(toursApi.removeStandalone).mock.calls).toEqual([
      ["rt", { deleteExpenses: false }],
      ["rt", { deleteExpenses: true }],
    ]);
  });

  // forgejo#243: the same stations, read day by day.
  it("switches between the stations and the day-by-day view", async () => {
    vi.mocked(roadtripsApi.get).mockResolvedValue({
      ...DETAIL,
      stations: [
        {
          id: "s1",
          title: "Bergen",
          lat: 60.39,
          lon: 5.32,
          startDate: at("2026-09-18"),
          endDate: at("2026-09-19"),
          notes: null,
          order: 0,
          state: "free",
          lodgingStayId: null,
          stay: null,
        },
      ],
    });
    renderAt("/roadtrips/rt");
    const days = await screen.findByRole("button", { name: "roadtrips:days.view.days" });
    expect(days).toHaveAttribute("aria-pressed", "false");
    fireEvent.click(days);
    expect(days).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("roadtrips:days.title")).toBeInTheDocument();
    expect(screen.getByText(/^roadtrips:timeline.day · /)).toBeInTheDocument();
  });

  it("arrives from “Heutige Nacht eintragen” with the editor open on tonight", async () => {
    renderAt("/roadtrips/rt?station=heute");
    expect(await screen.findByTestId("editor")).toHaveTextContent("today");
  });
});
