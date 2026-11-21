import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/usePlaceCategories", () => ({
  usePlaceCategories: () => ({ customs: [] }),
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

import { PlaceVisitCard } from "../TimelineEventCards";

const when = {
  utc: "2020-05-03T10:00:00.000Z",
  zone: "Europe/Rome",
  offset: "+02:00",
  local: "2020-05-03T12:00:00",
  precision: "minute",
};
const place = {
  id: "p-9",
  name: "Colosseo",
  category: "landmark",
  city: "Rom",
  country: "Italien",
};

function renderCard(visitedAt: string | null): void {
  const ev = {
    id: "place-visit-v1",
    kind: "place-visit",
    date: when.utc,
    when,
    place,
    visit: { id: "v1", visitedAt, notes: null },
  } as never;
  render(
    <MemoryRouter>
      <PlaceVisitCard ev={ev} />
    </MemoryRouter>
  );
}

describe("PlaceVisitCard", () => {
  it("names its kind and links to the place", () => {
    renderCard("2020-05-03T10:00:00.000Z");
    expect(screen.getByText(/trips:detail\.timeline\.placeVisited/)).toBeInTheDocument();
    expect(screen.getByRole("link")).toHaveAttribute("href", "/places/p-9");
  });

  it("marks a visit dated in the future as planned, not visited", () => {
    renderCard("2999-01-01T10:00:00.000Z");
    expect(screen.getByText(/trips:detail\.timeline\.placePlanned/)).toBeInTheDocument();
    expect(screen.queryByText(/placeVisited/)).toBeNull();
  });
});
