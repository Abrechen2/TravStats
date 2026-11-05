import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

const viewport = vi.hoisted(() => ({ phone: true }));
vi.mock("../useNarrowStage", () => ({
  useNarrowStage: () => viewport.phone,
}));

import TrackMapView from "../TrackMapView";

const T0 = Date.parse("2026-10-25T08:00:00Z");
const day: TravTrackDay = {
  date: "2026-10-25",
  zone: "UTC",
  segments: [
    [
      [T0, 52.5, 13.4, 7],
      [T0 + 600_000, 52.51, 13.41, 7],
    ],
  ],
  coverage: [],
  context: [],
  pointCount: 2,
  truncated: false,
};

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/track/:date" element={<TrackMapView />} />
      </Routes>
    </MemoryRouter>
  );

describe("TrackMapView cards", () => {
  beforeEach(() => {
    setClockForTests("2026-10-25T12:00:00Z");
    Object.values(api).forEach((fn) => fn.mockReset());
    api.day.mockResolvedValue(day);
    api.lastSeen.mockResolvedValue(null);
    window.localStorage.clear();
    viewport.phone = false;
  });
  afterEach(() => setClockForTests(null));

  it("'Tag in Zahlen' leads with three figures and 'Alle Werte' opens the rest", async () => {
    renderAt("/track/2026-10-25");
    await screen.findByTestId("map-stub");
    const keys = () =>
      within(screen.getByTestId("track-totals"))
        .getAllByText(/track:map\.totals\./, { selector: "dt" })
        .map((el) => el.closest("[data-total]")?.getAttribute("data-total"));
    expect(keys()).toEqual(["distance", "moving", "stops"]);
    fireEvent.click(screen.getByTestId("track-totals-all"));
    expect(keys()).toEqual(
      expect.arrayContaining(["distance", "moving", "stops", "avgSpeed", "points", "coverage"])
    );
    fireEvent.click(screen.getByTestId("track-totals-all"));
    expect(keys()).toEqual(["distance", "moving", "stops"]);
  });

  it("the day card switches between 'Etappen & Stopps' and 'Logbuch'", async () => {
    renderAt("/track/2026-10-25");
    await screen.findByTestId("map-stub");
    expect(screen.getByRole("tab", { name: "track:map.dayCard.legs" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    expect(screen.getByTestId("track-no-legs")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "track:map.dayCard.log" }));
    expect(screen.queryByTestId("track-no-legs")).not.toBeInTheDocument();
    expect(screen.getByText("track:timeline.none")).toBeInTheDocument();
  });

  it("a clicked point takes the day card's detail slot, closing it returns the tabs", async () => {
    renderAt("/track/2026-10-25");
    await screen.findByTestId("map-stub");
    fireEvent.click(screen.getByRole("button", { name: "pick" }));
    const slot = screen.getByTestId("track-detail");
    expect(within(slot).getByTestId("track-point-inspector")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    fireEvent.click(within(slot).getByText("track:map.point.close"));
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });

  it("the replay is folded to 'Tag abspielen' and opens on demand", async () => {
    renderAt("/track/2026-10-25");
    await screen.findByTestId("map-stub");
    expect(screen.queryByTestId("track-replay")).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("track-replay-open"));
    expect(screen.getByTestId("track-replay")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("track-replay-close"));
    expect(screen.queryByTestId("track-replay")).not.toBeInTheDocument();
  });
});
