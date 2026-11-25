import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { TravTrackDay } from "../../../../lib/api/travtrack";
import type { TravTrackLeg, TravTrackStop } from "../../../../lib/api/travtrackLegs";
import { setClockForTests } from "../../../../shared/time/clock";
import { useToastStore } from "../../../../store/toastStore";

const api = vi.hoisted(() => ({
  day: vi.fn(),
  zones: vi.fn(),
  summary: vi.fn(),
  lastSeen: vi.fn(),
}));
const legsApi = vi.hoisted(() => ({
  setMode: vi.fn(),
  stopIdentity: vi.fn(),
  setStopPlace: vi.fn(),
}));
const staysApi = vi.hoisted(() => ({ reject: vi.fn() }));
// The photo layer is on by default: no photo source is connected in these tests.
// The leg card asks whether road matching is offered (rc46 extras C2): no router here.
vi.mock("../../../../lib/api/travtrackCleanup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/api/travtrackCleanup")>();
  return {
    ...actual,
    travTrackCleanupApi: {
      ...actual.travTrackCleanupApi,
      availability: vi.fn(async () => ({ available: false, reason: "serviceOff" })),
    },
  };
});
vi.mock("../../../../lib/api/travtrackViews", async (importOriginal) => {
  const original = await importOriginal<typeof import("../../../../lib/api/travtrackViews")>();
  return {
    ...original,
    travTrackViewsApi: { ...original.travTrackViewsApi, photoSources: async () => [] },
  };
});
vi.mock("../../../../lib/api/travtrack", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/api/travtrack")>()),
  travTrackApi: api,
}));
vi.mock("../../../../lib/api/travtrackLegs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/api/travtrackLegs")>()),
  travTrackLegsApi: legsApi,
}));
vi.mock("../../../../lib/api/dawarichStays", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../../lib/api/dawarichStays")>()),
  dawarichStaysApi: staysApi,
}));
const viewport = vi.hoisted(() => ({ docked: true }));
vi.mock("../useNarrowStage", () => ({
  useNarrowStage: () => false,
  useDockedStage: () => viewport.docked,
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
  default: (props: Record<string, unknown>) => {
    mapProps.last = props;
    const legLines = props.legLines as Array<{ id: string; date: string; path: unknown }>;
    const stops = props.stops as Array<{ date: string; fromMs: number }>;
    const segments = props.segments as Array<Array<[number, number, number, number | null]>>;
    const onLeg = props.onLeg as (l: unknown) => void;
    const onStop = props.onStop as (s: unknown) => void;
    const onPoint = props.onPoint as (p: unknown) => void;
    return (
      <div data-testid="map-stub">
        <button type="button" onClick={() => onLeg(legLines[0])}>
          pick-line
        </button>
        <button type="button" onClick={() => onStop(stops[0])}>
          pick-stop
        </button>
        <button type="button" onClick={() => onStop(stops[1])}>
          pick-second-stop
        </button>
        <button
          type="button"
          onClick={() =>
            onPoint({
              point: segments[0][1],
              zone: "UTC",
              detail: { speedMps: 10, altitudeM: null, motion: "automotive" },
            })
          }
        >
          pick-point
        </button>
      </div>
    );
  },
}));

import TrackMapView from "../TrackMapView";
import { clearStopIdentityCache } from "../../../../lib/travtrackStopIdentity";

/**
 * iPad landscape (>= 1024 px): the day's legs and stops stay in a docked column beside the map;
 * the selected thing's detail sits above them, never in place of them; the selection is one
 * state for list and map; the tab and the scroll position survive the move into the sheet.
 */

const T0 = Date.parse("2026-10-25T08:00:00Z");
const MIN = 60_000;
const DATE = "2026-10-25";

const leg = (over: Partial<TravTrackLeg> = {}): TravTrackLeg => ({
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
  ranges: [{ segment: 0, from: 0, to: 2 }],
  ...over,
});

const stop = (over: Partial<TravTrackStop> = {}): TravTrackStop => ({
  fromMs: T0 + 10 * MIN,
  untilMs: T0 + 70 * MIN,
  anchor: { lat: 52.51, lon: 13.41 },
  stayRef: { id: "stay-1", status: "pending" },
  place: null,
  ...over,
});

const dayWith = (legs: TravTrackLeg[], stops: TravTrackStop[]): TravTrackDay => ({
  date: DATE,
  zone: "UTC",
  segments: [
    [
      [T0, 52.5, 13.4, 7],
      [T0 + 5 * MIN, 52.505, 13.405, 7],
      [T0 + 10 * MIN, 52.51, 13.41, 7],
    ],
  ],
  coverage: [{ fromMs: T0 - 8 * 3_600_000, untilMs: T0 + 16 * 3_600_000, state: "recorded" }],
  context: [],
  pointCount: 3,
  truncated: false,
  legs,
  stops,
});

