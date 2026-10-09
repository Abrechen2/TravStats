import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import RoadtripTourCards from "../RoadtripTourCards";
import type { RoadtripDayTour } from "../../../types/roadtrip";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

const tour = (over: Partial<RoadtripDayTour>): RoadtripDayTour => ({
  id: "t1",
  name: "Galdhøpiggen",
  activity: "hike",
  anchorStopId: null,
  distanceKm: 12,
  ascentM: 1100,
  movingSeconds: 18000,
  startedAt: null,
  source: "gpx",
  ...over,
});

/** forgejo#249: why a climb or a moving time is a dash, said on the card. */
describe("RoadtripTourCards — reasons without hover", () => {
  it("says why the climb and the moving time are unknown", () => {
    render(
      <MemoryRouter>
        <RoadtripTourCards tours={[tour({ ascentM: null, movingSeconds: null })]} stations={[]} />
      </MemoryRouter>
    );
    expect(screen.getByTestId("tour-card-reasons")).toHaveTextContent(
      "roadtrips:detail.noElevation roadtrips:detail.noMoving"
    );
  });

  it("adds nothing when both are known", () => {
    render(
      <MemoryRouter>
        <RoadtripTourCards tours={[tour({})]} stations={[]} />
      </MemoryRouter>
    );
    expect(screen.queryByTestId("tour-card-reasons")).not.toBeInTheDocument();
  });
});
