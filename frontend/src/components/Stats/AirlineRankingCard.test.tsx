import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import AirlineRankingCard from "./AirlineRankingCard";

vi.mock("../../lib/api", () => ({
  statsApi: {
    getAirlineRanking: vi.fn().mockResolvedValue({
      total: 10,
      airlines: [
        { airline: "Lufthansa", count: 6, percentage: 60.0 },
        { airline: "Ryanair", count: 4, percentage: 40.0 },
      ],
    }),
  },
}));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.n ? `Top ${o.n}` : k),
  }),
}));

describe("AirlineRankingCard", () => {
  it("renders airline names and percentages", async () => {
    render(<AirlineRankingCard />);
    await waitFor(() => {
      expect(screen.getByText("Lufthansa")).toBeInTheDocument();
    });
    expect(screen.getByText("60%")).toBeInTheDocument();
    expect(screen.getByText("Ryanair")).toBeInTheDocument();
    expect(screen.getByText("40%")).toBeInTheDocument();
  });
});
