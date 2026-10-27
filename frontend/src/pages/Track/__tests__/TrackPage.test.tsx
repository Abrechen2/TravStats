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
  lastSeen: vi.fn(),
}));
vi.mock("../../../lib/api/travtrack", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/travtrack")>()),
  travTrackApi: api,
}));
const access = vi.hoisted(() => ({ value: "visible" as "visible" | "hidden" | "pending" }));
const capsState = vi.hoisted(() => ({
  value: { version: 1, offered: true, enabled: true, active: true, hasData: true },
}));
const tokens = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("../../../lib/api/tokens", () => ({ apiTokensApi: tokens }));
vi.mock("../../../hooks/useTravTrackVisible", () => ({
  useTravTrackAccess: () => access.value,
  useTravTrackState: () => ({
    access: access.value,
    caps: access.value === "visible" ? capsState.value : null,
  }),
  useTravTrackVisible: () => access.value === "visible",
}));
vi.mock("../../../hooks/useTodayZone", () => ({ useTodayZone: () => "Asia/Seoul" }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
    i18n: { language: "de" },
  }),
}));
// WebGL is not there in jsdom: the map stub says what it was given.
vi.mock("../map/TrackRangeMap", () => ({
  default: ({ lines }: { lines: unknown[] }) => (
    <div data-testid="track-day-map-stub">{lines.length} segments</div>
  ),
}));

vi.mock("../TrackExploredMap", () => ({
  default: () => <div data-testid="track-explored-stub" />,
}));

vi.mock("../TrackMonths", () => ({
  default: () => <div data-testid="track-months-stub" />,
}));
vi.mock("../TrackStays", () => ({
  default: () => <div data-testid="track-stays-stub" />,
}));
vi.mock("../TrackImports", () => ({
  default: () => <div data-testid="track-imports-stub" />,
}));

// The app header polls the inbox; its own tests cover it. Here it only has to be there.
vi.mock("../../../components/NavigationBar", () => ({
  default: () => <nav data-testid="main-bar-stub" />,
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
      href: "/flights/f1",
      anchor: { lat: 37.469, lon: 126.451 },
      unlabelled: false,
      fromMs: D0 + 90 * MIN,
      untilMs: D0 + 150 * MIN,
    },
    {
      kind: "trip",
      id: "t1",
      label: "Seoul",
      href: "/trips/t1",
      anchor: null,
      unlabelled: false,
      fromMs: D0,
      untilMs: D0 + 24 * 60 * MIN,
    },
  ],
  pointCount: 4,
  truncated: false,
};

const renderAt = (path = "/track/2026-10-12") =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/track/explored" element={<TrackPage view="explored" />} />
        <Route path="/track/months" element={<TrackPage view="months" />} />
        <Route path="/track/stays" element={<TrackPage view="stays" />} />
        <Route path="/track/imports" element={<TrackPage view="imports" />} />
        <Route path="/track/:date" element={<TrackPage />} />
        <Route path="/track" element={<TrackPage />} />
        <Route path="/dashboard" element={<p>dashboard</p>} />
      </Routes>
    </MemoryRouter>
  );

