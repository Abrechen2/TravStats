import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { TravTrackDay } from "../../../../lib/api/travtrack";
import type { TravTrackLeg } from "../../../../lib/api/travtrackLegs";
import { setClockForTests } from "../../../../shared/time/clock";

const api = vi.hoisted(() => ({
  day: vi.fn(),
  zones: vi.fn(),
  summary: vi.fn(),
  lastSeen: vi.fn(),
}));
const legsApi = vi.hoisted(() => ({
  setMode: vi.fn(),
  stopIdentity: vi.fn(() => new Promise(() => {})),
  setStopPlace: vi.fn(),
}));
const staysApi = vi.hoisted(() => ({ reject: vi.fn() }));
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

/**
 * W3 of the legs plan: "play this leg" limits the replay to the leg, "show its
 * points" draws the leg's own vertices, the accuracy limit hides worse points
 * (an unreported accuracy stays), and a picked leg is framed beside its card.
 */

const T0 = Date.parse("2026-10-25T08:00:00Z");
const MIN = 60_000;
const DATE = "2026-10-25";
const at = (m: number, accuracy: number | null): [number, number, number, number | null] => [
  T0 + m * MIN,
  52.5 + m * 0.001,
  13.4 + m * 0.001,
  accuracy,
];

const LEG: TravTrackLeg = {
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
};

const day = (): TravTrackDay => ({
  date: DATE,
  zone: "UTC",
  segments: [[at(0, 7), at(5, 80), at(10, null), at(20, 7), at(30, 7)]],
  pointIds: [["p0", "p1", "p2", "p3", "p4"]],
  pointDetails: [[0, 1, 2, 3, 4].map(() => ({ speedMps: 5, altitudeM: null, motion: null }))],
  coverage: [{ fromMs: T0 - 8 * 3_600_000, untilMs: T0 + 16 * 3_600_000, state: "recorded" }],
  context: [],
  pointCount: 5,
  truncated: false,
  legs: [LEG],
  stops: [],
});

const renderDay = () =>
  render(
    <MemoryRouter initialEntries={[`/track/${DATE}`]}>
      <Routes>
        <Route path="/track/:date" element={<TrackMapView />} />
      </Routes>
    </MemoryRouter>
  );

const times = (key: string) =>
  (mapProps.last?.[key] as Array<Array<[number, number, number, number | null]>>)
    .flat()
    .map((p) => p[0]);
const pickLeg = async () => {
  renderDay();
  await screen.findByTestId("map-stub");
  fireEvent.click(screen.getByRole("button", { name: "pick-line" }));
};

describe("TrackMapView W3", () => {
  beforeEach(() => {
    setClockForTests("2026-10-25T12:00:00Z");
    [...Object.values(api), ...Object.values(legsApi), ...Object.values(staysApi)].forEach((fn) =>
      fn.mockReset()
    );
    api.day.mockImplementation(async () => day());
    api.lastSeen.mockResolvedValue(null);
    window.localStorage.clear();
    mapProps.last = null;
  });
  afterEach(() => setClockForTests(null));

  it("plays only the picked leg: the scrubber spans the leg and nothing after it is drawn", async () => {
    await pickLeg();
    expect(screen.getByTestId("track-replay")).toBeInTheDocument();
    expect(screen.getByLabelText("track:map.replay.scrub")).toHaveAttribute(
      "max",
      String(T0 + 30 * MIN)
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId("track-leg-replay"));
    });
    const scrub = screen.getByLabelText("track:map.replay.scrub");
    expect(scrub).toHaveAttribute("min", String(T0));
    expect(scrub).toHaveAttribute("max", String(T0 + 10 * MIN));
    expect(Math.max(...times("segments"))).toBeLessThanOrEqual(T0 + 10 * MIN);
    // Resetting returns the whole day.
    fireEvent.click(screen.getByText("track:map.replay.reset"));
    expect(times("segments")).toHaveLength(5);
    expect(screen.getByLabelText("track:map.replay.scrub")).toHaveAttribute(
      "max",
      String(T0 + 30 * MIN)
    );
  });

  it("shows the leg's own vertices as markers, with the inspector, and hides them again", async () => {
    await pickLeg();
    expect(mapProps.last?.legPoints).toEqual([]);
    fireEvent.click(screen.getByTestId("track-leg-points"));
    const shown = mapProps.last?.legPoints as Array<{ id: string | null }>;
    expect(shown.map((p) => p.id)).toEqual(["p0", "p1", "p2"]);
    fireEvent.click(screen.getByTestId("track-leg-points"));
    expect(mapProps.last?.legPoints).toEqual([]);
  });

  it("the accuracy limit hides worse points but keeps one with no reported accuracy", async () => {
    window.localStorage.setItem(
      "travstats.track.mapPrefs.v2",
      JSON.stringify({ maxAccuracyM: 50 })
    );
    await pickLeg();
    const ids = (mapProps.last?.points as Array<{ id: string }>).map((p) => p.id);
    expect(ids).toEqual(["p0", "p2", "p3", "p4"]);
    fireEvent.click(screen.getByTestId("track-leg-points"));
    expect((mapProps.last?.legPoints as Array<{ id: string }>).map((p) => p.id)).toEqual([
      "p0",
      "p2",
    ]);
  });

  it("frames the picked leg beside the card, not under it", async () => {
    renderDay();
    await screen.findByTestId("map-stub");
    expect(mapProps.last?.fitPadding).toBeUndefined();
    fireEvent.click(screen.getByRole("button", { name: "pick-line" }));
    const padding = mapProps.last?.fitPadding as { left: number; bottom: number };
    expect(padding.left).toBeGreaterThanOrEqual(320 + 12);
  });

  it("'Ganzer Tag' after 'play this leg' returns the replay and scrubber to the whole day", async () => {
    await pickLeg();
    await act(async () => {
      fireEvent.click(screen.getByTestId("track-leg-replay"));
    });
    expect(screen.getByLabelText("track:map.replay.scrub")).toHaveAttribute(
      "max",
      String(T0 + 10 * MIN)
    );
    fireEvent.click(within(screen.getByTestId("track-leg-card")).getByText("track:legs.wholeDay"));
    expect(screen.getByLabelText("track:map.replay.scrub")).toHaveAttribute(
      "max",
      String(T0 + 30 * MIN)
    );
    expect(times("segments")).toHaveLength(5);
  });

  it("the point inspector stacks above the leg card", async () => {
    await pickLeg();
    fireEvent.click(screen.getByTestId("track-leg-points"));
    fireEvent.click(screen.getByRole("button", { name: "pick-point" }));
    const z = (el: HTMLElement | null) => Number(el?.style.zIndex);
    const card = screen.getByTestId("track-leg-card").parentElement;
    expect(z(screen.getByTestId("track-point-inspector"))).toBeGreaterThan(z(card));
  });
});
