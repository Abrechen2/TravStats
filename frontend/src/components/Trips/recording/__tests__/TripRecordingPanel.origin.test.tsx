import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { TripRecordingView } from "../../../../lib/api/tripRecording";

vi.mock("../../../../lib/api/tripRecording", () => ({
  tripRecordingApi: { get: vi.fn(), downloadGpx: vi.fn(), remove: vi.fn() },
}));
vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));
vi.mock("../../../../hooks/useCoarsePointer", () => ({ useCoarsePointer: () => false }));

import TripRecordingPanel from "../TripRecordingPanel";

/**
 * The trip recording's origin (TravTrack plan T5): the line is labelled with
 * where it came from, a short or failed Dawarich read says so, another source
 * is offered only when one holds something, and a provider's line has no
 * delete — only the own recording is stored here.
 */

const view = (summary: Partial<TripRecordingView["summary"]>): TripRecordingView => ({
  summary: {
    pointCount: 3,
    jitterDropped: 0,
    firstAt: null,
    lastAt: null,
    devices: [],
    days: [{ date: "2026-05-01", zone: "Asia/Tokyo", precision: "day" }],
    ...summary,
  },
  segments: [],
});

const panel = (v: TripRecordingView, onSourceChange = vi.fn()) =>
  render(
    <TripRecordingPanel
      tripId="trip-1"
      view={v}
      failed={false}
      day={null}
      onDayChange={() => undefined}
      onSourceChange={onSourceChange}
      onDeleted={() => undefined}
    />
  );

describe("TripRecordingPanel — origin", () => {
  it("labels the own recording and keeps its delete", () => {
    panel(view({ origin: "travstats", coverage: "complete", alternatives: [] }));
    expect(screen.getByText("location:trackOrigin.label.travstats")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "trips:recording.delete" })).toBeInTheDocument();
    expect(screen.queryByRole("group")).not.toBeInTheDocument();
  });

  it("labels a Dawarich line, says it is incomplete, and offers no delete", () => {
    panel(view({ origin: "dawarich", coverage: "truncated", alternatives: [] }));
    expect(screen.getByText("location:trackOrigin.label.dawarich")).toBeInTheDocument();
    expect(screen.getByText("location:trackOrigin.coverage.truncated")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "trips:recording.delete" })
    ).not.toBeInTheDocument();
  });

  it("offers another source only when one holds something, and switches to it", () => {
    const onSourceChange = vi.fn();
    panel(
      view({ origin: "travstats", coverage: "complete", alternatives: ["travtrack"] }),
      onSourceChange
    );
    fireEvent.click(screen.getByText("location:trackOrigin.show.travtrack"));
    expect(onSourceChange).toHaveBeenCalledWith("travtrack");
  });

  it("keeps the switch reachable when the default shows nothing but another source holds some", () => {
    panel(
      view({ origin: null, coverage: null, alternatives: ["travtrack"], days: [], pointCount: 0 })
    );
    expect(screen.getByText("location:trackOrigin.show.travtrack")).toBeInTheDocument();
  });

  it("shows nothing at all with no recording and nothing elsewhere", () => {
    const { container } = panel(view({ days: [], pointCount: 0 }));
    expect(container).toBeEmptyDOMElement();
  });
});
