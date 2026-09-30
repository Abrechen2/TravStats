import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";

import TourRecordingSummary from "../TourRecordingSummary";
import { toursApi } from "../../../lib/api/tours";
import type { TourTrack, TourTrackMeta } from "../../../types/tour";

vi.mock("../../../lib/api/tours", () => ({ toursApi: { tracks: { get: vi.fn() } } }));
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

function meta(id: string, day: number, distanceKm: number): TourTrackMeta {
  return {
    id,
    routeId: "mosel",
    source: "gpx",
    name: null,
    startedAt: `2026-07-1${day}T08:00:00Z`,
    endedAt: `2026-07-1${day}T15:00:00Z`,
    pointCount: 900,
    distanceKm,
    truncated: false,
    ascentM: 150,
    descentM: 160,
    movingSeconds: 4 * 3600,
    externalRef: null,
    createdAt: "2026-07-20T13:00:00Z",
  };
}

const day1 = meta("day-1", 1, 61.7);
const day2 = meta("day-2", 2, 138.9);

describe("TourRecordingSummary — the profile", () => {
  beforeEach(() => {
    vi.mocked(toursApi.tracks.get).mockReset();
  });

  // Acceptance 2026-09-26: "200,6 km" above a profile whose axis ended at
  // "61,7 km" — the first of four recordings.
  it("runs over every recording, so its axis ends where the distance does", async () => {
    vi.mocked(toursApi.tracks.get).mockImplementation(async (_trip, _route, id) => {
      const profile: Array<[number, number]> =
        id === "day-1"
          ? [
              [0, 130],
              [61.7, 110],
            ]
          : [
              [0, 110],
              [138.9, 65],
            ];
      return { id, elevationProfile: profile } as unknown as TourTrack;
    });
    // Passed out of order: the profile follows the days, not the list.
    render(
      <TourRecordingSummary tracks={[day2, day1]} tripId="t1" routeId="mosel" accent="#fff" />
    );
    expect(
      await screen.findByText("200,6 km", { selector: "figcaption span" })
    ).toBeInTheDocument();
    expect(screen.getByText("65 m")).toBeInTheDocument();
    expect(screen.getByText("130 m")).toBeInTheDocument();
  });

  it("draws no profile when one recording carries none, rather than a part as the whole", async () => {
    vi.mocked(toursApi.tracks.get).mockImplementation(
      async (_trip, _route, id) =>
        ({
          id,
          elevationProfile:
            id === "day-1"
              ? [
                  [0, 130],
                  [61.7, 110],
                ]
              : null,
        }) as unknown as TourTrack
    );
    render(
      <TourRecordingSummary tracks={[day1, day2]} tripId="t1" routeId="mosel" accent="#fff" />
    );
    await waitFor(() => expect(toursApi.tracks.get).toHaveBeenCalledTimes(2));
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("↑ 300 m")).toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });
});
