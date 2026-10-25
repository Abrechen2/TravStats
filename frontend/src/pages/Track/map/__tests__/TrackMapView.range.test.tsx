import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { TravTrackDay } from "../../../../lib/api/travtrack";
import type { TravTrackRange } from "../../../../lib/api/travtrackViews";
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
vi.mock("../../../../hooks/useTodayZone", () => ({ useTodayZone: () => "UTC" }));
vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
    i18n: { language: "de" },
  }),
}));

type Stub = Record<string, unknown> & {
  lines: unknown[];
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
        {props.lines.length} lines · {props.photos.length} photos
        <button type="button" onClick={() => props.onPoint(props.points[0])}>
          pick
        </button>
      </div>
    );
  },
}));

import TrackMapView from "../TrackMapView";

/**
 * Monat / Jahr / Zeitraum on the map (plan T5.3): the range read arrives in
 * parts that are shown as they land and never joined; a refused span reads
 * as the server's sentence; the replay says it plays seven days at most; the
 * point inspector deletes exactly its point; photos come only from the server.
 */

const H = 3_600_000;
const T0 = Date.parse("2026-10-03T08:00:00Z");
const part = (n: number, over: Partial<TravTrackRange> = {}): TravTrackRange => ({
  from: "2026-10-01T00:00:00.000Z",
  to: "2026-10-26T00:00:00.000Z",
  segments: [
    [
      [T0 + n * 24 * H, 52.5, 13.4, 7],
      [T0 + n * 24 * H + H, 52.51, 13.41, 7],
    ],
  ],
  pointIds: [[`p${n}a`, `p${n}b`]],
  pointCount: 2,
  readCount: 10,
  simplified: false,
  omittedSegments: 0,
  next: null,
  cursor: null,
  ...over,
});

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
    pointIds: [["d1", "d2"]],
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

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

