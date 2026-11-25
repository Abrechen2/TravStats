import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock("../../../../hooks/useIsDemoAccount", () => ({ useIsDemoAccount: () => false }));
vi.mock("../../../../hooks/useTravTrackVisible", () => ({
  useTravTrackCapabilities: () => ({
    version: 1,
    offered: true,
    enabled: true,
    active: true,
    hasData: true,
  }),
}));
const questionable = vi.fn();
const choose = vi.fn();
vi.mock("../../../../lib/api/travtrackDaySources", () => ({
  daySourcesApi: {
    questionable: (...a: unknown[]) => questionable(...a),
    choose: (...a: unknown[]) => choose(...a),
  },
}));

import TravTrackQualitySection from "../TravTrackQualitySection";

const DAY = {
  date: "2026-08-10",
  reasons: ["mixed", "outliers"] as const,
  bestScore: 0.42,
  outlierCount: 3,
  sources: ["companion:phone-1", "gpx:takeout"],
};

const renderIt = () =>
  render(
    <MemoryRouter>
      <TravTrackQualitySection />
    </MemoryRouter>
  );

describe("TravTrackQualitySection — Tage mit fragwürdigen Spuren", () => {
  beforeEach(() => {
    questionable.mockReset();
    choose.mockReset();
  });

  it("lists the days with their actions: open, choose source, discard outliers, delete a range", async () => {
    questionable.mockResolvedValue({ total: 1, days: [DAY] });
    renderIt();
    const row = await screen.findByTestId("tt-quality-2026-08-10");
    expect(row.querySelector('a[href="/track/2026-08-10"]')).toBeTruthy();
    expect(
      row.querySelector('a[href="/settings/tt-daten?from=2026-08-10&until=2026-08-10#ttDelete"]')
    ).toBeTruthy();
    choose.mockResolvedValue({});
    questionable.mockResolvedValue({ total: 0, days: [] });
    fireEvent.click(screen.getByRole("button", { name: "track:quality.discardOutliers" }));
    await waitFor(() =>
      expect(choose).toHaveBeenCalledWith("2026-08-10", { outlierDecision: "discard" })
    );
    expect(await screen.findByText("track:quality.none")).toBeTruthy();
  });

  it("says why the list could not be loaded instead of showing an empty list", async () => {
    questionable.mockRejectedValue({ response: { data: { code: "TRAVTRACK_DISABLED" } } });
    renderIt();
    expect((await screen.findByRole("alert")).textContent).toBe("track:errors.disabled");
    expect(screen.queryByText("track:quality.none")).toBeNull();
  });

  it("a failed choice stays on its row and keeps the day listed", async () => {
    questionable.mockResolvedValue({ total: 1, days: [DAY] });
    choose.mockRejectedValue({ response: { data: { code: "TRAVTRACK_SOURCE_NOT_ON_DAY" } } });
    renderIt();
    fireEvent.change(await screen.findByRole("combobox", { name: "track:quality.chooseSource" }), {
      target: { value: "gpx:takeout" },
    });
    expect((await screen.findByRole("alert")).textContent).toBe("track:errors.sourceNotOnDay");
    expect(screen.getByTestId("tt-quality-2026-08-10")).toBeTruthy();
  });
});
