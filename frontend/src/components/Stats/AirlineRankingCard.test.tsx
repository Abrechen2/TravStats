import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import AirlineRankingCard from "./AirlineRankingCard";

vi.mock("../../lib/api", () => ({
  statsApi: {
    getAirlineRanking: vi.fn().mockResolvedValue({
      total: 10,
      airlines: [
        { airline: "Lufthansa", count: 6, percentage: 60.0, iata: "LH", key: "iata:LH" },
        { airline: "Ryanair", count: 4, percentage: 40.0, key: "name:ryanair" },
      ],
    }),
  },
}));

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
      <AirlineRankingCard />
    </MemoryRouter>
  );
}

describe("AirlineRankingCard", () => {
  it("renders airline names and percentages", async () => {
    renderCard();
    await waitFor(() => {
      expect(screen.getByText("Lufthansa")).toBeInTheDocument();
    });
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("Ryanair")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
  });

  // The API has carried `iata` since 2.5.0 and the release notes promised it on
  // screen, but the card only ever rendered the airline name.
  it("renders the IATA code the API returns", async () => {
    renderCard();
    await waitFor(() => {
      expect(screen.getByText("Lufthansa")).toBeInTheDocument();
    });
    expect(screen.getByText("LH")).toBeInTheDocument();
  });

  it("leaves the code column empty for an airline the catalogue cannot resolve", async () => {
    renderCard();
    await waitFor(() => {
      expect(screen.getByText("Ryanair")).toBeInTheDocument();
    });
    const row = screen.getByText("Ryanair").closest("div");
    expect(row?.textContent).not.toContain("undefined");
  });
});