describe("TrackMapView — long spans", () => {
  beforeEach(() => {
    setClockForTests("2026-10-25T12:00:00Z");
    Object.values(api).forEach((fn) => fn.mockReset());
    Object.values(views).forEach((fn) => fn.mockReset());
    api.day.mockImplementation(async (date: string) => dayOf(date));
    api.lastSeen.mockResolvedValue(null);
    views.photoUrl.mockReturnValue("/thumb");
    window.localStorage.clear();
    mapProps.last = null;
  });
  afterEach(() => setClockForTests(null));

  it("a month arrives in parts, shown as they land, with progress, never joined", async () => {
    const second = deferred<TravTrackRange>();
    views.range
      .mockResolvedValueOnce(part(0, { next: "2026-10-13T12:00:00.000Z", cursor: "1:1" }))
      .mockReturnValueOnce(second.promise);
    renderAt("/track/2026-10-25?range=month");

    expect(await screen.findByTestId("map-stub")).toHaveTextContent("1 lines");
    expect(screen.getByTestId("track-range-progress")).toHaveTextContent('"percent":50');
    expect(api.day).not.toHaveBeenCalled();
    expect(views.range).toHaveBeenNthCalledWith(
      1,
      { fromDay: "2026-10-01", toDay: "2026-10-25" },
      null
    );
    expect(views.range).toHaveBeenNthCalledWith(
      2,
      { fromDay: "2026-10-01", toDay: "2026-10-25" },
      "1:1"
    );

    second.resolve(part(1));
    await waitFor(() => expect(screen.getByTestId("map-stub")).toHaveTextContent("2 lines"));
    expect(screen.queryByTestId("track-range-progress")).not.toBeInTheDocument();
    // Two stretches from two parts: side by side, never one line.
    expect((mapProps.last?.segments as unknown[]).length).toBe(2);
    expect(screen.getByTestId("track-day-count")).toHaveTextContent('"count":20');
    expect(screen.getByTestId("track-range-days-note")).toBeInTheDocument();
  });

  it("a span over 400 days reads as the server's refusal", async () => {
    views.range.mockRejectedValue({
      response: { status: 400, data: { code: "TRAVTRACK_RANGE_TOO_LONG" } },
    });
    renderAt("/track/2026-10-25?range=custom&from=2024-01-01");
    const alert = await screen.findByTestId("track-range-failed");
    expect(alert).toHaveTextContent("track:errors.rangeTooLong");
    expect(screen.queryByTestId("track-day-empty")).not.toBeInTheDocument();
  });

  it("a failed part keeps what arrived, and resumes from its own cursor", async () => {
    views.range
      .mockResolvedValueOnce(part(0, { next: "2026-10-13T12:00:00.000Z", cursor: "9:9" }))
      .mockRejectedValueOnce({ response: { status: 500, data: {} } })
      .mockResolvedValueOnce(part(1));
    renderAt("/track/2026-10-25?range=month");
    const failed = await screen.findByTestId("track-range-failed");
    expect(failed).toHaveTextContent("track:map.rangePartFailed");
    expect(screen.getByTestId("map-stub")).toHaveTextContent("1 lines");
    fireEvent.click(within(failed).getByRole("button", { name: "track:map.rangeResume" }));
    await waitFor(() => expect(screen.getByTestId("map-stub")).toHaveTextContent("2 lines"));
    expect(views.range.mock.calls[2][1]).toBe("9:9");
  });

  it("a year has no replay and says why; the day-only layers are off", async () => {
    views.range.mockResolvedValue(part(0));
    renderAt("/track/2026-10-25?range=year");
    await screen.findByTestId("map-stub");
    expect(screen.getByTestId("track-replay-limit")).toHaveTextContent('"days":7');
    expect(screen.queryByTestId("track-replay")).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: /track:map.layers.visits\b/ })).toBeDisabled();
  });

  it("the Zeitraum picker applies two days together", async () => {
    renderAt("/track");
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByRole("button", { name: "track:map.range.preset.custom" }));
    const picker = screen.getByTestId("track-custom-range");
    fireEvent.change(within(picker).getByLabelText("track:map.range.from"), {
      target: { value: "2026-09-01" },
    });
    fireEvent.change(within(picker).getByLabelText("track:map.range.to"), {
      target: { value: "2026-09-20" },
    });
    views.range.mockResolvedValue(part(0));
    fireEvent.click(within(picker).getByRole("button", { name: "track:map.range.apply" }));
    await waitFor(() =>
      expect(views.range).toHaveBeenCalledWith({ fromDay: "2026-09-01", toDay: "2026-09-20" }, null)
    );
  });

  it("deletes exactly the picked point after a confirmation, then reads again", async () => {
    views.deletePoint.mockResolvedValue(1);
    renderAt("/track");
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByRole("button", { name: "pick" }));
    const inspector = screen.getByTestId("track-point-inspector");
    fireEvent.click(within(inspector).getByRole("button", { name: "track:map.point.delete" }));
    const confirm = await screen.findByText("track:map.point.deleteConfirm");
    const dialog = confirm.closest("[role=dialog], [role=alertdialog]") as HTMLElement;
    const buttons = within(dialog).getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]);
    await waitFor(() => expect(views.deletePoint).toHaveBeenCalledWith("d1"));
    expect(await screen.findByText("track:map.point.deleted")).toBeInTheDocument();
    await waitFor(() => expect(api.day).toHaveBeenCalledTimes(2));
  });

  it("a failed delete says why and keeps the point", async () => {
    views.deletePoint.mockRejectedValue({
      response: { status: 404, data: { code: "TRAVTRACK_POINT_NOT_FOUND" } },
    });
    renderAt("/track");
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByRole("button", { name: "pick" }));
    fireEvent.click(screen.getByRole("button", { name: "track:map.point.delete" }));
    const confirm = await screen.findByText("track:map.point.deleteConfirm");
    const dialog = confirm.closest("[role=dialog], [role=alertdialog]") as HTMLElement;
    const buttons = within(dialog).getAllByRole("button");
    fireEvent.click(buttons[buttons.length - 1]);
    const inspector = screen.getByTestId("track-point-inspector");
    expect(await within(inspector).findByRole("alert")).toHaveTextContent("track:errors.pointGone");
    expect(api.day).toHaveBeenCalledTimes(1);
  });

  it("photos come from the server's list; a missing Immich points to Settings", async () => {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ layers: { photos: true } }));
    views.photos.mockRejectedValue({ response: { status: 409, data: { error: "notConfigured" } } });
    renderAt("/track");
    await screen.findByTestId("map-stub");
    const link = await screen.findByRole("link", { name: "track:photos.connect" });
    expect(link.getAttribute("href")).toContain("/settings/services");
    expect(screen.getByText(/track:photos.failure.notConfigured/)).toBeInTheDocument();
    expect(screen.getByTestId("map-stub")).toHaveTextContent("0 photos");
  });

  it("placed photos reach the map; a span over seven days asks for a shorter one", async () => {
    window.localStorage.setItem(PREFS_KEY, JSON.stringify({ layers: { photos: true } }));
    views.photos.mockResolvedValue({
      photos: [
        { assetId: "x", type: "IMAGE", takenAt: "2026-10-25T08:05:00.000Z", lat: 52.5, lon: 13.4 },
      ],
      truncated: false,
    });
    const { unmount } = renderAt("/track");
    await waitFor(() => expect(screen.getByTestId("map-stub")).toHaveTextContent("1 photos"));
    expect(views.photos).toHaveBeenCalledWith({
      from: "2026-10-25T08:00:00.000Z",
      to: "2026-10-25T08:10:00.001Z",
    });
    unmount();

    views.photos.mockClear();
    views.range.mockResolvedValue(part(0));
    renderAt("/track/2026-10-25?range=month");
    expect(await screen.findByTestId("track-photos-too-long")).toBeInTheDocument();
    expect(views.photos).not.toHaveBeenCalled();
  });
});
