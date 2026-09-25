import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import TourRecordingSummary from "../TourRecordingSummary";
import type { TourTrackMeta } from "../../../types/tour";

vi.mock("../../../lib/api/tours", () => ({
  toursApi: { tracks: { get: vi.fn(() => new Promise(() => {})) } },
}));
vi.mock("../ElevationProfileChart", () => ({ default: () => null }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

function track(id: string, over: Partial<TourTrackMeta>): TourTrackMeta {
  return {
    id,
    routeId: "r1",
    source: "gpx",
    name: null,
    startedAt: "2026-07-16T08:00:00Z",
    endedAt: "2026-07-16T12:00:00Z",
    pointCount: 900,
    distanceKm: 8,
    truncated: false,
    ascentM: 500,
    descentM: 500,
    movingSeconds: 3 * 3600,
    externalRef: null,
    createdAt: "2026-07-16T13:00:00Z",
    ...over,
  };
}

function render2(tracks: TourTrackMeta[]): void {
  render(<TourRecordingSummary tracks={tracks} tripId={undefined} routeId="r1" accent="#fff" />);
}

describe("TourRecordingSummary", () => {
  it("sums a figure over the recordings when every one of them carries it", () => {
    render2([track("a", {}), track("b", { ascentM: 250 })]);
    expect(screen.getByText("↑ 750 m")).toBeInTheDocument();
    expect(screen.getByText("roadtrips:recording.moving")).toBeInTheDocument();
  });

  it("leaves a figure out when one recording lacks it, rather than showing a part as the whole", () => {
    // Two recordings of one hike, the second from a watch without a
    // barometer: 500 m is what the first measured, not what the day climbed.
    render2([track("a", {}), track("b", { ascentM: null, descentM: null, movingSeconds: null })]);
    expect(screen.queryByText("roadtrips:recording.ascent")).not.toBeInTheDocument();
    expect(screen.queryByText("roadtrips:recording.descent")).not.toBeInTheDocument();
    expect(screen.queryByText("roadtrips:recording.moving")).not.toBeInTheDocument();
    // Distance comes from the points themselves, which every recording has.
    expect(screen.getByText("16 km")).toBeInTheDocument();
  });
});
