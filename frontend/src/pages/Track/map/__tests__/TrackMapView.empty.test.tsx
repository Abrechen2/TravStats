import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { TravTrackDay } from "../../../../lib/api/travtrack";
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

vi.mock("../useNarrowStage", () => ({
  useNarrowStage: () => false,
  useDockedStage: () => false,
}));
const log = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("../../../../lib/logger", () => ({
  logger: { warn: log.warn, error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import TrackMapView from "../TrackMapView";

const empty = (omitted?: { privacyZone: number; implausible: number }): TravTrackDay => ({
  date: "2026-10-25",
  zone: "UTC",
  segments: [],
  coverage: [],
  context: [],
  pointCount: 0,
  truncated: false,
  ...(omitted ? { omitted } : {}),
});

const renderDay = () =>
  render(
    <MemoryRouter initialEntries={["/track/2026-10-25"]}>
      <Routes>
        <Route path="/track/:date" element={<TrackMapView />} />
      </Routes>
    </MemoryRouter>
  );

/** A day with nothing drawn says why, each reason with its own copy and action. */
describe("TrackMapView empty day reasons", () => {
  beforeEach(() => {
    setClockForTests("2026-10-25T12:00:00Z");
    Object.values(api).forEach((fn) => fn.mockReset());
    log.warn.mockReset();
    api.lastSeen.mockResolvedValue(null);
    window.localStorage.clear();
  });
  afterEach(() => setClockForTests(null));

  it("nothing recorded: says so and points at the Companion and the imports", async () => {
    api.day.mockResolvedValue(empty({ privacyZone: 0, implausible: 0 }));
    renderDay();
    const box = await screen.findByTestId("track-day-empty");
    expect(box).toHaveTextContent("track:empty.day.noRecording");
    expect(screen.getByTestId("track-empty-companion")).toHaveAttribute(
      "href",
      "/settings/telefone#devices"
    );
    expect(screen.getByTestId("track-empty-import")).toHaveAttribute("href", "/track/imports");
    expect(box).not.toHaveTextContent("privacyZone");
  });

  it("hidden by a privacy zone: names the zone and links to the zone settings", async () => {
    api.day.mockResolvedValue(empty({ privacyZone: 7, implausible: 0 }));
    renderDay();
    const box = await screen.findByTestId("track-day-empty");
    expect(box).toHaveTextContent("track:empty.day.privacyZone");
    expect(box).toHaveTextContent('"count":7');
    expect(screen.getByTestId("track-empty-zones")).toHaveAttribute(
      "href",
      "/settings/tt-aufz#ttZones"
    );
    expect(screen.queryByTestId("track-empty-companion")).not.toBeInTheDocument();
  });

  it("filtered as implausible: offers the filtered points, and asks the server for them", async () => {
    api.day.mockResolvedValueOnce(empty({ privacyZone: 0, implausible: 3 }));
    renderDay();
    const box = await screen.findByTestId("track-day-empty");
    expect(box).toHaveTextContent("track:empty.day.implausible");
    api.day.mockResolvedValue({
      ...empty({ privacyZone: 0, implausible: 0 }),
      segments: [[[Date.parse("2026-10-25T08:00:00Z"), 52.5, 13.4, 3000]]],
      pointCount: 1,
    });
    fireEvent.click(screen.getByTestId("track-empty-show-filtered"));
    await waitFor(() => expect(api.day).toHaveBeenLastCalledWith("2026-10-25", true));
    await waitFor(() => expect(screen.queryByTestId("track-day-empty")).not.toBeInTheDocument());
  });

  it("an older server that sends no reason gets the neutral text, no claim", async () => {
    api.day.mockResolvedValue(empty());
    renderDay();
    const box = await screen.findByTestId("track-day-empty");
    expect(box).toHaveTextContent("track:day.empty");
    expect(screen.queryByTestId("track-empty-companion")).not.toBeInTheDocument();
  });

  it("a failed read is no empty day: its reason, a retry, and a console warning", async () => {
    api.day.mockRejectedValue(new Error("boom"));
    renderDay();
    expect(await screen.findByTestId("track-failed-days")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "track:map.retry" })).toBeInTheDocument();
    expect(screen.queryByTestId("track-day-empty")).not.toBeInTheDocument();
    expect(log.warn).toHaveBeenCalled();
  });
});
