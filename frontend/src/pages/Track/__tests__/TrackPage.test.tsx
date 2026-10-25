import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import type { TravTrackDay } from "../../../lib/api/travtrack";

const api = vi.hoisted(() => ({
  day: vi.fn(),
  zones: vi.fn(),
  summary: vi.fn(),
  deleteDays: vi.fn(),
  exportFile: vi.fn(),
}));
vi.mock("../../../lib/api/travtrack", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/travtrack")>()),
  travTrackApi: api,
}));
const access = vi.hoisted(() => ({ value: "visible" as "visible" | "hidden" | "pending" }));
vi.mock("../../../hooks/useTravTrackVisible", () => ({
  useTravTrackAccess: () => access.value,
}));
vi.mock("../../../hooks/useTodayZone", () => ({ useTodayZone: () => "Asia/Seoul" }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
  }),
}));
// WebGL is not there in jsdom: the map stub says what it was given.
vi.mock("../TrackDayMap", () => ({
  default: ({ segments }: { segments: unknown[] }) => (
    <div data-testid="track-day-map-stub">{segments.length} segments</div>
  ),
}));

vi.mock("../TrackExploredMap", () => ({
  default: () => <div data-testid="track-explored-stub" />,
}));

import TrackPage from "../TrackPage";

/**
 * `/track/:date` (TravTrack plan T6): the day's lines, labelled from what
 * TravStats knows; a delete that names its count first; and a refusal shown
 * as itself rather than as an empty map.
 */

const D0 = Date.parse("2026-10-11T15:00:00Z");
const MIN = 60_000;

const DAY: TravTrackDay = {
  date: "2026-10-12",
  zone: "Asia/Seoul",
  segments: [
    [
      [D0, 37.5, 127, 5],
      [D0 + MIN, 37.51, 127, 5],
    ],
    [
      [D0 + 300 * MIN, 37.6, 127.1, 5],
      [D0 + 301 * MIN, 37.61, 127.1, 5],
    ],
  ],
  coverage: [{ fromMs: D0, untilMs: D0 + 24 * 60 * MIN, state: "recorded" }],
  context: [
    {
      kind: "flight",
      id: "f1",
      label: "KE1201 ICN–CJU",
      fromMs: D0 + 90 * MIN,
      untilMs: D0 + 150 * MIN,
    },
    { kind: "trip", id: "t1", label: "Seoul", fromMs: D0, untilMs: D0 + 24 * 60 * MIN },
  ],
  pointCount: 4,
  truncated: false,
};

const renderAt = (path = "/track/2026-10-12") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/track/explored" element={<TrackPage view="explored" />} />
        <Route path="/track/:date" element={<TrackPage />} />
        <Route path="/track" element={<TrackPage />} />
        <Route path="/dashboard" element={<p>dashboard</p>} />
      </Routes>
    </MemoryRouter>
  );

describe("TrackPage", () => {
  beforeEach(() => {
    access.value = "visible";
    Object.values(api).forEach((fn) => fn.mockReset());
    api.day.mockResolvedValue(DAY);
    api.zones.mockResolvedValue([]);
  });

  it("the day shows segments and labels them from TravStats context", async () => {
    renderAt();
    expect(await screen.findByTestId("track-day-map-stub")).toHaveTextContent("2 segments");
    expect(api.day).toHaveBeenCalledWith("2026-10-12");
    const timeline = screen.getByTestId("track-timeline");
    expect(within(timeline).getByText(/track:timeline.flight.*KE1201 ICN–CJU/)).toHaveAttribute(
      "href",
      "/flights/f1"
    );
    expect(within(timeline).getByText(/track:timeline.trip.*Seoul/)).toBeInTheDocument();
    expect(screen.getByTestId("track-day-count")).toHaveTextContent('"count":4');
  });

  it("delete asks with the count and refreshes the day", async () => {
    api.summary.mockResolvedValue({ pointCount: 7 });
    api.deleteDays.mockResolvedValue(7);
    renderAt();
    await screen.findByTestId("track-day-map-stub");
    fireEvent.click(screen.getByRole("button", { name: "track:actions.delete" }));
    expect(await screen.findByText(/track:delete.preview.*"count":7/)).toBeInTheDocument();
    expect(api.summary).toHaveBeenCalledWith({ fromDay: "2026-10-12", toDay: "2026-10-12" });
    fireEvent.click(screen.getByRole("button", { name: "track:delete.do" }));
    await waitFor(() =>
      expect(api.deleteDays).toHaveBeenCalledWith({ fromDay: "2026-10-12", toDay: "2026-10-12" })
    );
    await waitFor(() => expect(api.day).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(/track:delete.done.*"count":7/)).toBeInTheDocument();
  });

  it("TRAVTRACK_DISABLED shows its copy, not an empty map", async () => {
    api.day.mockRejectedValue({ response: { status: 403, data: { code: "TRAVTRACK_DISABLED" } } });
    renderAt();
    expect(await screen.findByRole("alert")).toHaveTextContent("track:errors.disabled");
    expect(screen.queryByTestId("track-day-map-stub")).not.toBeInTheDocument();
  });

  it("the Erkundet tab shows the explored map and no day controls (L1)", async () => {
    renderAt("/track/explored");
    expect(await screen.findByTestId("track-explored-stub")).toBeInTheDocument();
    expect(api.day).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "track:actions.delete" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("radio", { name: "track:tabs.day" }));
    expect(await screen.findByTestId("track-day-map-stub")).toBeInTheDocument();
  });

  it("the Tag tab switches to the explored map", async () => {
    renderAt();
    await screen.findByTestId("track-day-map-stub");
    fireEvent.click(screen.getByRole("radio", { name: "track:tabs.explored" }));
    expect(await screen.findByTestId("track-explored-stub")).toBeInTheDocument();
  });

  it("a day without a fix says so", async () => {
    api.day.mockResolvedValue({ ...DAY, segments: [], pointCount: 0, context: [] });
    renderAt();
    expect(await screen.findByTestId("track-day-empty")).toBeInTheDocument();
    expect(screen.getByText("track:timeline.none")).toBeInTheDocument();
  });

  it("leaves for the dashboard when TravTrack is not offered to this account", async () => {
    access.value = "hidden";
    renderAt();
    expect(await screen.findByText("dashboard")).toBeInTheDocument();
    expect(api.day).not.toHaveBeenCalled();
  });
});
