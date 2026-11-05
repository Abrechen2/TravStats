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

/**
 * Audit 2026-10-26 (F-005): at 390 px the map started at y≈1281, under the
 * layer switches and the route settings. Since the web redesign (2026-11-05)
 * the map fills the page: on a narrow stage the layers and the totals are
 * folded pills over the map and the day's log is a bottom sheet; on a wide one
 * the cards are open beside it.
 */

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

describe("TrackMapView on a narrow stage", () => {
  beforeEach(() => {
    setClockForTests("2026-10-25T12:00:00Z");
    Object.values(api).forEach((fn) => fn.mockReset());
    api.day.mockResolvedValue(day);
    api.lastSeen.mockResolvedValue(null);
    window.localStorage.clear();
  });
  afterEach(() => {
    setClockForTests(null);
    viewport.phone = true;
  });

  it("folds the layers and the totals to pills and puts the day log in a sheet", async () => {
    viewport.phone = true;
    renderAt("/track/2026-10-25");
    await screen.findByTestId("map-stub");
    for (const id of ["track-layers-card", "track-totals-card", "track-day-card"]) {
      expect(screen.getByTestId(id)).toHaveAttribute("data-collapsed", "true");
    }
    expect(screen.getByTestId("track-sheet")).toContainElement(
      screen.getByTestId("track-day-card")
    );
    // A pill opens its card.
    fireEvent.click(
      within(screen.getByTestId("track-layers-card")).getByRole("button", {
        name: /track:map.layers.title/,
      })
    );
    expect(screen.getByTestId("track-layers-card")).toHaveAttribute("data-collapsed", "false");
    expect(screen.getByRole("complementary", { name: "track:map.panel" })).toBeInTheDocument();
  });

  it("keeps the cards open beside the map on a wider stage", async () => {
    viewport.phone = false;
    renderAt("/track/2026-10-25");
    await screen.findByTestId("map-stub");
    for (const id of ["track-layers-card", "track-day-card"]) {
      expect(screen.getByTestId(id)).toHaveAttribute("data-collapsed", "false");
    }
    expect(screen.queryByTestId("track-sheet")).not.toBeInTheDocument();
    // Collapse and expand are the card header's job.
    const header = within(screen.getByTestId("track-day-card")).getAllByRole("button")[0];
    fireEvent.click(header);
    expect(screen.getByTestId("track-day-card")).toHaveAttribute("data-collapsed", "true");
    fireEvent.click(header);
    expect(screen.getByTestId("track-day-card")).toHaveAttribute("data-collapsed", "false");
  });
});
