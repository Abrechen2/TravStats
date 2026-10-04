/**
 * The flight page's recording section (forgejo#193): silent without a
 * recording, the map and what it measured with one, and a failed load said
 * as such — never passed off as "no recording".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import type { FlightTrack } from "../../../types/flightTrack";

const getTrackMock = vi.fn();
vi.mock("../../../lib/api", () => ({
  flightsApi: { getTrack: (...args: unknown[]) => getTrackMock(...args) },
}));
// The global mock returns bare keys; this one shows what was interpolated, so
// the numbers the caption is built from can be asserted.
vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
    i18n: { language: "en" },
  }),
}));
// WebGL is not there in jsdom; the map has its own pure helpers under test.
vi.mock("../FlightTrackMap", () => ({
  FlightTrackMap: () => <div data-testid="flight-track-map-stub" />,
}));

import FlightTrackSection from "../FlightTrackSection";

const at = (utc: string, zone: string) => ({
  utc,
  zone,
  offset: "+00:00",
  local: utc.slice(0, 19),
  precision: "minute" as const,
  zoneSource: "catalogue" as const,
});

function makeTrack(over: Partial<FlightTrack> = {}): FlightTrack {
  return {
    id: "t1",
    flightId: "f1",
    source: "companion",
    uploadId: "rec-1",
    deviceId: "phone-1",
    times: {
      startedAt: at("2026-10-03T08:00:00Z", "Europe/Berlin"),
      endedAt: at("2026-10-03T19:00:00Z", "Asia/Seoul"),
    },
    pointCount: 12345,
    distanceKm: 8567.4,
    geometry: [
      [11.78, 48.35],
      [126.45, 37.46],
    ],
    segmentStarts: [0],
    elevations: null,
    createdAt: "2026-10-04T05:00:00Z",
    updatedAt: "2026-10-04T05:00:00Z",
    ...over,
  };
}

describe("FlightTrackSection", () => {
  // A block, not an arrow returning the mock: vitest runs a function returned
  // from beforeEach as the test's teardown, which would call the mock again.
  beforeEach(() => {
    getTrackMock.mockReset();
  });

  it("draws nothing for a flight without a recording", async () => {
    getTrackMock.mockResolvedValue(null);
    const { container } = render(<FlightTrackSection flightId="f1" />);
    await waitFor(() => expect(getTrackMock).toHaveBeenCalledWith("f1"));
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the map and what the phone measured", async () => {
    getTrackMock.mockResolvedValue(makeTrack());
    render(<FlightTrackSection flightId="f1" />);
    expect(await screen.findByTestId("flight-track-map-stub")).toBeInTheDocument();
    const caption = screen.getByTestId("flight-track-caption").textContent ?? "";
    expect(caption).toContain("flights:track.caption");
    expect(caption).toContain('"points":"12,345"');
    expect(caption).toMatch(/"distance":"8,567 /);
    // An unbroken recording claims no gaps.
    expect(caption).not.toContain("flights:track.gaps");
  });

  it("says how many stretches without a fix are left out", async () => {
    getTrackMock.mockResolvedValue(makeTrack({ segmentStarts: [0, 4, 9] }));
    render(<FlightTrackSection flightId="f1" />);
    const caption = await screen.findByTestId("flight-track-caption");
    expect(caption.textContent).toContain('flights:track.gaps {"count":2}');
  });

  it("says the recording could not be loaded instead of hiding the failure", async () => {
    getTrackMock.mockImplementation(async () => {
      throw new Error("503 from the server");
    });
    render(<FlightTrackSection flightId="f1" />);
    expect(await screen.findByText("flights:track.loadError")).toBeInTheDocument();
    expect(screen.queryByTestId("flight-track-map-stub")).not.toBeInTheDocument();
  });
});
