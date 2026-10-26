import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { FlightSample } from "../../../../lib/api/travtrackViews";

vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
    i18n: { language: "de" },
  }),
}));

import TrackAltitudeProfile from "../TrackAltitudeProfile";

// jsdom has no PointerEvent: without one the event would carry no clientX.
if (typeof window.PointerEvent === "undefined") {
  (window as unknown as { PointerEvent: typeof MouseEvent }).PointerEvent = MouseEvent;
}

/**
 * The better graph (owner 2026-10-26): axes in metres and km/h, clock times
 * in the departure zone with the local midnight marked, a hatched band where
 * the recording breaks, take-off and landing, and a readout the pointer and
 * the arrow keys both drive.
 */

const MIN = 60_000;
const T = Date.parse("2026-10-03T21:00:00Z"); // 23:00 in Berlin

const series: FlightSample[][] = [
  [
    [T, 450, 5],
    [T + 10 * MIN, 460, 75],
    [T + 30 * MIN, 9000, 230],
    [T + 60 * MIN, 11000, 250],
  ],
  [
    [T + 180 * MIN, 11500, 255],
    [T + 240 * MIN, 400, 70],
    [T + 245 * MIN, 30, 10],
  ],
];

const show = () =>
  render(
    <TrackAltitudeProfile
      series={series}
      zone="Europe/Berlin"
      takeoffMs={T + 10 * MIN}
      landingMs={T + 240 * MIN}
      cursor={null}
      photos={[]}
      onPhoto={() => undefined}
    />
  );

describe("TrackAltitudeProfile", () => {
  it("draws both axes, the clock in the departure zone and the local midnight", () => {
    show();
    expect(screen.getAllByTestId("track-altitude-tick").length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText("km/h")).toBeInTheDocument();
    expect(screen.getAllByTestId("track-altitude-midnight")).toHaveLength(1);
    expect(screen.getAllByTestId("track-altitude-time").length).toBeGreaterThan(1);
    expect(screen.getByText("FL377")).toBeInTheDocument();
  });

  it("marks the break as no recording and never draws a line across it", () => {
    show();
    expect(screen.getAllByTestId("track-altitude-gap")).toHaveLength(1);
    expect(screen.getByText("track:flight.noRecordingBand")).toBeInTheDocument();
    expect(screen.getAllByTestId("track-altitude-line")).toHaveLength(2);
    expect(screen.getAllByTestId("track-speed-line")).toHaveLength(2);
  });

  it("shows take-off and landing", () => {
    show();
    expect(screen.getAllByTestId("track-altitude-mark")).toHaveLength(2);
    expect(screen.getByText("track:flight.takeoff")).toBeInTheDocument();
    expect(screen.getByText("track:flight.landing")).toBeInTheDocument();
  });

  it("the arrow keys step the readout through the samples, starting at the take-off", () => {
    show();
    const chart = screen.getByRole("group");
    expect(chart).toHaveAttribute("aria-label", expect.stringContaining("profileSummary"));
    fireEvent.focus(chart);
    expect(screen.getByTestId("track-altitude-readout")).toHaveTextContent('"m":"460"');
    fireEvent.keyDown(chart, { key: "ArrowRight" });
    expect(screen.getByTestId("track-altitude-readout")).toHaveTextContent('"m":"9.000"');
    fireEvent.keyDown(chart, { key: "End" });
    expect(screen.getByTestId("track-altitude-readout")).toHaveTextContent('"m":"30"');
    expect(screen.getByTestId("track-altitude-crosshair")).toBeInTheDocument();
  });

  it("the pointer moves the crosshair; leaving clears it", () => {
    const { container } = show();
    const overlay = container.querySelector('rect[fill="transparent"]') as SVGRectElement;
    overlay.getBoundingClientRect = () =>
      ({ left: 0, width: 100, top: 0, height: 50, right: 100, bottom: 50 }) as DOMRect;
    fireEvent.pointerMove(overlay, { clientX: 100 });
    expect(screen.getByTestId("track-altitude-readout")).toHaveTextContent('"kmh":"36"');
    fireEvent.pointerLeave(overlay);
    expect(screen.getByTestId("track-altitude-readout")).toHaveTextContent(
      "track:flight.profileHint"
    );
  });
});
