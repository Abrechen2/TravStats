import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { TravTrackDay } from "../../../../lib/api/travtrack";
import type { TravTrackRange } from "../../../../lib/api/travtrackViews";
import { setClockForTests } from "../../../../shared/time/clock";

const api = vi.hoisted(() => ({
  day: vi.fn(),
  zones: vi.fn(),
  summary: vi.fn(),
  deleteDays: vi.fn(),
  exportFile: vi.fn(),
  lastSeen: vi.fn(),
  explored: vi.fn(),
}));
vi.mock("../../../../lib/api/travtrack", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/api/travtrack")>()),
  travTrackApi: api,
}));
const views = vi.hoisted(() => ({
  range: vi.fn(),
  deletePoint: vi.fn(),
  photos: vi.fn(),
  photoUrl: vi.fn(() => "/thumb"),
  flightPanel: vi.fn(),
}));
vi.mock("../../../../lib/api/travtrackViews", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/api/travtrackViews")>()),
  travTrackViewsApi: views,
}));
const months = vi.hoisted(() => ({ months: vi.fn() }));
vi.mock("../../../../lib/api/travtrackMonths", () => ({ travTrackMonthsApi: months }));
const world = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../../../../lib/geo/worldCountries", () => ({ loadWorldCountries: world.load }));
vi.mock("../../../../hooks/useTodayZone", () => ({ useTodayZone: () => "UTC" }));
vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
    i18n: { language: "de" },
  }),
}));

type Stub = Record<string, unknown> & {
  highlight?: unknown[][];
  frameLines: unknown[];
  lines: unknown[];
  countries: unknown[];
  points: Array<{ id: string | null }>;
  photos: unknown[];
  onPoint: (p: unknown) => void;
};
const mapProps = vi.hoisted(() => ({ last: null as Stub | null }));
vi.mock("../TrackRangeMap", () => ({
  default: (props: Stub) => {
    mapProps.last = props;
    return (
      <div data-testid="map-stub">
        {props.lines.length} lines · {props.highlight?.length ?? 0} flight lines
        <button type="button" onClick={() => props.onPoint(props.points[0])}>
          pick
        </button>
      </div>
    );
  },
}));

import TrackMapView from "../TrackMapView";

/**
 * The flight panel on the map (owner 2026-10-26): a link with `?flight=` opens
 * it straight away, the map draws the whole flight past midnight from the
 * server's range read — its stretches kept apart — and closing it returns to
 * the day.
 */

const H = 3_600_000;
const MIN = 60_000;
const DEP = Date.parse("2026-10-03T21:00:00Z");

const day: TravTrackDay = {
  date: "2026-10-03",
  zone: "UTC",
  segments: [
    [
      [DEP - 2 * H, 48.35, 11.78, 7],
      [DEP - H, 48.36, 11.79, 7],
    ],
  ],
  pointIds: [["d1", "d2"]],
  coverage: [{ fromMs: DEP - 21 * H, untilMs: DEP + 3 * H, state: "recorded" }],
  context: [],
  pointCount: 2,
  truncated: false,
};

const panel = {
  flightId: "f1",
  label: "LH718 MUC–ICN",
  departureZone: "Europe/Berlin",
  basis: "window",
  series: [
    [
      [DEP, 450, 5],
      [DEP + 20 * MIN, 9000, 230],
    ],
    [
      [DEP + 5 * H, 11000, 250],
      [DEP + 6 * H, 300, 20],
    ],
  ],
  pointCount: 4,
  truncated: false,
  takeoffMs: null,
  landingMs: null,
  summary: { maxAltitudeM: 11000, maxSpeedMps: 250, climbToCruiseMinutes: null },
};

const flightRange: TravTrackRange = {
  from: new Date(DEP).toISOString(),
  to: new Date(DEP + 6 * H + 1).toISOString(),
  segments: [
    [
      [DEP, 48.35, 11.78, 7],
      [DEP + 20 * MIN, 49, 13, 7],
    ],
    [
      [DEP + 5 * H, 55, 90, 7],
      [DEP + 6 * H, 37.46, 126.44, 7],
    ],
  ],
  pointIds: [
    ["a", "b"],
    ["c", "d"],
  ],
  pointCount: 4,
  readCount: 4,
  simplified: false,
  omittedSegments: 0,
  next: null,
  cursor: null,
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/track/:date" element={<TrackMapView />} />
      </Routes>
    </MemoryRouter>
  );

describe("TrackMapView — the open flight", () => {
  beforeEach(() => {
    setClockForTests("2026-10-25T12:00:00Z");
    Object.values(api).forEach((fn) => fn.mockReset());
    Object.values(views).forEach((fn) => fn.mockReset());
    api.day.mockResolvedValue(day);
    api.lastSeen.mockResolvedValue(null);
    views.photos.mockResolvedValue({ photos: [], truncated: false, trackTruncated: false });
    views.flightPanel.mockResolvedValue(panel);
    views.range.mockResolvedValue(flightRange);
    window.localStorage.clear();
    mapProps.last = null;
  });
  afterEach(() => setClockForTests(null));

  it("?flight= opens the panel straight from a link, named by the server", async () => {
    renderAt("/track/2026-10-03?flight=f1");
    const heading = await screen.findByRole("heading", { name: /LH718 MUC–ICN/ });
    expect(views.flightPanel).toHaveBeenCalledWith("f1");
    await waitFor(() => expect(heading).toHaveFocus());
  });

  it("draws the whole flight past midnight from the range read, its stretches never joined", async () => {
    renderAt("/track/2026-10-03?flight=f1");
    await waitFor(() => expect(mapProps.last?.highlight).toHaveLength(2));
    expect(views.range).toHaveBeenCalledWith(
      { from: new Date(DEP).toISOString(), to: new Date(DEP + 6 * H + 1).toISOString() },
      null
    );
    expect(mapProps.last?.frameLines).toBe(mapProps.last?.highlight);
    // The day's own line is still drawn under it.
    expect(screen.getByTestId("map-stub")).toHaveTextContent("1 lines · 2 flight lines");
  });

  it("closing the panel returns to the day", async () => {
    renderAt("/track/2026-10-03?flight=f1");
    await waitFor(() => expect(mapProps.last?.highlight).toHaveLength(2));
    fireEvent.click(screen.getByRole("button", { name: "track:map.point.close" }));
    await waitFor(() => expect(screen.queryByTestId("track-flight-panel")).toBeNull());
    await waitFor(() => expect(mapProps.last?.highlight).toHaveLength(0));
  });

  it("a flight line that cannot be loaded says so", async () => {
    views.range.mockRejectedValue({
      response: { status: 403, data: { code: "TRAVTRACK_DISABLED" } },
    });
    renderAt("/track/2026-10-03?flight=f1");
    expect(await screen.findByText(/track:flight.mapFailed/)).toBeInTheDocument();
  });
});
