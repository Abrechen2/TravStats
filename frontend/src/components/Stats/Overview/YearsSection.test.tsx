import { describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import YearsSection from "./YearsSection";
import { statsApi } from "../../../lib/api/stats";

vi.mock("../../../lib/api/stats", () => ({ statsApi: { getYearStats: vi.fn() } }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "de" } }),
}));

const view = () =>
  render(
    <MemoryRouter>
      <YearsSection />
    </MemoryRouter>
  );

describe("YearsSection", () => {
  it("a failed load is said out loud, not drawn as an empty page", async () => {
    vi.mocked(statsApi.getYearStats).mockRejectedValue(new Error("boom"));
    view();
    expect((await screen.findByRole("alert")).textContent).toBe("stats:years.loadFailed");
  });

  it("an account without any year draws nothing", async () => {
    vi.mocked(statsApi.getYearStats).mockResolvedValue({
      totals: { loggedKm: null, recordedKm: null, recordedPoints: null },
      years: [],
    });
    const { container } = view();
    await waitFor(() => expect(statsApi.getYearStats).toHaveBeenCalled());
    expect(container.textContent).toBe("");
  });

  it("draws the totals and one card per year; recorded totals only when there are any", async () => {
    vi.mocked(statsApi.getYearStats).mockResolvedValue({
      totals: { loggedKm: 1000, recordedKm: null, recordedPoints: null },
      years: [
        {
          year: 2024,
          loggedKm: 1000,
          recordedKm: null,
          months: Array.from({ length: 12 }, (_, i) => ({
            month: i + 1,
            loggedKm: i === 0 ? 1000 : null,
            byDomain: i === 0 ? { flight: 1000 } : {},
            recordedKm: null,
          })),
        },
      ],
    });
    view();
    expect(await screen.findByTestId("year-card-2024")).toBeTruthy();
    expect(screen.getByText("stats:years.totalLogged")).toBeTruthy();
    expect(screen.queryByText("stats:years.totalRecorded")).toBeNull();
    expect(screen.queryByText("stats:years.totalPoints")).toBeNull();
  });
});
