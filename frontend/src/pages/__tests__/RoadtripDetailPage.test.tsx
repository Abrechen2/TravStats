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
  costs: {
    total: {},
    totalBase: { currency: "EUR", amount: 0, unconverted: {} },
    byStation: [],
    byLeg: [],
    unpinned: {},
  },
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

  // forgejo#250: the question names what goes and what stays; the confirm is red.
  it("asks before deleting, naming what goes and what stays", async () => {
    vi.mocked(roadtripsApi.get).mockResolvedValue({
      ...DETAIL,
      trip: { id: "t", name: "Norwegen" },
    });
    renderAt("/roadtrips/rt");
    fireEvent.click(await screen.findByText("roadtrips:delete"));
    const dialog = screen.getByTestId("confirm-modal");
    expect(dialog).toHaveTextContent("roadtrips:deleteConfirm.goesEmpty");
    expect(dialog).toHaveTextContent("common:delete.survivors");
    const confirm = screen.getByRole("button", { name: "roadtrips:deleteConfirm.confirm" });
    expect(confirm.className).toContain("bg-[var(--danger)]");
    expect(toursApi.removeStandalone).not.toHaveBeenCalled();
  });

  it("arrives from “Heutige Nacht eintragen” with the editor open on tonight", async () => {
    renderAt("/roadtrips/rt?station=heute");
    expect(await screen.findByTestId("editor")).toHaveTextContent("today");
  });

  // forgejo#307: the head reads like every other domain's detail head.
  describe("header matches the other detail pages", () => {
    it("sits in the same list-width shell as rail, ferry, bus and rentals", async () => {
      renderAt("/roadtrips/rt");
      const title = await screen.findByText("Fjorde 2026");
      expect(title.closest("main")).toHaveStyle({ maxWidth: "var(--ts-width-list)" });
    });

    it("draws the phase with the shared status pill, underway as in progress", async () => {
      renderAt("/roadtrips/rt");
      const pill = await screen.findByText("roadtrips:phase.underway:8");
      expect(pill).toHaveClass("ts-status-pill");
      expect(pill).toHaveStyle({ color: "var(--ts-status-flown)" });
    });

    it("draws a planned roadtrip with the shared scheduled pill", async () => {
      vi.setSystemTime(new Date("2026-09-01T12:00:00.000Z"));
      renderAt("/roadtrips/rt");
      const pill = await screen.findByText("roadtrips:phase.planned");
      expect(pill).toHaveClass("ts-status-pill");
      expect(pill).toHaveStyle({ color: "var(--ts-status-scheduled)" });
    });

    it("offers “edit legs” as the shared button, which opens the section", async () => {
      render(
        <MemoryRouter initialEntries={["/roadtrips/rt"]}>
          <Routes>
            <Route path="/roadtrips/:id" element={<RoadtripDetailPage />} />
            <Route path="/tours/:id" element={<div data-testid="tour-page" />} />
          </Routes>
        </MemoryRouter>
      );
      const legs = await screen.findByRole("button", { name: "roadtrips:editLegs" });
      expect(legs).toHaveClass("ts-button");
      fireEvent.click(legs);
      expect(await screen.findByTestId("tour-page")).toBeInTheDocument();
    });

    it("draws “edit” as the same secondary button as the other detail pages", async () => {
      renderAt("/roadtrips/rt");
      const legs = await screen.findByRole("button", { name: "roadtrips:editLegs" });
      const edit = screen.getByRole("button", { name: "roadtrips:detail.edit" });
      expect(edit).toHaveAttribute("data-variant", "secondary");
      expect(legs).toHaveAttribute("data-variant", "secondary");
    });
  });
});
