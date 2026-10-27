import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
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
vi.mock("../../../../hooks/useIsPhoneViewport", () => ({
  useIsPhoneViewport: () => viewport.phone,
}));

import TrackMapView from "../TrackMapView";

/**
 * Audit 2026-10-26 (F-005): at 390 px the map started at y≈1281, under the
 * layer switches and the route settings. On a phone the map comes straight
 * after the range control, and the settings fold away below it; on a tablet
 * or desktop the panel stays open beside the map.
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

/** True when `a` comes before `b` in document order. */
const precedes = (a: Element, b: Element) =>
  Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);

describe("TrackMapView on a phone", () => {
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

  it("puts the map before the layer settings and folds them away", async () => {
    viewport.phone = true;
    renderAt("/track/2026-10-25");
    const map = await screen.findByTestId("map-stub");
    const layers = screen.getByRole("complementary", { name: "track:map.panel" });
    expect(precedes(map, layers)).toBe(true);
    const fold = layers.closest("details");
    expect(fold).not.toBeNull();
    expect(fold!.open).toBe(false);
    expect(fold!.querySelector("summary")).toHaveTextContent("track:map.panel");
  });

  it("keeps the panel open beside the map on a wider screen", async () => {
    viewport.phone = false;
    renderAt("/track/2026-10-25");
    const map = await screen.findByTestId("map-stub");
    const layers = screen.getByRole("complementary", { name: "track:map.panel" });
    expect(layers.closest("details")).toBeNull();
    expect(precedes(layers, map)).toBe(true);
  });
});
