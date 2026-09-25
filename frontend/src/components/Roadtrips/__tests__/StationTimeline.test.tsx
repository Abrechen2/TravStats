import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import StationTimeline from "../StationTimeline";
import type { RoadtripStation } from "../../../types/roadtrip";
import type { TourLeg } from "../../../types/tour";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o && "n" in o ? `${k}:${String(o.n)}` : k),
    i18n: { language: "de" },
  }),
}));

const at = (d: string) => `${d}T00:00:00.000Z`;

function station(id: string, over: Partial<RoadtripStation>): RoadtripStation {
  return {
    id,
    title: id,
    lat: 60,
    lon: 7,
    startDate: null,
    endDate: null,
    notes: null,
    order: 0,
    state: "pass",
    lodgingStayId: null,
    stay: null,
    ...over,
  };
}

const STATIONS = [
  station("Hirtshals", { state: "free", startDate: at("2026-09-18"), endDate: at("2026-09-19") }),
  station("Kaupanger", { state: "free", startDate: at("2026-09-24") }),
  station("Sogndal", {
    state: "stay",
    startDate: at("2026-09-25"),
    endDate: at("2026-09-26"),
    lodgingStayId: "s1",
    stay: {
      id: "s1",
      lodgingId: "l1",
      lodgingName: "Fjordhotel",
      lodgingType: "hotel",
      city: null,
      country: null,
      checkIn: at("2026-09-25"),
      checkOut: at("2026-09-26"),
      nights: 1,
      status: "cancelled",
    },
  }),
];

const FERRY: TourLeg = {
  id: "leg",
  fromStopId: "Hirtshals",
  toStopId: "Kaupanger",
  distanceKm: 140,
  source: "straight",
  mode: "ferry",
  confidence: "estimate",
  waypoints: null,
  drivingMinutes: 135,
  tollCost: null,
  currency: null,
};

function renderTimeline(onSelect = vi.fn(), onEditLeg?: () => void): void {
  render(
    <MemoryRouter>
      <StationTimeline
        stations={STATIONS}
        legs={[FERRY]}
        tours={[]}
        startDate={at("2026-09-18")}
        today="2026-09-24"
        selectedId={null}
        onSelect={onSelect}
        onEditLeg={onEditLeg}
      />
    </MemoryRouter>
  );
}

describe("StationTimeline", () => {
  it("heads each arrival day with its number, and marks today and what is still planned", () => {
    renderTimeline();
    expect(screen.getByText("roadtrips:timeline.day:1")).toBeInTheDocument();
    expect(screen.getByText("roadtrips:timeline.day:7")).toBeInTheDocument();
    expect(screen.getByText("roadtrips:timeline.today")).toBeInTheDocument();
    expect(screen.getByText("roadtrips:timeline.planned")).toBeInTheDocument();
  });

  it("says a missing departure is an estimate, and a cancelled stay counts no night", () => {
    renderTimeline();
    expect(screen.getByText("roadtrips:timeline.approxNight")).toBeInTheDocument();
    expect(screen.getByText("roadtrips:timeline.cancelled")).toBeInTheDocument();
  });

  it("names a ferry as a ferry, with its time", () => {
    renderTimeline();
    expect(screen.getByText("roadtrips:timeline.leg.ferry")).toBeInTheDocument();
    expect(screen.getByText(/140 km · roadtrips:timeline.duration/)).toBeInTheDocument();
  });

  it("selects a station on click, and opens a leg only in edit mode", () => {
    const onSelect = vi.fn();
    const onEditLeg = vi.fn();
    renderTimeline(onSelect, onEditLeg);
    fireEvent.click(screen.getByText("Kaupanger"));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "Kaupanger" }));
    fireEvent.click(screen.getByLabelText("roadtrips:timeline.legEdit"));
    expect(onEditLeg).toHaveBeenCalled();
  });
});
