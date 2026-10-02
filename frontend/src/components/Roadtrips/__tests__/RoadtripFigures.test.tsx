import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import RoadtripFigures from "../RoadtripFigures";
import type { RoadtripDetail } from "../../../types/roadtrip";

vi.mock("../../../hooks/useTranslation", async () => {
  const { germanUseTranslationNs } = await import("../../../__tests__/helpers/germanT");
  return { useTranslation: germanUseTranslationNs };
});

function detail(startDate: string, endDate: string): RoadtripDetail {
  return {
    roadtrip: { drivenKm: 0, distanceKm: 0, startOdometerKm: null, endOdometerKm: null },
    countries: [],
    trip: null,
    startDate,
    endDate,
    nights: { nights: 1, stayNights: 0, freeNights: 1, placesSlept: 1, nightsKnown: true },
    stations: [],
    legs: [],
    tours: [],
    routingAvailable: true,
    expenses: [],
    costs: {},
  } as unknown as RoadtripDetail;
}

/**
 * forgejo#165, the reported case through the figure itself: a planned
 * 10.–11.10.2026 roadtrip read on 02.10.2026 showed "Tage 2 — davon 9 noch
 * vor dir".
 */
describe("RoadtripFigures days figure (forgejo#165)", () => {
  it("puts the whole of a planned roadtrip ahead, never more", () => {
    render(
      <RoadtripFigures
        detail={detail("2026-10-10T00:00:00.000Z", "2026-10-11T00:00:00.000Z")}
        today="2026-10-02"
      />
    );
    expect(screen.getByText("davon 2 noch vor dir")).toBeInTheDocument();
    expect(screen.queryByText("davon 9 noch vor dir")).not.toBeInTheDocument();
  });

  it("counts the days after today while underway", () => {
    render(
      <RoadtripFigures
        detail={detail("2026-10-10T00:00:00.000Z", "2026-10-12T00:00:00.000Z")}
        today="2026-10-10"
      />
    );
    expect(screen.getByText("davon 2 noch vor dir")).toBeInTheDocument();
  });
});
