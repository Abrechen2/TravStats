import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

const views = vi.hoisted(() => ({
  flightPanel: vi.fn(),
  photos: vi.fn(),
  photoUrl: vi.fn(() => "/thumb"),
}));
const immich = vi.hoisted(() => ({ getSettings: vi.fn() }));
vi.mock("../../../lib/api/immich", () => ({ immichApi: immich }));
vi.mock("../../../lib/api/travtrackViews", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/api/travtrackViews")>()),
  travTrackViewsApi: views,
}));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
    i18n: { language: "de" },
  }),
}));

import TrackFlightPanel from "../flight/TrackFlightPanel";

/**
 * The flight panel (plan T5.3): figures that cannot be derived read "—",
 * never 0; the profile breaks at every cut and carries the replay's cursor
 * and a pin per photo; an Immich failure reads as its own kind.
 */

const T = Date.parse("2026-10-12T00:30:00Z");
const MIN = 60_000;
const FLIGHT = { id: "f1", label: "KE1201", href: "/flights/f1" };

const show = (cursor: number | null = null) =>
  render(
    <MemoryRouter>
      <TrackFlightPanel flight={FLIGHT} zone="UTC" cursor={cursor} onClose={() => undefined} />
    </MemoryRouter>
  );

describe("TrackFlightPanel", () => {
  beforeEach(() => {
    immich.getSettings.mockReset().mockResolvedValue({ hasAccess: true });
    Object.values(views).forEach((fn) => fn.mockReset());
    views.photoUrl.mockReturnValue("/thumb");
  });

  it("shows the figures, the profile with cursor and pins, and the photos", async () => {
    views.flightPanel.mockResolvedValue({
      flightId: "f1",
      series: [
        [
          [T, 100, 70],
          [T + 10 * MIN, 10_000, 240],
        ],
        [
          [T + 30 * MIN, 10_000, 250],
          [T + 40 * MIN, 9000, 240],
        ],
      ],
      pointCount: 4,
      truncated: false,
      summary: { maxAltitudeM: 10_000, maxSpeedMps: 250, climbToCruiseMinutes: 9 },
    });
    views.photos.mockResolvedValue({
      photos: [
        {
          assetId: "a",
          type: "IMAGE",
          takenAt: new Date(T + 5 * MIN).toISOString(),
          lat: 1,
          lon: 1,
        },
      ],
      truncated: false,
    });
    show(T + 5 * MIN);
    const figures = await screen.findByTestId("track-flight-figures");
    expect(within(figures).getByText(/track:flight.altitudeValue.*"fl":328/)).toBeInTheDocument();
    expect(figures.querySelector('[data-figure="speed"]')).toHaveTextContent('"kmh":"900"');
    expect(await screen.findAllByTestId("track-altitude-pin")).toHaveLength(1);
    expect(screen.getByTestId("track-altitude-cursor")).toBeInTheDocument();
    expect(screen.getAllByTestId("track-altitude-line")).toHaveLength(2);
    expect(within(screen.getByTestId("track-flight-photos")).getAllByRole("img")).toHaveLength(1);
    expect(views.photos).toHaveBeenCalledWith({
      from: new Date(T).toISOString(),
      to: new Date(T + 40 * MIN + 1).toISOString(),
    });
    expect(screen.getByRole("link", { name: "track:flight.open" })).toHaveAttribute(
      "href",
      "/flights/f1"
    );
  });

  it("nothing derivable reads —, never 0; no recording asks for no photos", async () => {
    views.flightPanel.mockResolvedValue({
      flightId: "f1",
      series: [],
      pointCount: 0,
      truncated: false,
      summary: { maxAltitudeM: null, maxSpeedMps: null, climbToCruiseMinutes: null },
    });
    show();
    const figures = await screen.findByTestId("track-flight-figures");
    for (const key of ["altitude", "speed", "climb", "photos"]) {
      expect(figures.querySelector(`[data-figure="${key}"] dd`)).toHaveTextContent("—");
    }
    expect(screen.getByTestId("track-flight-empty")).toBeInTheDocument();
    expect(views.photos).not.toHaveBeenCalled();
  });

  it("an Immich failure reads as its kind; a refused panel reads as itself", async () => {
    views.flightPanel.mockResolvedValue({
      flightId: "f1",
      series: [
        [
          [T, 100, 70],
          [T + MIN, 900, 100],
        ],
      ],
      pointCount: 2,
      truncated: true,
      summary: { maxAltitudeM: 900, maxSpeedMps: 100, climbToCruiseMinutes: null },
    });
    views.photos.mockRejectedValue({ response: { status: 502, data: { error: "auth" } } });
    const { unmount } = show();
    expect(await screen.findByText(/track:photos.failure.auth/)).toBeInTheDocument();
    expect(screen.getByText("track:flight.truncated")).toBeInTheDocument();
    unmount();

    views.flightPanel.mockRejectedValue({
      response: { status: 404, data: { code: "TRAVTRACK_FLIGHT_NOT_FOUND" } },
    });
    show();
    expect(await screen.findByRole("alert")).toHaveTextContent("track:flight.notFound");
  });

  it("a series from the flight's time window (nothing linked) says so; a linked one does not", async () => {
    const answer = (basis: "linked" | "window") => ({
      flightId: "f1",
      basis,
      series: [
        [
          [T, 100, 70],
          [T + MIN, 900, 100],
        ],
      ],
      pointCount: 2,
      truncated: false,
      summary: { maxAltitudeM: 900, maxSpeedMps: 100, climbToCruiseMinutes: null },
    });
    views.photos.mockResolvedValue({ photos: [], truncated: false, trackTruncated: false });
    views.flightPanel.mockResolvedValue(answer("window"));
    const { unmount } = show();
    expect(await screen.findByTestId("track-flight-window-basis")).toHaveTextContent(
      "track:flight.windowBasis"
    );
    unmount();

    views.flightPanel.mockResolvedValue(answer("linked"));
    show();
    await screen.findByTestId("track-flight-figures");
    expect(screen.queryByTestId("track-flight-window-basis")).toBeNull();
  });

  it("a deletion on the map (a new generation) reads the panel and its photos again", async () => {
    views.flightPanel.mockResolvedValue({
      flightId: "f1",
      series: [
        [
          [T, 100, 70],
          [T + MIN, 900, 100],
        ],
      ],
      pointCount: 2,
      truncated: false,
      summary: { maxAltitudeM: 900, maxSpeedMps: 100, climbToCruiseMinutes: null },
    });
    views.photos.mockResolvedValue({ photos: [], truncated: false });
    const panel = (generation: number) => (
      <MemoryRouter>
        <TrackFlightPanel
          flight={FLIGHT}
          zone="UTC"
          cursor={null}
          generation={generation}
          onClose={() => undefined}
        />
      </MemoryRouter>
    );
    const { rerender } = render(panel(0));
    await waitFor(() => expect(views.photos).toHaveBeenCalledTimes(1));
    rerender(panel(1));
    await waitFor(() => expect(views.flightPanel).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(views.photos).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("track:flight.noPhotos")).toBeInTheDocument();
  });
});
