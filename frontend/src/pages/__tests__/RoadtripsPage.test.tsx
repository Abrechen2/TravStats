import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import RoadtripsPage from "../RoadtripsPage";
import { roadtripsApi } from "../../lib/api/roadtrips";
import type { RoadtripSummary } from "../../types/roadtrip";

vi.mock("../../components/NavigationBar", () => ({ default: () => <div /> }));
vi.mock("../../components/Roadtrips/KindReviewNotice", () => ({ default: () => null }));
vi.mock("../../components/Roadtrips/NewRoadtripDialog", () => ({ default: () => null }));
vi.mock("../../lib/api/roadtrips", () => ({
  roadtripsApi: { list: vi.fn(), get: vi.fn(() => new Promise(() => {})) },
}));
vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && "day" in o ? `${k}:${String(o.day)}` : k),
    i18n: { language: "de" },
  }),
}));

function summary(over: Partial<RoadtripSummary>): RoadtripSummary {
  return {
    id: "r",
    kind: "roadtrip",
    tripId: null,
    tripName: null,
    name: "R",
    mode: "road",
    color: null,
    vehicle: "campervan",
    vehicleName: null,
    kindAssignedAutomatically: false,
    startDate: null,
    endDate: null,
    distanceKm: 100,
    drivenKm: 90,
    startOdometerKm: null,
    endOdometerKm: null,
    stationCount: 3,
    stayNights: 1,
    freeNights: 1,
    nights: 2,
    nightsKnown: true,
    placesSlept: 2,
    trackCount: 0,
    tourCount: 0,
    countries: ["NO"],
    points: [
      [10, 53],
      [6, 62],
    ],
    ...over,
  };
}

const at = (d: string) => `${d}T00:00:00.000Z`;

function renderPage(): void {
  render(
    <MemoryRouter>
      <RoadtripsPage />
    </MemoryRouter>
  );
}

describe("RoadtripsPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 8, 25, 12));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("puts the trip on the road now first, then the planned ones, then the past by year", async () => {
    vi.mocked(roadtripsApi.list).mockResolvedValue([
      summary({
        id: "a",
        name: "Bretagne",
        startDate: at("2023-06-02"),
        endDate: at("2023-06-16"),
      }),
      summary({ id: "b", name: "Alpen", startDate: at("2026-10-14"), endDate: at("2026-10-18") }),
      summary({ id: "c", name: "Fjorde", startDate: at("2026-09-18"), endDate: at("2026-09-28") }),
    ]);
    renderPage();

    const underway = (await screen.findByText("roadtrips:list.sectionUnderway")).closest(
      "section"
    )!;
    expect(within(underway).getByText("Fjorde")).toBeInTheDocument();
    expect(within(underway).getByText("roadtrips:phase.underway:8")).toBeInTheDocument();

    const planned = screen.getByText("roadtrips:list.sectionPlanned").closest("section")!;
    expect(within(planned).getByText("Alpen")).toBeInTheDocument();
    expect(within(planned).getByText("roadtrips:phase.planned")).toBeInTheDocument();

    const year = screen.getByText("2023").closest("section")!;
    expect(within(year).getByText("Bretagne")).toBeInTheDocument();
  });

  it("marks a lower-bound night count with ≈ and a missing distance with a dash, never a zero", async () => {
    vi.mocked(roadtripsApi.list).mockResolvedValue([
      summary({
        id: "a",
        name: "Soft",
        startDate: at("2024-05-01"),
        nights: 10,
        nightsKnown: false,
      }),
      summary({
        id: "b",
        name: "Leer",
        startDate: at("2024-06-01"),
        stationCount: 1,
        distanceKm: 0,
      }),
    ]);
    renderPage();
    expect(await screen.findByText("≈ 10")).toBeInTheDocument();
    const empty = screen.getByText("Leer").closest("a")!;
    expect(within(empty).getByText("—")).toBeInTheDocument();
  });

  it("filters by name, trip or country", async () => {
    vi.mocked(roadtripsApi.list).mockResolvedValue([
      summary({ id: "a", name: "Bretagne", countries: ["FR"], startDate: at("2023-06-02") }),
      summary({ id: "b", name: "Toskana", countries: ["IT"], startDate: at("2024-09-03") }),
    ]);
    renderPage();
    await screen.findByText("Bretagne");
    fireEvent.change(screen.getByLabelText("roadtrips:list.search"), { target: { value: "it" } });
    expect(screen.queryByText("Bretagne")).not.toBeInTheDocument();
    expect(screen.getByText("Toskana")).toBeInTheDocument();
  });

  it("tells a failed load apart from an empty list", async () => {
    vi.mocked(roadtripsApi.list).mockRejectedValueOnce(new Error("down"));
    renderPage();
    expect(await screen.findByText("roadtrips:loadError")).toBeInTheDocument();
    expect(screen.queryByText("roadtrips:list.emptyTitle")).not.toBeInTheDocument();
  });

  it("offers the first roadtrip when there is none", async () => {
    vi.mocked(roadtripsApi.list).mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText("roadtrips:list.emptyTitle")).toBeInTheDocument();
    expect(screen.getByText("roadtrips:list.emptyCta")).toBeInTheDocument();
  });
});
