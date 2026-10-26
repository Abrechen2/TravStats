import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const views = vi.hoisted(() => ({ calendar: vi.fn() }));
vi.mock("../../../lib/api/travtrackViews", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/travtrackViews")>()),
  travTrackViewsApi: views,
}));
vi.mock("../../../hooks/useTodayZone", () => ({ useTodayZone: () => "UTC" }));
vi.mock("../../../shared/time/clock", () => ({ todayIn: () => "2026-10-25" }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
    i18n: { language: "de" },
  }),
}));

import TrackCalendar from "../stats/TrackCalendar";

const show = () =>
  render(
    <MemoryRouter initialEntries={["/track/months"]}>
      <Routes>
        <Route path="/track/months" element={<TrackCalendar year={2026} />} />
        <Route path="/track/:date" element={<p>day page</p>} />
      </Routes>
    </MemoryRouter>
  );

describe("TrackCalendar", () => {
  beforeEach(() => {
    views.calendar.mockReset();
  });

  it("a click on a day opens it on the map; pending and unknown months say so", async () => {
    views.calendar.mockResolvedValue({
      year: 2026,
      days: [{ day: "2026-03-03", kmGround: 61.2, recorded: true }],
      pending: ["2026-10"],
      unavailable: ["2026-01"],
    });
    show();
    const oct = await screen.findByTestId("track-calendar-2026-10");
    expect(oct).toHaveTextContent("track:calendar.month.pending");
    expect(screen.getByTestId("track-calendar-2026-01")).toHaveTextContent(
      "track:calendar.month.unavailable"
    );
    const cell = screen
      .getByTestId("track-calendar-2026-03")
      .querySelector('[data-state="recorded"]') as HTMLButtonElement;
    expect(cell.getAttribute("aria-label")).toContain("track:calendar.cellKm");
    // A pending day cannot be opened as if it were empty.
    expect(oct.querySelector('[data-state="pending"]')).toBeDisabled();
    fireEvent.click(cell);
    expect(await screen.findByText("day page")).toBeInTheDocument();
  });

  it("a failure reads as itself", async () => {
    views.calendar.mockRejectedValue(new Error("offline"));
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("track:errors.network");
  });
});
