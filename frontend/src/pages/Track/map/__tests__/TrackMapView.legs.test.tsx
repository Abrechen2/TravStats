import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
const legsApi = vi.hoisted(() => ({ setMode: vi.fn() }));
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
 * W1/W2 of the legs plan: a leg row or its line selects the leg and fits the
 * map to it, the card words null as a dash, a mode change is written to the
 * server and a failed one is toasted without changing the shown mode, a stop's
 * stay can be reviewed or declined, the inspector shows the phone's readings.
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

describe("TrackMapView legs", () => {
  beforeEach(() => {
    setClockForTests("2026-10-25T12:00:00Z");
    [...Object.values(api), ...Object.values(legsApi), ...Object.values(staysApi)].forEach((fn) =>
      fn.mockReset()
    );
    api.day.mockImplementation(async () => dayWith([leg()], [stop()]));
    api.lastSeen.mockResolvedValue(null);
    window.localStorage.clear();
    useToastStore.setState({ toasts: [] });
    mapProps.last = null;
  });
  afterEach(() => setClockForTests(null));

  it("a leg row click selects the leg, widens it and fits the map to it; the whole day returns", async () => {
    renderDay();
    await screen.findByTestId("map-stub");
    expect(mapProps.last?.refit).toBe("day");
    expect((mapProps.last?.selection as unknown[]).length).toBe(0);

    fireEvent.click(screen.getByTestId("track-leg-row"));
    expect(mapProps.last?.refit).toBe(`leg:${T0}-${T0 + 10 * MIN}`);
    expect(mapProps.last?.frameLines).toEqual([
      [
        [13.4, 52.5],
        [13.405, 52.505],
        [13.41, 52.51],
      ],
    ]);
    expect(mapProps.last?.selection).toEqual(mapProps.last?.frameLines);
    expect(screen.getByTestId("track-leg-row")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByTestId("track-leg-card")).toBeInTheDocument();

    fireEvent.click(within(screen.getByTestId("track-leg-card")).getByText("track:legs.wholeDay"));
    expect(mapProps.last?.refit).toBe("day");
    expect(screen.queryByTestId("track-leg-card")).not.toBeInTheDocument();
  });

  it("a click on a leg's line on the map selects it as well", async () => {
    renderDay();
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByRole("button", { name: "pick-line" }));
    expect(screen.getByTestId("track-leg-card")).toBeInTheDocument();
    expect(screen.getByTestId("track-leg-row")).toHaveAttribute("aria-pressed", "true");
  });

  it("the card shows a dash for a figure the server could not derive, never 0", async () => {
    renderDay();
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByTestId("track-leg-row"));
    const figure = (key: string) =>
      screen.getByTestId("track-leg-figures").querySelector(`[data-figure="${key}"] dd`);
    for (const key of ["moving", "avgSpeed", "ascent", "descent"]) {
      expect(figure(key)).toHaveTextContent("–");
      expect(figure(key)).not.toHaveTextContent("0");
    }
    expect(figure("distance")).toHaveTextContent('"km":"4,2"');
    expect(figure("maxSpeed")).toHaveTextContent('"kmh":"72"');
    expect(screen.getByTestId("track-leg-source")).toHaveTextContent("track:legs.source.auto");
  });

  it("an uncertain auto mode says so; an entry leg links to its logbook entry", async () => {
    api.day.mockImplementation(async () => ({
      ...dayWith(
        [
          leg({ confidence: "low" }),
          leg({
            id: "e",
            fromMs: T0 + 1,
            modeSource: "entry",
            mode: "train",
            entryRef: { domain: "rail", id: "r1" },
          }),
        ],
        []
      ),
      context: [
        {
          kind: "rail",
          id: "r1",
          label: "ICE",
          href: "/rail/r1",
          anchor: null,
          unlabelled: false,
          fromMs: T0,
          untilMs: T0 + 1,
        },
      ],
    }));
    renderDay();
    await screen.findByTestId("map-stub");
    const rows = screen.getAllByTestId("track-leg-row");
    expect(rows[0]).toHaveTextContent("track:legs.uncertain");
    fireEvent.click(rows[1]);
    expect(screen.getByTestId("track-leg-source")).toHaveTextContent("track:legs.source.entry");
    expect(screen.getByRole("link", { name: "track:legs.openEntry" })).toHaveAttribute(
      "href",
      "/rail/r1"
    );
  });

  it("a mode chip writes the correction and reads the day again", async () => {
    legsApi.setMode.mockResolvedValue(leg({ mode: "bus", modeSource: "manual" }));
    renderDay();
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByTestId("track-leg-row"));
    api.day.mockImplementation(async () =>
      dayWith([leg({ mode: "bus", modeSource: "manual" })], [stop()])
    );
    fireEvent.click(screen.getByRole("button", { name: "track:legs.mode.bus" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "track:legs.mode.bus" })).toHaveAttribute(
        "aria-pressed",
        "true"
      )
    );
    expect(legsApi.setMode).toHaveBeenCalledWith({ fromMs: T0, untilMs: T0 + 10 * MIN }, "bus");
    expect(api.day).toHaveBeenCalledTimes(2);

    legsApi.setMode.mockResolvedValue(leg());
    fireEvent.click(screen.getByRole("button", { name: "track:legs.mode.auto" }));
    await waitFor(() =>
      expect(legsApi.setMode).toHaveBeenLastCalledWith({ fromMs: T0, untilMs: T0 + 10 * MIN }, null)
    );
  });

  it("a failed mode change toasts that it was not saved and keeps the server's mode", async () => {
    legsApi.setMode.mockRejectedValue({ response: { status: 500, data: {} } });
    renderDay();
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByTestId("track-leg-row"));
    fireEvent.click(screen.getByRole("button", { name: "track:legs.mode.bus" }));
    await waitFor(() => expect(useToastStore.getState().toasts).toHaveLength(1));
    const toast = useToastStore.getState().toasts[0];
    expect(toast.type).toBe("error");
    expect(toast.message).toContain("track:legs.modeFailed");
    expect(toast.message).toContain("track:errors.generic");
    expect(screen.getByTestId("track-leg-mode")).toHaveTextContent("track:legs.mode.car");
    expect(screen.getByRole("button", { name: "track:legs.mode.bus" })).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    expect(api.day).toHaveBeenCalledTimes(1);
  });

  it("a leg that no longer exists (404) is toasted and the day is read again so the stale leg goes", async () => {
    legsApi.setMode.mockRejectedValue({
      response: { status: 404, data: { code: "TRAVTRACK_LEG_NOT_FOUND" } },
    });
    renderDay();
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByTestId("track-leg-row"));
    api.day.mockImplementation(async () => dayWith([], [stop()]));
    fireEvent.click(screen.getByRole("button", { name: "track:legs.mode.bus" }));
    await waitFor(() => expect(screen.queryByTestId("track-leg-card")).not.toBeInTheDocument());
    expect(useToastStore.getState().toasts[0].message).toContain("track:errors.legGone");
  });

  it("the stop card shows span and stay status; an open stay is reviewed or declined from it", async () => {
    staysApi.reject.mockResolvedValue(undefined);
    renderDay();
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByRole("button", { name: "pick-stop" }));
    const card = screen.getByTestId("track-stop-card");
    expect(card).toHaveTextContent("track:stays.state.pending");
    expect(within(card).getByTestId("track-stop-span")).toHaveTextContent('"from":"08:10"');
    expect(within(card).getByTestId("track-stop-review")).toHaveAttribute(
      "href",
      expect.stringContaining("dawarich%3Astay-1")
    );
    api.day.mockImplementation(async () =>
      dayWith([leg()], [stop({ stayRef: { id: "stay-1", status: "rejected" } })])
    );
    fireEvent.click(within(card).getByTestId("track-stop-reject"));
    await waitFor(() => expect(staysApi.reject).toHaveBeenCalledWith("stay-1"));
    await waitFor(() =>
      expect(screen.getByTestId("track-stop-status")).toHaveTextContent(
        "track:stays.state.rejected"
      )
    );
    expect(screen.queryByTestId("track-stop-reject")).not.toBeInTheDocument();
  });

  it("a failed decline of one stop does not carry its error over to the next stop picked", async () => {
    staysApi.reject.mockRejectedValue({ response: { status: 500, data: {} } });
    api.day.mockImplementation(async () =>
      dayWith(
        [leg()],
        [
          stop(),
          stop({
            fromMs: T0 + 120 * MIN,
            untilMs: T0 + 150 * MIN,
            stayRef: { id: "stay-2", status: "pending" },
          }),
        ]
      )
    );
    renderDay();
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByRole("button", { name: "pick-stop" }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("track-stop-reject"));
    });
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "pick-second-stop" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("a failed decline says why and keeps the stay open", async () => {
    staysApi.reject.mockRejectedValue({ response: { status: 500, data: {} } });
    renderDay();
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByRole("button", { name: "pick-stop" }));
    await act(async () => {
      fireEvent.click(screen.getByTestId("track-stop-reject"));
    });
    expect(await screen.findByRole("alert")).toHaveTextContent("track:errors.generic");
    expect(screen.getByTestId("track-stop-status")).toHaveTextContent("track:stays.state.pending");
  });

  it("the point inspector shows speed, altitude and motion; a missing reading is a dash", async () => {
    renderDay();
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByRole("button", { name: "pick-point" }));
    const details = screen.getByTestId("track-point-details");
    expect(details.querySelector('[data-detail="speed"] dd')).toHaveTextContent('"kmh":"36"');
    expect(details.querySelector('[data-detail="altitude"] dd')).toHaveTextContent("–");
    expect(details.querySelector('[data-detail="motion"] dd')).toHaveTextContent("automotive");
  });
});
