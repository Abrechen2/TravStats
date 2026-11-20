import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { Trip } from "../../../types";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: { count?: number }) => (o?.count !== undefined ? `${k}/${o.count}` : k),
    i18n: { language: "de" },
  }),
}));
// The head's "Mehr" menu asks whether the instance has a text model; the network guard refuses the request.
vi.mock("../../../hooks/useHasLlm", () => ({ useHasLlm: () => true }));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({ isEnabled: () => true }),
}));

import TripCard from "../TripCard";
import TripHead from "../TripHead";

const trip = {
  id: "t1",
  name: "Ortsreise",
  status: "planned",
  countries: [],
  bookings: [],
  flights: [],
  cruises: [],
  tags: [],
  category: null,
  color: null,
  coverImageUrl: null,
  destinationLabel: null,
  startDate: null,
  endDate: null,
  _count: { flights: 0, cruises: 0, lodgingStays: 0, routes: 0, photos: 0 },
} as unknown as Trip;

describe("TripCard places count", () => {
  it("shows 'N Orte' when the trip has visited places", () => {
    render(
      <MemoryRouter>
        <TripCard trip={trip} onOpen={() => {}} placeCount={3} />
      </MemoryRouter>
    );
    expect(screen.getByTestId("trip-card-places")).toHaveTextContent("3 trips:card.places/3");
  });

  it("shows nothing for a trip without any", () => {
    render(
      <MemoryRouter>
        <TripCard trip={trip} onOpen={() => {}} placeCount={0} />
      </MemoryRouter>
    );
    expect(screen.queryByTestId("trip-card-places")).toBeNull();
  });
});

describe("TripHead places count", () => {
  const head = (placeCount?: number): void => {
    render(
      <MemoryRouter>
        <TripHead
          trip={trip}
          locale="de"
          t={
            ((k: string, o?: { count?: number }) =>
              o?.count !== undefined ? `${k}/${o.count}` : k) as never
          }
          onEdit={() => {}}
          onDelete={() => {}}
          onChanged={() => {}}
          placeCount={placeCount}
        />
      </MemoryRouter>
    );
  };

  it("links 'N Orte' to the timeline", () => {
    head(2);
    const link = screen.getByTestId("trip-head-places");
    expect(link).toHaveTextContent("2 trips:card.places/2");
    expect(link.getAttribute("href")).toContain("tab=timeline");
  });

  it("shows no places line without places", () => {
    head(0);
    expect(screen.queryByTestId("trip-head-places")).toBeNull();
  });
});
