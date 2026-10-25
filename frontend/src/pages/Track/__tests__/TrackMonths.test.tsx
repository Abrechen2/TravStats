import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { TravTrackMonths } from "../../../lib/api/travtrackMonths";

const api = vi.hoisted(() => ({ months: vi.fn(), cityLookup: vi.fn(), setCityLookup: vi.fn() }));
vi.mock("../../../lib/api/travtrackMonths", () => ({ travTrackMonthsApi: api }));
vi.mock("../../../hooks/useTodayZone", () => ({ useTodayZone: () => "UTC" }));
vi.mock("../../../shared/time/clock", () => ({ todayIn: () => "2026-10-25" }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
    i18n: { language: "en" },
  }),
}));

import TrackMonths, { monthRows } from "../TrackMonths";

/**
 * The monthly values on `/track/months` (TravTrack plan L3, review focus 27):
 * a month without data is not a row of zeros, cities the lookup did not
 * determine read "nicht ermittelt", and a month being recomputed says so.
 */

const DATA: TravTrackMonths = {
  months: [
    {
      month: "2026-03",
      kmGround: 412.3,
      countries: ["DE", "KR"],
      cities: null,
      daysWithData: 12,
      daysPaused: 2,
    },
    {
      month: "2026-10",
      kmGround: 0.4,
      countries: ["KR"],
      cities: [
        { name: "Busan", countryCode: "KR" },
        { name: "Seoul", countryCode: "KR" },
      ],
      daysWithData: 3,
      daysPaused: 0,
    },
  ],
  pending: [],
};

const show = () =>
  render(
    <MemoryRouter>
      <TrackMonths />
    </MemoryRouter>
  );

describe("TrackMonths", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.months.mockResolvedValue(DATA);
  });

  it("lists the months with data, newest first, and no month without data", async () => {
    show();
    const october = await screen.findByTestId("track-month-2026-10");
    expect(api.months).toHaveBeenCalledWith(2026);
    expect(within(october).getByText("October")).toBeInTheDocument();
    expect(within(october).getByText("400 m")).toBeInTheDocument();
    expect(within(october).getByText("South Korea")).toBeInTheDocument();
    expect(within(october).getByText("Busan, Seoul")).toBeInTheDocument();
    const march = screen.getByTestId("track-month-2026-03");
    expect(within(march).getByText("Germany, South Korea")).toBeInTheDocument();
    expect(within(march).getByText(/412/)).toBeInTheDocument();
    expect(within(march).getByText(/track:months.pausedCount/)).toBeInTheDocument();
    const rows = screen.getAllByTestId(/^track-month-\d/);
    expect(rows.map((r) => r.dataset.testid)).toEqual([
      "track-month-2026-10",
      "track-month-2026-03",
    ]);
    expect(screen.queryByTestId("track-month-2026-04")).not.toBeInTheDocument();
  });

  it("says the months are UTC months", async () => {
    show();
    await screen.findByTestId("track-month-2026-10");
    expect(screen.getByText("track:months.utc")).toBeInTheDocument();
  });

  it("cities not determined read so, never an empty cell", async () => {
    show();
    const march = await screen.findByTestId("track-month-2026-03");
    expect(within(march).getByTestId("track-month-cities")).toHaveTextContent(
      "track:months.citiesUnknown"
    );
  });

  it("with the lookup off everywhere it points to the setting", async () => {
    api.months.mockResolvedValue({
      ...DATA,
      months: DATA.months.map((m) => ({ ...m, cities: null })),
    });
    show();
    expect(await screen.findByRole("link", { name: "track:months.citiesOff" })).toHaveAttribute(
      "href",
      "/settings/location"
    );
  });

  it("a year without data says so", async () => {
    api.months.mockResolvedValue({ months: [], pending: [] });
    show();
    expect(await screen.findByTestId("track-months-empty")).toHaveTextContent(
      'track:months.empty {"year":2026}'
    );
  });

  it("a month being recomputed says so, also before it has values", async () => {
    api.months.mockResolvedValue({ ...DATA, pending: ["2026-10", "2026-11"] });
    show();
    expect(await screen.findByText("track:months.pending")).toBeInTheDocument();
    const november = screen.getByTestId("track-month-2026-11");
    expect(within(november).getByText("track:months.pendingMonth")).toBeInTheDocument();
    expect(november).not.toHaveTextContent("0");
  });

  it("steps back a year, and not past this one", async () => {
    show();
    await screen.findByTestId("track-month-2026-10");
    expect(screen.getByRole("button", { name: "track:months.next" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "track:months.previous" }));
    expect(api.months).toHaveBeenLastCalledWith(2025);
    expect(await screen.findByTestId("track-months-year")).toHaveTextContent("2025");
    await screen.findByTestId("track-month-2026-10");
  });

  it("a refusal shows as itself", async () => {
    api.months.mockRejectedValue({
      response: { status: 403, data: { code: "TRAVTRACK_DISABLED" } },
    });
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("track:errors.disabled");
  });

  it("monthRows puts a pending month without values in its place", () => {
    expect(monthRows({ months: [], pending: ["2026-05"] })).toEqual([
      { month: "2026-05", values: null, pending: true },
    ]);
  });
});