describe("TrackPage", () => {
  beforeEach(() => {
    access.value = "visible";
    capsState.value = { version: 1, offered: true, enabled: true, active: true, hasData: true };
    tokens.list.mockReset();
    tokens.list.mockResolvedValue([]);
    Object.values(api).forEach((fn) => fn.mockReset());
    api.day.mockResolvedValue(DAY);
    api.zones.mockResolvedValue([]);
    api.lastSeen.mockResolvedValue(null);
  });

  it("switched on with no data yet: the page shows how data comes in, not an empty map (owner 2026-10-26)", async () => {
    capsState.value = { version: 1, offered: true, enabled: true, active: false, hasData: false };
    renderAt("/track");
    const start = await screen.findByTestId("track-getting-started");
    expect(screen.queryByTestId("track-day-map-stub")).toBeNull();
    expect(
      within(start).getByRole("link", { name: "track:start.companion.action" })
    ).toHaveAttribute("href", "/settings/location?section=locationProvider");
    expect(
      within(start).getByRole("link", { name: "track:start.dawarich.action" })
    ).toHaveAttribute("href", "/track/imports");
    expect(within(start).getByRole("link", { name: "track:start.gpx.action" })).toBeInTheDocument();
    // No paired Companion: one line says how to pair it.
    expect(await screen.findByTestId("track-start-pairing")).toBeInTheDocument();
  });

  it("already recording into TravTrack, the first step is a note; a paired device needs no pairing line", async () => {
    capsState.value = { version: 1, offered: true, enabled: true, active: true, hasData: false };
    tokens.list.mockResolvedValue([{ id: "t", deviceId: "phone", revokedAt: null }]);
    renderAt("/track");
    const start = await screen.findByTestId("track-getting-started");
    expect(within(start).getByText("track:start.companion.done")).toBeInTheDocument();
    expect(within(start).queryByRole("link", { name: "track:start.companion.action" })).toBeNull();
    await waitFor(() => expect(tokens.list).toHaveBeenCalled());
    expect(screen.queryByTestId("track-start-pairing")).toBeNull();
  });

  it("the imports tab stays reachable for an account with no data", async () => {
    capsState.value = { version: 1, offered: true, enabled: true, active: false, hasData: false };
    renderAt("/track/imports");
    expect(await screen.findByTestId("track-imports-stub")).toBeInTheDocument();
  });

  it("the header says where the history last placed the account", async () => {
    api.lastSeen.mockResolvedValue({
      at: "2026-10-12T05:00:00.000Z",
      lat: 37.5,
      lon: 127,
      accuracyM: 5,
      deviceId: "phone-1",
      deviceLabel: "Pixel 9",
      origin: "companion:phone-1",
    });
    renderAt();
    const line = await screen.findByTestId("track-last-seen");
    expect(line.textContent).toContain("track:lastSeen.line");
    expect(line.textContent).toContain("Pixel 9");
    expect(line.textContent).not.toContain("37.5");
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

  // Phase 5 (header variant B): the main bar carries Track's menu, so every
  // view renders it and none draws a tab strip of its own.
  it.each([
    "/track/2026-10-12",
    "/track/explored",
    "/track/months",
    "/track/stays",
    "/track/imports",
  ])("%s renders the main bar and no tab strip of its own", async (path) => {
    renderAt(path);
    expect(await screen.findByTestId("main-bar-stub")).toBeInTheDocument();
    // The old view tabs were a radio group; the map's own controls (route
    // colour) are radio groups too, so the tab strip is looked up by its name.
    expect(screen.queryByRole("radiogroup", { name: "track:tabs.label" })).not.toBeInTheDocument();
    expect(screen.queryByRole("radio", { name: "track:tabs.day" })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("track:title");
  });

  it("the Erkundet view shows the explored map and no day controls (L1)", async () => {
    renderAt("/track/explored");
    expect(await screen.findByTestId("track-explored-stub")).toBeInTheDocument();
    expect(api.day).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "track:actions.delete" })).not.toBeInTheDocument();
  });

  it("the Monate view shows the monthly values and no day controls (L3)", async () => {
    renderAt("/track/months");
    expect(await screen.findByTestId("track-months-stub")).toBeInTheDocument();
    expect(api.day).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "track:actions.delete" })).not.toBeInTheDocument();
  });

  it.each([
    ["/track/stays", "track-stays-stub"],
    ["/track/imports", "track-imports-stub"],
  ])("%s shows its view and no day controls", async (path, testId) => {
    renderAt(path);
    expect(await screen.findByTestId(testId)).toBeInTheDocument();
    expect(api.day).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "track:actions.delete" })).not.toBeInTheDocument();
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
    expect(screen.queryByTestId("main-bar-stub")).not.toBeInTheDocument();
    expect(api.day).not.toHaveBeenCalled();
  });
});
