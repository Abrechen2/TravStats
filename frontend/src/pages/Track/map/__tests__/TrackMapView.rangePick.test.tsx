import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { TravTrackDay } from "../../../../lib/api/travtrack";
import type { TravTrackRange } from "../../../../lib/api/travtrackViews";
import { setClockForTests } from "../../../../shared/time/clock";

const api = vi.hoisted(() => ({
  day: vi.fn(),
  zones: vi.fn(),
  summary: vi.fn(),
  deleteDays: vi.fn(),
  deleteSpan: vi.fn(),
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
  photoSources: vi.fn(),
  flightPanel: vi.fn(),
}));
vi.mock("../../../../lib/api/travtrackViews", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/api/travtrackViews")>()),
  travTrackViewsApi: views,
}));
// The stop card asks who the stop is; a picked stop must not reach the network.
const legsApi = vi.hoisted(() => ({ stopIdentity: vi.fn(), setStopPlace: vi.fn() }));
vi.mock("../../../../lib/api/travtrackLegs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/api/travtrackLegs")>()),
  travTrackLegsApi: legsApi,
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
    const lines = props.rangeLines as Array<{ times: number[] }>;
    const onRangePick = props.onRangePick as (at: number) => void;
    return (
      <div data-testid="map-stub">
        <button type="button" onClick={() => onRangePick(lines[0].times[0] + 60_000)}>
          pick-range
        </button>
      </div>
    );
  },
}));

import TrackMapView from "../TrackMapView";
import type { TravTrackLeg } from "../../../../lib/api/travtrackLegs";

/**
 * The month, year and Zeitraum maps have no legs in their read: a click on a
 * drawn stretch names an instant, the day of it is read, and the leg holding
 * the instant opens the leg card — with „Tag öffnen" and a confirmed delete.
 */

const H = 3_600_000;
const MIN = 60_000;
const T0 = Date.parse("2026-10-03T08:00:00Z");
const part = (): TravTrackRange => ({
  from: "2026-10-01T00:00:00.000Z",
  to: "2026-10-26T00:00:00.000Z",
  segments: [
    [
      [T0, 52.5, 13.4, 7],
      [T0 + 10 * MIN, 52.51, 13.41, 7],
    ],
  ],
  pointIds: [["p1", "p2"]],
  pointCount: 2,
  readCount: 10,
  simplified: false,
  omittedSegments: 0,
  next: null,
  cursor: null,
});
const leg: TravTrackLeg = {
  id: `${T0}-${T0 + 10 * MIN}`,
  fromMs: T0,
  untilMs: T0 + 10 * MIN,
  mode: "car",
  modeSource: "auto",
  confidence: "high",
  entryRef: null,
  distanceM: 4200,
  durationMs: 10 * MIN,
  movingMs: null,
  avgSpeedMps: null,
  maxSpeedMps: 20,
  ascentM: null,
  descentM: null,
  bounds: [13.4, 52.5, 13.41, 52.51],
  ranges: [{ segment: 0, from: 0, to: 1 }],
};
const day = (legs: TravTrackLeg[]): TravTrackDay => ({
  date: "2026-10-03",
  zone: "UTC",
  segments: [
    [
      [T0, 52.5, 13.4, 7],
      [T0 + 10 * MIN, 52.51, 13.41, 7],
    ],
  ],
  pointIds: [["p1", "p2"]],
  coverage: [{ fromMs: T0 - 8 * H, untilMs: T0 + 16 * H, state: "recorded" }],
  context: [],
  pointCount: 2,
  truncated: false,
  legs,
  stops: [],
});

const renderMonth = () =>
  render(
    <MemoryRouter initialEntries={["/track/2026-10-25?range=month"]}>
      <Routes>
        <Route path="/track/:date" element={<TrackMapView />} />
        <Route path="/track" element={<TrackMapView />} />
      </Routes>
    </MemoryRouter>
  );

