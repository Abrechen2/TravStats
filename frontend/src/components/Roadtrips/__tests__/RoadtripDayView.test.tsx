import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import RoadtripDayView from "../RoadtripDayView";
import type { RoadtripStation } from "../../../types/roadtrip";
import type { TourLeg } from "../../../types/tour";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) =>
      o && "km" in o ? `${k}=${String(o.km)}` : o && "places" in o ? `${k}:${String(o.places)}` : k,
    i18n: { language: "de" },
  }),
}));

const st = (
  id: string,
  state: RoadtripStation["state"],
  start: string,
  end: string | null = null
): RoadtripStation => ({
  id,
  title: id,
  lat: 60,
  lon: 5,
  startDate: `${start}T00:00:00.000Z`,
  endDate: end ? `${end}T00:00:00.000Z` : null,
  notes: null,
  order: 0,
  state,
  lodgingStayId: null,
  stay: null,
});
const leg = (
  from: string,
  to: string,
  source: TourLeg["source"],
  km: number,
  minutes: number | null
): TourLeg => ({
  id: `${from}-${to}`,
  fromStopId: from,
  toStopId: to,
  distanceKm: km,
  source,
  mode: "road",
  confidence: "high",
  waypoints: null,
  drivingMinutes: minutes,
});

/** forgejo#243 */
describe("RoadtripDayView", () => {
  it("shows a day's route with the source of its distance, and an unknown time as unknown", () => {
    render(
      <MemoryRouter>
        <RoadtripDayView
          stations={[
            st("Bergen", "free", "2026-07-11", "2026-07-12"),
            st("Voss", "pass", "2026-07-12"),
            {
              ...st("Flåm", "stay", "2026-07-12", "2026-07-13"),
              lodgingStayId: "s",
              stay: {
                id: "s",
                lodgingId: "l-flam",
                lodgingName: "Flåm Camping",
                nights: 1,
                status: "completed",
              } as never,
            },
          ]}
          legs={[
            leg("Bergen", "Voss", "routed", 100, 90),
            leg("Voss", "Flåm", "straight", 60, null),
          ]}
          startDate="2026-07-11T00:00:00.000Z"
        />
      </MemoryRouter>
    );
    const second = screen.getAllByRole("listitem")[1];
    expect(second).toHaveTextContent("Bergen → Flåm");
    expect(second).toHaveTextContent("roadtrips:days.via:Voss");
    expect(within(second).getByText("Flåm Camping").closest("a")).toHaveAttribute(
      "href",
      "/lodging/l-flam"
    );
    expect(second).toHaveTextContent("roadtrips:days.kmBy.routed=100");
    expect(second).toHaveTextContent("roadtrips:days.kmBy.straight=60");
    // A straight line has no driving time; the day's time is not guessed from it.
    expect(within(second).getByTestId("day-driving")).toHaveTextContent(
      "roadtrips:days.drivingUnknown"
    );
    expect(second).not.toHaveTextContent("roadtrips:days.driving ");
  });

  it("labels a typed driving time as entered, and makes the lodging link a touch target", () => {
    render(
      <MemoryRouter>
        <RoadtripDayView
          stations={[
            st("Bergen", "pass", "2026-07-11"),
            {
              ...st("Flåm", "stay", "2026-07-11", "2026-07-12"),
              lodgingStayId: "s",
              stay: {
                id: "s",
                lodgingId: "l",
                lodgingName: "Flåm Camping",
                nights: 1,
                status: "completed",
              } as never,
            },
          ]}
          legs={[leg("Bergen", "Flåm", "straight", 100, 90)]}
          startDate="2026-07-11T00:00:00.000Z"
        />
      </MemoryRouter>
    );
    expect(screen.getByTestId("day-driving")).toHaveTextContent("roadtrips:days.drivingEntered");
    expect(screen.getByText("Flåm Camping").closest("a")?.className).toContain(
      "pointer-coarse:min-h-(--ts-size-touch-min)"
    );
  });
});
