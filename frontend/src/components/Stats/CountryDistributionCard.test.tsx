import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import CountryDistributionCard from "./CountryDistributionCard";

vi.mock("../../lib/api", () => ({
  statsApi: {
    getCountryStats: vi.fn().mockResolvedValue({
      total: 10,
      countries: [
        { country: "Germany", count: 7 },
        { country: "United Kingdom", count: 3 },
      ],
    }),
  },
}));

vi.mock("../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

describe("CountryDistributionCard", () => {
  it("renders country names and counts", async () => {
    render(<CountryDistributionCard />);
    await waitFor(() => {
      expect(screen.getByText("Germany")).toBeInTheDocument();
    });
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("United Kingdom")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });
});