const renderDay = () =>
  render(
    <MemoryRouter initialEntries={[`/track/${DATE}`]}>
      <Routes>
        <Route path="/track/:date" element={<TrackMapView />} />
      </Routes>
    </MemoryRouter>
  );

describe("TrackMapView docked split view", () => {
  beforeEach(() => {
    setClockForTests("2026-10-25T12:00:00Z");
    [...Object.values(api), ...Object.values(legsApi), ...Object.values(staysApi)].forEach((fn) =>
      fn.mockReset()
    );
    api.day.mockImplementation(async () => dayWith([leg()], [stop()]));
    api.lastSeen.mockResolvedValue(null);
    legsApi.stopIdentity.mockReturnValue(new Promise(() => {}));
    clearStopIdentityCache();
    window.localStorage.clear();
    useToastStore.setState({ toasts: [] });
    mapProps.last = null;
    viewport.docked = true;
  });
  afterEach(() => setClockForTests(null));

  it("landscape: the list stays beside the map with a leg selected (was: the detail card replaced the list)", async () => {
    renderDay();
    await screen.findByTestId("map-stub");
    const dock = screen.getByTestId("track-dock");
    expect(within(dock).getByTestId("track-leg-row")).toBeInTheDocument();

    fireEvent.click(within(dock).getByTestId("track-leg-row"));
    expect(mapProps.last?.refit).toBe(`leg:${T0}-${T0 + 10 * MIN}`);
    // Detail above, list still there, the selected row pressed.
    expect(within(dock).getByTestId("track-leg-card")).toBeInTheDocument();
    expect(within(dock).getByTestId("track-leg-row")).toHaveAttribute("aria-pressed", "true");
    expect(within(dock).getByTestId("track-stop-row")).toBeInTheDocument();
  });

  it("a click on the map highlights the row, a click on a row highlights the map: one selection", async () => {
    renderDay();
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByRole("button", { name: "pick-stop" }));
    expect(screen.getByTestId("track-stop-row")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("track-leg-row")).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByTestId("track-leg-row"));
    expect(screen.getByTestId("track-leg-row")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("track-stop-row")).toHaveAttribute("aria-pressed", "false");
    expect((mapProps.last?.selection as unknown[]).length).toBeGreaterThan(0);
  });

  it("portrait keeps today's sheet: the detail replaces the list", async () => {
    viewport.docked = false;
    renderDay();
    await screen.findByTestId("map-stub");
    expect(screen.queryByTestId("track-dock")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("track-leg-row"));
    expect(screen.getByTestId("track-leg-card")).toBeInTheDocument();
    expect(screen.queryByTestId("track-leg-row")).not.toBeInTheDocument();
  });

  it("rotating to portrait keeps the selection and the chosen tab (was: the card was rebuilt empty)", async () => {
    const { rerender } = renderDay();
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByRole("tab", { name: "track:map.dayCard.log" }));
    fireEvent.click(screen.getByRole("tab", { name: "track:map.dayCard.legs" }));
    fireEvent.click(screen.getByTestId("track-leg-row"));
    viewport.docked = false;
    rerender(
      <MemoryRouter initialEntries={[`/track/${DATE}`]}>
        <Routes>
          <Route path="/track/:date" element={<TrackMapView />} />
        </Routes>
      </MemoryRouter>
    );
    // Still selected: the sheet shows the leg's detail.
    expect(screen.getByTestId("track-leg-card")).toBeInTheDocument();
    expect(mapProps.last?.refit).toBe(`leg:${T0}-${T0 + 10 * MIN}`);
  });

  it("a stop spanning a silence shows measured and assumed time and its dashed gap", async () => {
    api.day.mockImplementation(async () =>
      dayWith(
        [leg()],
        [
          stop({
            coverage: {
              observedMs: 40 * MIN,
              inferredMs: 20 * MIN,
              gaps: [{ fromMs: T0 + 30 * MIN, untilMs: T0 + 50 * MIN }],
            },
          }),
        ]
      )
    );
    renderDay();
    await screen.findByTestId("map-stub");
    expect(screen.getByTestId("track-stop-coverage-figures")).toHaveTextContent(
      "track:stop.coverage.figures"
    );
    expect(screen.getByTestId("track-stop-coverage-figures").textContent).toContain("observed");
    expect(screen.getAllByTestId("track-stop-gap")).toHaveLength(1);
  });
});
