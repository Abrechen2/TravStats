import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { TravTrackDay } from "../../../../lib/api/travtrack";
import { setClockForTests } from "../../../../shared/time/clock";
import { PREFS_KEY } from "../trackMapPrefs";

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
vi.mock("../../../../hooks/useTodayZone", () => ({ useTodayZone: () => "UTC" }));
vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
    i18n: { language: "de" },
  }),
}));

// WebGL is not there in jsdom: the stub shows what the map was given.
const mapProps = vi.hoisted(() => ({ last: null as Record<string, unknown> | null }));
vi.mock("../TrackRangeMap", () => ({
  default: (
    props: Record<string, unknown> & { lines: unknown[]; onPoint: (p: unknown) => void }
  ) => {
    mapProps.last = props;
    const segments = props.segments as Array<Array<[number, number, number, number | null]>>;
    return (
      <div data-testid="map-stub">
        {props.lines.length} lines
        <button type="button" onClick={() => props.onPoint({ point: segments[0][0], zone: "UTC" })}>
          pick
        </button>
      </div>
    );
  },
}));

import TrackMapView from "../TrackMapView";

/**
 * The Track map tab (plan T5.2): seven days composed from day reads, a
 * failed one named; no zone drawn; layer switches remembered; live follow
 * reads today again; a clicked point shows what the day read carries.
 */

const H = 3_600_000;
const dayOf = (date: string): TravTrackDay => {
  const t0 = Date.parse(`${date}T08:00:00Z`);
  return {
    date,
    zone: "UTC",
    segments: [
      [
        [t0, 52.5, 13.4, 7],
        [t0 + H / 6, 52.51, 13.41, 7],
      ],
    ],
    coverage: [{ fromMs: t0 - 8 * H, untilMs: t0 + 16 * H, state: "recorded" }],
    context: [],
    pointCount: 2,
    truncated: false,
  };
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/track/:date" element={<TrackMapView />} />
        <Route path="/track" element={<TrackMapView />} />
      </Routes>
    </MemoryRouter>
  );

describe("TrackMapView", () => {
  beforeEach(() => {
    setClockForTests("2026-10-25T12:00:00Z");
    Object.values(api).forEach((fn) => fn.mockReset());
    api.day.mockImplementation(async (date: string) => dayOf(date));
    api.lastSeen.mockResolvedValue(null);
    window.localStorage.clear();
    mapProps.last = null;
  });
  afterEach(() => setClockForTests(null));

  it("composes seven days; a failed day is named, never drawn as empty", async () => {
    api.day.mockImplementation(async (date: string) => {
      if (date === "2026-10-22") throw { response: { status: 500, data: {} } };
      return dayOf(date);
    });
    renderAt("/track/2026-10-25?range=7");
    expect(await screen.findByTestId("map-stub")).toHaveTextContent("6 lines");
    expect(api.day).toHaveBeenCalledTimes(7);
    const failed = screen.getByTestId("track-failed-days");
    expect(failed).toHaveTextContent("track:map.dayFailed");
    expect(failed).toHaveTextContent("track:errors.generic");
    expect(failed).toHaveTextContent("22. Oktober 2026");
    expect(screen.queryByTestId("track-day-empty")).not.toBeInTheDocument();
    expect(screen.getByTestId("track-day-count")).toHaveTextContent('"count":12');

    // „Erneut laden" reads the range again.
    api.day.mockImplementation(async (date: string) => dayOf(date));
    fireEvent.click(screen.getByRole("button", { name: "track:map.retry" }));
    await waitFor(() => expect(screen.queryByTestId("track-failed-days")).not.toBeInTheDocument());
  });

  it("never asks for or draws the private zones", async () => {
    renderAt("/track");
    await screen.findByTestId("map-stub");
    expect(api.zones).not.toHaveBeenCalled();
    expect(Object.keys(mapProps.last ?? {}).some((k) => /zone/i.test(k))).toBe(false);
  });

  it("a layer switch reaches the map and is remembered", async () => {
    renderAt("/track");
    await screen.findByTestId("map-stub");
    const heat = screen.getByRole("checkbox", { name: /track:map.layers.heat\b/ });
    expect(heat).not.toBeChecked();
    fireEvent.click(heat);
    expect((mapProps.last?.layers as Record<string, boolean>).heat).toBe(true);
    expect(JSON.parse(window.localStorage.getItem(PREFS_KEY) ?? "{}").layers.heat).toBe(true);
  });

  it("live follow polls last-seen and reads today again", async () => {
    api.lastSeen.mockResolvedValue({
      at: "2026-10-25T11:59:00Z",
      lat: 52.52,
      lon: 13.42,
      accuracyM: 5,
      deviceId: null,
      deviceLabel: null,
      origin: "companion",
    });
    renderAt("/track");
    await screen.findByTestId("map-stub");
    expect(api.day).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "track:map.live.off" }));
    await waitFor(() => expect(api.lastSeen).toHaveBeenCalled());
    await waitFor(() => expect(api.day).toHaveBeenCalledTimes(2));
    expect(api.day).toHaveBeenLastCalledWith("2026-10-25");
    await waitFor(() => expect(mapProps.last?.follow).toEqual([13.42, 52.52]));
  });

  it("a failed live poll says so", async () => {
    api.lastSeen.mockRejectedValue(new Error("offline"));
    renderAt("/track");
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByRole("button", { name: "track:map.live.off" }));
    expect(await screen.findByText(/track:map.live.failed.*track:errors.network/)).toBeTruthy();
  });

  it("a clicked point shows time, coordinates and accuracy — no speed it does not have", async () => {
    renderAt("/track");
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByRole("button", { name: "pick" }));
    const inspector = screen.getByTestId("track-point-inspector");
    expect(inspector).toHaveTextContent("52.50000, 13.40000");
    expect(inspector).toHaveTextContent('track:map.point.accuracy {"m":7}');
    expect(inspector).not.toHaveTextContent("km/h");
  });

  it("the 7-day preset keeps the day in the URL and steps by a week", async () => {
    renderAt("/track/2026-10-20");
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByRole("button", { name: "track:map.range.preset.week" }));
    await waitFor(() => expect(api.day).toHaveBeenCalledWith("2026-10-14"));
    fireEvent.click(screen.getByRole("button", { name: "track:map.range.previous" }));
    await waitFor(() => expect(api.day).toHaveBeenCalledWith("2026-10-07"));
  });
});
