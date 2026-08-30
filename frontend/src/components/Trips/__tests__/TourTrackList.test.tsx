import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

import TourTrackList from "../TourTrackList";
import type { TourTrackMeta } from "../../../types/tour";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

function makeTrack(overrides: Partial<TourTrackMeta> = {}): TourTrackMeta {
  return {
    id: "track-1",
    routeId: "route-1",
    source: "gpx",
    name: "Day 1",
    startedAt: "2026-06-01T08:00:00.000Z",
    endedAt: "2026-06-01T16:00:00.000Z",
    pointCount: 1200,
    distanceKm: 340.4,
    truncated: false,
    createdAt: "2026-06-02T00:00:00.000Z",
    ...overrides,
  };
}

interface RenderOverrides {
  tracks?: TourTrackMeta[];
  loading?: boolean;
  loadError?: boolean;
  onRetry?: () => void;
  uploading?: boolean;
  onUpload?: (file: File) => void;
  onDelete?: (track: TourTrackMeta) => void;
  pulling?: boolean;
  dawarichAvailable?: boolean;
  onPullDawarich?: () => void;
}

function renderList(overrides: RenderOverrides = {}) {
  const props = {
    tracks: [],
    loading: false,
    loadError: false,
    onRetry: vi.fn(),
    uploading: false,
    onUpload: vi.fn(),
    onDelete: vi.fn(),
    pulling: false,
    dawarichAvailable: false,
    onPullDawarich: vi.fn(),
    ...overrides,
  };
  render(<TourTrackList {...props} />);
  return props;
}

describe("TourTrackList", () => {
  it("shows the loading state and nothing else", () => {
    renderList({ loading: true });
    expect(screen.getByText("trips:tours.tracks.loading")).toBeInTheDocument();
    expect(screen.queryByText("trips:tours.tracks.empty")).not.toBeInTheDocument();
    expect(screen.queryByText("trips:tours.tracks.loadError")).not.toBeInTheDocument();
  });

  it("shows the error state with a retry action, distinct from the empty state", () => {
    const props = renderList({ loadError: true, tracks: [] });
    expect(screen.getByText("trips:tours.tracks.loadError")).toBeInTheDocument();
    expect(screen.queryByText("trips:tours.tracks.empty")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("common:buttons.retry"));
    expect(props.onRetry).toHaveBeenCalledTimes(1);
  });

  it("shows the empty state only once loading succeeded with zero tracks", () => {
    renderList({ tracks: [] });
    expect(screen.getByText("trips:tours.tracks.empty")).toBeInTheDocument();
  });

  it("renders each track's window, point count, distance, and source", () => {
    renderList({ tracks: [makeTrack()] });
    expect(screen.getByText("trips:tours.tracks.source.gpx")).toBeInTheDocument();
    expect(screen.getByText("340,4 km")).toBeInTheDocument();
    expect(screen.queryByText("trips:tours.tracks.empty")).not.toBeInTheDocument();
  });

  it("calls onUpload with the chosen file", () => {
    const props = renderList();
    const file = new File(["<gpx/>"], "track.gpx", { type: "application/gpx+xml" });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect(props.onUpload).toHaveBeenCalledWith(file);
  });

  it("disables the upload control while uploading", () => {
    renderList({ uploading: true });
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    expect(input).toBeDisabled();
    expect(screen.getByText("trips:tours.tracks.uploading")).toBeInTheDocument();
  });

  it("calls onDelete with the track when its delete button is clicked", () => {
    const track = makeTrack();
    const props = renderList({ tracks: [track] });
    fireEvent.click(screen.getByText("trips:tours.tracks.deleteLabel"));
    expect(props.onDelete).toHaveBeenCalledWith(track);
  });

  it("disables the Dawarich pull button and shows the reason when no connection is configured", () => {
    const props = renderList({ dawarichAvailable: false });
    const button = screen.getByText("trips:tours.tracks.dawarich.pullLabel");
    expect(button).toBeDisabled();
    expect(screen.getByText("trips:tours.tracks.dawarich.unavailableReason")).toBeInTheDocument();

    fireEvent.click(button);
    expect(props.onPullDawarich).not.toHaveBeenCalled();
  });

  it("enables the Dawarich pull button once a connection is configured, without the reason", () => {
    const props = renderList({ dawarichAvailable: true });
    const button = screen.getByText("trips:tours.tracks.dawarich.pullLabel");
    expect(button).not.toBeDisabled();
    expect(
      screen.queryByText("trips:tours.tracks.dawarich.unavailableReason")
    ).not.toBeInTheDocument();

    fireEvent.click(button);
    expect(props.onPullDawarich).toHaveBeenCalledTimes(1);
  });

  it("shows a busy label and disables the pull button while a pull is in flight", () => {
    renderList({ dawarichAvailable: true, pulling: true });
    const button = screen.getByText("trips:tours.tracks.dawarich.pulling");
    expect(button).toBeDisabled();
  });

  // MEDIUM-2 (final whole-phase review, 2026-08-29): a Dawarich pull cut
  // short by the server's hard page cap must be visibly marked incomplete —
  // its distance is a partial measurement, not the full one it looks like.
  it("shows a truncated badge for a track whose pull was cut short", () => {
    renderList({ tracks: [makeTrack({ truncated: true })] });
    expect(screen.getByText("trips:tours.tracks.truncated")).toBeInTheDocument();
  });

  it("shows no truncated badge for a complete track", () => {
    renderList({ tracks: [makeTrack({ truncated: false })] });
    expect(screen.queryByText("trips:tours.tracks.truncated")).not.toBeInTheDocument();
  });
});
