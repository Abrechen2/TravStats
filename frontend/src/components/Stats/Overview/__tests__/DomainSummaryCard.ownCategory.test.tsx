import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import DomainSummaryCard from "../DomainSummaryCard";
import { adaptPoi } from "../../../../lib/stats/domain-stats/poiStatsAdapter";
import type { Place } from "../../../../types/place";

const place = (id: string, category: string): Place =>
  ({
    id,
    name: id,
    category,
    lat: 1,
    lon: 1,
    address: null,
    city: null,
    country: "Italy",
    isoCountryCode: "IT",
    visited: true,
    visits: [
      {
        id: `v-${id}`,
        placeId: id,
        tripId: null,
        visitedAt: "2024-06-12T10:00:00.000Z",
        orderIdx: 0,
        notes: null,
        rating: null,
        createdAt: "2024-06-12T10:00:00.000Z",
        updatedAt: "2024-06-12T10:00:00.000Z",
      },
    ],
    visitCount: 1,
    plannedVisitCount: 0,
    lastVisitAt: "2024-06-12T10:00:00.000Z",
  }) as unknown as Place;

describe("overview card, place categories", () => {
  it("shows an own category name with a dot as written, not as a translation path", () => {
    const stats = adaptPoi({
      places: [place("a", "Aus.sicht"), place("b", "landmark")],
      lists: [],
      curated: [],
    });
    render(
      <DomainSummaryCard
        domain="poi"
        stats={stats}
        selectedYear={null}
        compareYear={null}
        compareEnabled={false}
        comparison={null}
      />,
      { wrapper: MemoryRouter }
    );
    expect(screen.getByText("Aus.sicht")).toBeInTheDocument();
    // The built-in one still goes through the translator.
    expect(screen.queryByText("landmark")).not.toBeInTheDocument();
  });
});
