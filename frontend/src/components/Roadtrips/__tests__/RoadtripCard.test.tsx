import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import RoadtripCard from "../RoadtripCard";
import type { RoadtripSummary } from "../../../types/roadtrip";

vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

function summary(over: Partial<RoadtripSummary>): RoadtripSummary {
  return {
    id: "rt-1",
    kind: "roadtrip",
    tripId: null,
    tripName: null,
    name: "QA Roadtrip",
    mode: "car",
    color: null,
    vehicle: null,
    vehicleName: null,
    kindAssignedAutomatically: false,
    startDate: "2026-10-03T00:00:00.000Z",
    endDate: "2026-10-05T00:00:00.000Z",
    distanceKm: 254,
    drivenKm: 254,
    startOdometerKm: null,
    endOdometerKm: null,
    stationCount: 1,
    trackCount: 0,
    tourCount: 1,
    countries: [],
    points: [],
    nights: 1,
    stayNights: 1,
    freeNights: 0,
    placesSlept: 1,
    nightsKnown: true,
    ...over,
  } as RoadtripSummary;
}

/** forgejo#160, the roadtrip card: "1 Nächte", "1 Stationen", "1 Touren". */
describe("RoadtripCard figures in the singular (forgejo#160)", () => {
  it("names one of each in the singular", () => {
    render(
      <MemoryRouter>
        <RoadtripCard roadtrip={summary({})} phase="underway" />
      </MemoryRouter>
    );
    expect(screen.getByText("Nacht")).toBeInTheDocument();
    expect(screen.getByText("Station")).toBeInTheDocument();
    expect(screen.getByText("Tour")).toBeInTheDocument();
  });

  it("keeps the plural for more than one", () => {
    render(
      <MemoryRouter>
        <RoadtripCard
          roadtrip={summary({ nights: 3, stationCount: 4, tourCount: 2 })}
          phase="underway"
        />
      </MemoryRouter>
    );
    expect(screen.getByText("Nächte")).toBeInTheDocument();
    expect(screen.getByText("Stationen")).toBeInTheDocument();
    expect(screen.getByText("Touren")).toBeInTheDocument();
  });
});

/** forgejo#249: a dash or "≈" says why on the card, not only on hover. */
describe("RoadtripCard — reasons without hover (forgejo#249)", () => {
  it("says why the distance is a dash and the nights a lower bound", () => {
    render(
      <MemoryRouter>
        <RoadtripCard
          roadtrip={summary({ stationCount: 1, nightsKnown: false })}
          phase="underway"
        />
      </MemoryRouter>
    );
    const reasons = screen.getByTestId("roadtrip-card-reasons");
    expect(reasons).toHaveTextContent("Noch keine Etappe");
    expect(reasons).toHaveTextContent("Mindestens eine Station hat kein Abfahrtsdatum.");
  });

  it("says nothing extra when every figure is known", () => {
    render(
      <MemoryRouter>
        <RoadtripCard roadtrip={summary({ stationCount: 3 })} phase="past" />
      </MemoryRouter>
    );
    expect(screen.queryByTestId("roadtrip-card-reasons")).not.toBeInTheDocument();
  });
});