describe("TrackMapView — a click on a long span's route picks its leg", () => {
  beforeEach(() => {
    setClockForTests("2026-10-25T12:00:00Z");
    Object.values(api).forEach((fn) => fn.mockReset());
    Object.values(views).forEach((fn) => fn.mockReset());
    views.photoSources.mockResolvedValue([]);
    views.range.mockResolvedValue(part());
    months.months.mockReset();
    world.load.mockReset();
    api.day.mockResolvedValue(day([leg]));
    api.lastSeen.mockResolvedValue(null);
    window.localStorage.clear();
    mapProps.last = null;
    legsApi.stopIdentity.mockReset();
    legsApi.stopIdentity.mockResolvedValue({ candidates: [], accepted: null });
  });
  afterEach(() => setClockForTests(null));

  it("a month's range line was not clickable at all; now it opens the leg card from that day's read", async () => {
    renderMonth();
    await screen.findByTestId("map-stub");
    expect((mapProps.last?.rangeLines as unknown[]).length).toBe(1);
    fireEvent.click(screen.getByText("pick-range"));
    const card = await screen.findByTestId("track-leg-card");
    expect(api.day).toHaveBeenCalledWith("2026-10-03");
    expect(within(card).getByTestId("track-leg-mode")).toHaveTextContent("track:legs.mode.car");
    expect(mapProps.last?.refit).toBe(`leg:${leg.id}`);
    // The picked leg is drawn highlighted over the range line.
    expect((mapProps.last?.selection as unknown[]).length).toBe(1);
    expect(within(card).getByTestId("track-leg-open-day")).toBeInTheDocument();
  });

  it("the hit width is generous for a finger and thin for a mouse", async () => {
    const original = window.matchMedia;
    try {
      window.matchMedia = ((q: string) => ({
        matches: q.includes("coarse"),
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      })) as unknown as typeof window.matchMedia;
      const touch = renderMonth();
      await screen.findByTestId("map-stub");
      expect(mapProps.last?.pickWidth).toBe(40);
      expect(mapProps.last?.coarse).toBe(true);
      touch.unmount();
      window.matchMedia = ((q: string) => ({
        matches: false,
        media: q,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
      })) as unknown as typeof window.matchMedia;
      renderMonth();
      await screen.findByTestId("map-stub");
      expect(mapProps.last?.pickWidth).toBe(16);
    } finally {
      window.matchMedia = original;
    }
  });

  it("a failed day read says so in an alert and opens no card", async () => {
    api.day.mockRejectedValueOnce(new Error("boom"));
    renderMonth();
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByText("pick-range"));
    expect(await screen.findByTestId("track-pick-failed")).toHaveAttribute("role", "alert");
    expect(screen.queryByTestId("track-leg-card")).not.toBeInTheDocument();
  });

  it("a click between two legs says there is no section there", async () => {
    api.day.mockResolvedValue(day([]));
    renderMonth();
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByText("pick-range"));
    expect(await screen.findByTestId("track-pick-none")).toBeInTheDocument();
  });

  it("a click on a long span where the phone stood still opens that stop's card", async () => {
    // The clicked instant (T0 + 1 min) lies in a stop, not in a leg.
    api.day.mockResolvedValue({
      ...day([]),
      stops: [
        {
          fromMs: T0 - 30 * MIN,
          untilMs: T0 + 5 * MIN,
          anchor: { lat: 52.5, lon: 13.4 },
          stayRef: null,
          place: null,
        },
      ],
    });
    renderMonth();
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByText("pick-range"));
    expect(await screen.findByTestId("track-stop-card")).toBeInTheDocument();
    expect(api.day).toHaveBeenCalledWith("2026-10-03");
    expect(screen.queryByTestId("track-pick-none")).not.toBeInTheDocument();
  });

  it("a dismissed stop is no pick on a long span either", async () => {
    api.day.mockResolvedValue({
      ...day([]),
      stops: [
        {
          fromMs: T0 - 30 * MIN,
          untilMs: T0 + 5 * MIN,
          anchor: { lat: 52.5, lon: 13.4 },
          stayRef: null,
          place: null,
          dismissed: true,
        },
      ],
    });
    renderMonth();
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByText("pick-range"));
    expect(await screen.findByTestId("track-pick-none")).toBeInTheDocument();
    expect(screen.queryByTestId("track-stop-card")).not.toBeInTheDocument();
  });

  it("„Tag öffnen“ navigates to that day", async () => {
    renderMonth();
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByText("pick-range"));
    fireEvent.click(await screen.findByTestId("track-leg-open-day"));
    await waitFor(() => expect(screen.queryByTestId("track-leg-card")).not.toBeInTheDocument());
    expect(api.day).toHaveBeenLastCalledWith("2026-10-03");
    expect(views.range).toHaveBeenCalledTimes(1);
  });

  it("deleting the section's points asks first, then deletes exactly that stretch", async () => {
    api.deleteSpan.mockResolvedValue(2);
    renderMonth();
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByText("pick-range"));
    fireEvent.click(await screen.findByTestId("track-leg-delete"));
    expect(api.deleteSpan).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("track-leg-delete-yes"));
    await waitFor(() =>
      expect(api.deleteSpan).toHaveBeenCalledWith({ fromMs: leg.fromMs, untilMs: leg.untilMs })
    );
    await waitFor(() => expect(screen.queryByTestId("track-leg-card")).not.toBeInTheDocument());
  });
});
