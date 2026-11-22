import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { GapCalendar } from "../../../lib/api/gapCalendar";

const api = vi.hoisted(() => ({ year: vi.fn() }));
vi.mock("../../../lib/api/gapCalendar", async (orig) => ({
  ...(await orig<typeof import("../../../lib/api/gapCalendar")>()),
  gapCalendarApi: api,
}));
const domains = vi.hoisted(() => ({ enabled: ["flight"] as string[] }));
vi.mock("../../../hooks/useEnabledDomains", () => ({
  useEnabledDomains: () => ({
    enabled: domains.enabled,
    isEnabled: (k: string) => domains.enabled.includes(k),
  }),
}));
vi.mock("../../../hooks/useTodayZone", () => ({ useTodayZone: () => "UTC" }));
vi.mock("../../../shared/time/clock", () => ({ todayIn: () => "2026-11-22" }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
    i18n: { language: "en" },
  }),
}));

import TrackGaps from "../TrackGaps";

/**
 * The gap calendar tab: the unknown stretches are the point of the screen, a
 * failed load says so (not an empty year), and "Eintrag anlegen" is offered
 * only where an enabled domain can take the dates.
 */

const counts = {
  entry: 3,
  home: 0,
  track: 1,
  privacyZone: 1,
  implausible: 0,
  unknown: 5,
  outside: 0,
};
const DATA: GapCalendar = {
  year: 2026,
  zone: "UTC",
  today: "2026-11-22",
  firstDay: "2026-03-01",
  years: [2025, 2026],
  counts: { ...counts, outside: 351 },
  runs: [
    { from: "2026-01-01", to: "2026-02-28", state: "outside" },
    { from: "2026-03-01", to: "2026-03-03", state: "entry" },
    { from: "2026-03-04", to: "2026-03-07", state: "unknown" },
    { from: "2026-03-08", to: "2026-03-08", state: "privacyZone" },
    { from: "2026-03-09", to: "2026-04-02", state: "unknown" },
    { from: "2026-04-03", to: "2026-12-31", state: "track" },
  ],
};

const show = () =>
  render(
    <MemoryRouter>
      <TrackGaps />
    </MemoryRouter>
  );

describe("TrackGaps", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    domains.enabled = ["flight"];
    api.year.mockResolvedValue(DATA);
  });

  it("draws every day with its state and lists the unknown stretches of the first month that has some", async () => {
    show();
    const march = await screen.findByTestId("gaps-2026-03");
    expect(api.year).toHaveBeenCalledWith(2026);
    expect(
      within(march)
        .getAllByRole("button")
        .filter((b) => b.dataset.state)
    ).toHaveLength(31);
    expect(march.querySelector('[data-state="unknown"]')).not.toBeNull();
    expect(march.querySelector('[data-state="privacyZone"]')).not.toBeNull();
    const stretches = screen.getAllByTestId("gaps-stretch");
    expect(stretches).toHaveLength(2);
    expect(stretches[0].textContent).toContain("track:gaps.range");
    const link = within(stretches[0]).getByText("track:gaps.create").closest("a");
    expect(link?.getAttribute("href")).toBe("/flights?addFrom=2026-03-04");
    expect(
      within(stretches[0]).getByText("track:gaps.openDay").closest("a")?.getAttribute("href")
    ).toBe("/track/2026-03-04");
  });

  it("a stretch continuing past the month's end is cut at the month", async () => {
    show();
    await screen.findByTestId("gaps-2026-03");
    const last = screen.getAllByTestId("gaps-stretch")[1];
    expect(last.textContent).toContain('"to"');
    expect(last.textContent).toContain("31");
  });

  it("offers no 'Eintrag anlegen' when no enabled domain can take the dates", async () => {
    domains.enabled = ["cruise"];
    show();
    await screen.findByTestId("gaps-2026-03");
    expect(screen.queryByText("track:gaps.create")).toBeNull();
    expect(screen.getAllByText("track:gaps.openDay").length).toBeGreaterThan(0);
  });

  it("a failed load is shown with a retry, never as an empty year", async () => {
    api.year.mockRejectedValueOnce(new Error("boom"));
    show();
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("track:errors.network");
    expect(screen.queryByTestId("gaps-summary")).toBeNull();
    fireEvent.click(within(alert).getByText("track:gaps.retry"));
    expect(await screen.findByTestId("gaps-2026-03")).toBeTruthy();
    expect(api.year).toHaveBeenCalledTimes(2);
  });

  it("an account with nothing recorded says there are no gaps instead of drawing the year", async () => {
    api.year.mockResolvedValue({
      ...DATA,
      firstDay: null,
      years: [],
      runs: [{ from: "2026-01-01", to: "2026-12-31", state: "outside" }],
    });
    show();
    expect(await screen.findByTestId("gaps-empty")).toBeTruthy();
    expect(screen.queryByTestId("gaps-2026-03")).toBeNull();
  });

  it("picking another month lists that month's stretches", async () => {
    show();
    await screen.findByTestId("gaps-2026-03");
    const april = within(screen.getByTestId("gaps-2026-04")).getAllByRole("button")[0];
    fireEvent.click(april);
    expect(screen.getByTestId("gaps-month").textContent).toContain("track:gaps.days");
  });
});
