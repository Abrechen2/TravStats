import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Layer } from "@deck.gl/core";
import type { TripRecordingView } from "../../../lib/api/tripRecording";

// The map is a WebGL canvas; the stand-in lists the extra layers it is handed
// and how many lines each draws — enough to see a gap as two lines.
vi.mock("../TripMap", () => ({
  default: ({
    extraLayers = [],
    extraPoints = [],
  }: {
    extraLayers?: readonly Layer[];
    extraPoints?: readonly unknown[];
  }) => (
    <ul data-testid="map" data-extra-points={extraPoints.length}>
      {extraLayers.map((layer) => (
        <li key={layer.id} data-testid={layer.id}>
          {(layer.props.data as unknown[]).length}
        </li>
      ))}
    </ul>
  ),
}));
vi.mock("../../../lib/api/tours", () => ({
  toursApi: { list: vi.fn(async () => []), tracks: { list: vi.fn(), get: vi.fn() } },
}));
vi.mock("../../../lib/api/tourIndex", () => ({ tourIndexApi: { geometryBatch: vi.fn() } }));
vi.mock("../../../hooks/useToursVisible", () => ({ useToursVisible: vi.fn(() => false) }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o ? `${k} ${JSON.stringify(o)}` : k),
    i18n: { language: "de" },
  }),
}));
vi.mock("../../../lib/api/tripRecording", () => ({
  tripRecordingApi: { get: vi.fn(), downloadGpx: vi.fn(), remove: vi.fn() },
}));

import TripMapWithTours from "../TripMapWithTours";
import { tripRecordingApi } from "../../../lib/api/tripRecording";

const trip = { id: "trip-1", flights: [], cruises: [], lodgingStays: [], stops: [] } as never;

const time = (utc: string, local: string) => ({
  utc,
  local,
  zone: "Asia/Tokyo",
  offset: "+09:00",
  precision: "minute" as const,
  zoneSource: "stored" as const,
});

const EMPTY: TripRecordingView = {
  summary: { pointCount: 0, jitterDropped: 0, firstAt: null, lastAt: null, devices: [], days: [] },
  segments: [],
};

/** Two stretches with a gap between them, and a lone fix: three pieces, never one line. */
const RECORDED: TripRecordingView = {
  summary: {
    pointCount: 6,
    jitterDropped: 2,
    firstAt: time("2026-04-30T15:30:00.000Z", "2026-05-01T00:30:00"),
    lastAt: time("2026-05-02T06:05:00.000Z", "2026-05-02T15:05:00"),
    devices: ["phone-1"],
    days: [
      { date: "2026-05-01", zone: "Asia/Tokyo", precision: "day" },
      { date: "2026-05-02", zone: "Asia/Tokyo", precision: "day" },
    ],
  },
  segments: [
    [
      [139.7, 35.68],
      [139.72, 35.68],
    ],
    [
      [140.4, 35.68],
      [140.41, 35.68],
    ],
    [[135.5, 34.7]],
  ],
};

describe("TripMapWithTours — the trip recording (forgejo#316)", () => {
  beforeEach(() => {
    vi.mocked(tripRecordingApi.get).mockReset();
    vi.mocked(tripRecordingApi.remove).mockReset().mockResolvedValue();
  });

  it("draws nothing and shows no widget when nothing was recorded", async () => {
    vi.mocked(tripRecordingApi.get).mockResolvedValue(EMPTY);
    render(<TripMapWithTours trip={trip} />);
    await waitFor(() => expect(tripRecordingApi.get).toHaveBeenCalledWith("trip-1", null, null));
    expect(screen.queryByTestId("trip-recording-panel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("trip-recording-lines")).not.toBeInTheDocument();
  });

  it("draws every stretch as its own line, a lone fix as a dot, and frames them", async () => {
    vi.mocked(tripRecordingApi.get).mockResolvedValue(RECORDED);
    render(<TripMapWithTours trip={trip} />);
    expect(await screen.findByTestId("trip-recording-lines")).toHaveTextContent("2");
    expect(screen.getByTestId("trip-recording-dots")).toHaveTextContent("1");
    expect(screen.getByTestId("map").getAttribute("data-extra-points")).toBe("5");
    const summary = screen.getByTestId("trip-recording-summary").textContent ?? "";
    expect(summary).toContain('trips:recording.points {"count":6}');
    expect(summary).toContain('trips:recording.devices {"count":1}');
    // The line leaves the jitter out and says so (forgejo#319).
    expect(screen.getByTestId("track-jitter-note").textContent).toContain(
      "common:trackJitter.droppedLine"
    );
    // The first point on the trip's clock: 1 May, 00:30 in Tokyo — not 30 April.
    expect(summary).toMatch(/01\.05\.2026.*00:30/);
  });

  it("asks for one day on the trip's clock when a day is chosen, and for all again", async () => {
    vi.mocked(tripRecordingApi.get).mockResolvedValue(RECORDED);
    render(<TripMapWithTours trip={trip} />);
    const select = await screen.findByRole("combobox", { name: "trips:recording.dayFilter" });
    await userEvent.selectOptions(select, "2026-05-02");
    await waitFor(() =>
      expect(tripRecordingApi.get).toHaveBeenLastCalledWith("trip-1", "2026-05-02", null)
    );
    await userEvent.selectOptions(select, "");
    await waitFor(() =>
      expect(tripRecordingApi.get).toHaveBeenLastCalledWith("trip-1", null, null)
    );
  });

  it("deletes only after the confirmation, then re-reads and shows nothing", async () => {
    vi.mocked(tripRecordingApi.get).mockResolvedValueOnce(RECORDED).mockResolvedValue(EMPTY);
    render(<TripMapWithTours trip={trip} />);
    await userEvent.click(await screen.findByRole("button", { name: "trips:recording.delete" }));
    expect(tripRecordingApi.remove).not.toHaveBeenCalled();
    const dialog = await screen.findByTestId("confirm-modal");
    await userEvent.click(within(dialog).getByRole("button", { name: "trips:recording.delete" }));
    await waitFor(() => expect(tripRecordingApi.remove).toHaveBeenCalledWith("trip-1"));
    await waitFor(() =>
      expect(screen.queryByTestId("trip-recording-panel")).not.toBeInTheDocument()
    );
    expect(tripRecordingApi.get).toHaveBeenCalledTimes(2);
  });

  it("keeps the recording and says so when the delete fails", async () => {
    vi.mocked(tripRecordingApi.get).mockResolvedValue(RECORDED);
    vi.mocked(tripRecordingApi.remove).mockRejectedValue(new Error("offline"));
    render(<TripMapWithTours trip={trip} />);
    await userEvent.click(await screen.findByRole("button", { name: "trips:recording.delete" }));
    const dialog = await screen.findByTestId("confirm-modal");
    await userEvent.click(within(dialog).getByRole("button", { name: "trips:recording.delete" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("trips:recording.deleteError");
    expect(screen.getByTestId("trip-recording-lines")).toBeInTheDocument();
  });

  it("says the recording could not be loaded instead of looking unrecorded", async () => {
    vi.mocked(tripRecordingApi.get).mockRejectedValue(new Error("offline"));
    render(<TripMapWithTours trip={trip} />);
    expect(await screen.findByText("trips:recording.loadError")).toBeInTheDocument();
  });
});
