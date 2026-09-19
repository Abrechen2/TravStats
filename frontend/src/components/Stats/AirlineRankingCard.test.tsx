import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AirlineRankingCard from "./AirlineRankingCard";
import type { AirlineRankingResponse } from "../../types";

// The card takes its ranking as a prop since forgejo#49 — the page loads all
// nine flight sections in one `/stats/page` request instead of nine. The
// assertions below are unchanged: the same rows, the same numbers on screen.
const RANKING: AirlineRankingResponse = {
  total: 10,
  flightsWithoutAirline: 0,
  airlines: [
    { airline: "Lufthansa", count: 6, percentage: 60.0, iata: "LH", key: "iata:LH" },
    { airline: "Ryanair", count: 4, percentage: 40.0, key: "name:ryanair" },
  ],
};

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.n ? `Top ${o.n}` : k),
  }),
}));

// A row is a real `<button>` since Task 9, which needs `useSearchParams` —
// every render here therefore needs a `<Router>` ancestor now.
function renderCard(): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <AirlineRankingCard airlines={RANKING} />
    </MemoryRouter>
  );
}

describe("AirlineRankingCard", () => {
  it("renders airline names and percentages", () => {
    renderCard();
    expect(screen.getByText("Lufthansa")).toBeInTheDocument();
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("Ryanair")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  // The API has carried `iata` since 2.5.0 and the release notes promised it on
  // screen, but the card only ever rendered the airline name.
  it("renders the IATA code the API returns", () => {
    renderCard();
    expect(screen.getByText("LH")).toBeInTheDocument();
  });

  it("leaves the code column empty for an airline the catalogue cannot resolve", () => {
    renderCard();
    const row = screen.getByText("Ryanair").closest("div");
    expect(row?.textContent).not.toContain("undefined");
  });

  // Before the prop, "not loaded yet" was the card's own `loading` state. It is
  // now an absent prop, and it must still read as loading rather than as an
  // account with no airlines.
  it("says it is loading while the page's one request is in flight", () => {
    render(
      <MemoryRouter>
        <AirlineRankingCard airlines={undefined} />
      </MemoryRouter>
    );
    expect(screen.getByText("stats:airlineRanking.loading")).toBeInTheDocument();
  });

  it("distinguishes an empty ranking from an unfinished load", () => {
    render(
      <MemoryRouter>
        <AirlineRankingCard airlines={{ total: 0, flightsWithoutAirline: 0, airlines: [] }} />
      </MemoryRouter>
    );
    expect(screen.getByText("stats:airlineRanking.noData")).toBeInTheDocument();
  });
});
