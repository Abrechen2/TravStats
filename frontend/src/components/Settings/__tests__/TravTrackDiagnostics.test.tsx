import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const api = vi.hoisted(() => ({ day: vi.fn(), exportBlob: vi.fn(), deleteAll: vi.fn() }));
vi.mock("../../../lib/api/travtrackDiagnostics", () => ({ travTrackDiagnosticsApi: api }));

import TravTrackDiagnostics, { hourBars } from "../TravTrackDiagnostics";
import type { DiagnosticsDay } from "../../../lib/api/travtrackDiagnostics";

/**
 * The diagnostics view (spec 2026-10-29-travtrack-diagnostics): each gap with
 * the cause the server read from the log and its evidence, a day without a
 * log says how to switch it on, and a failed read says so instead of an
 * empty, reassuring day.
 */

const day = (over: Partial<DiagnosticsDay> = {}): DiagnosticsDay => ({
  date: "2026-10-28",
  zone: "UTC",
  from: "2026-10-28T00:00:00.000Z",
  until: "2026-10-29T00:00:00.000Z",
  deviceId: "phone-1",
  devices: [],
  hasLog: true,
  pointsPerMinute: [{ t: "2026-10-28T06:10:00.000Z", n: 3 }],
  fixesPerMinute: [{ t: "2026-10-28T06:10:00.000Z", received: 5, kept: 3, dropped: {} }],
  events: [],
  eventsTruncated: false,
  carried: {},
  gaps: [],
  ...over,
});

describe("TravTrackDiagnostics", () => {
  beforeEach(() => vi.clearAllMocks());

  it("names each gap's cause and evidence", async () => {
    api.day.mockResolvedValue(
      day({
        gaps: [
          {
            from: "2026-10-28T13:52:00.000Z",
            to: "2026-10-28T14:52:00.000Z",
            minutes: 60,
            cause: "droppedOnPhone",
            evidence: {
              fixesReceived: 50,
              fixesKept: 0,
              dropped: { accuracy: 50 },
              uploads: [],
              permission: "always",
              recorder: null,
              lifecycle: null,
              reportedReason: null,
            },
          },
        ],
      })
    );
    render(<TravTrackDiagnostics today="2026-10-29" canDelete />);
    expect(
      await screen.findByText("track:settings.diagnostics.cause.droppedOnPhone")
    ).toBeInTheDocument();
    expect(screen.getByTestId("travtrack-diag-gaps")).toHaveTextContent(
      "track:settings.diagnostics.evidence.dropped"
    );
    expect(api.day).toHaveBeenCalledWith("2026-10-29", undefined);
  });

  it("says how to switch the log on when the phone sent none", async () => {
    api.day.mockResolvedValue(day({ hasLog: false, fixesPerMinute: [] }));
    render(<TravTrackDiagnostics today="2026-10-29" canDelete />);
    expect(await screen.findByTestId("travtrack-diag-nolog")).toHaveTextContent(
      "track:settings.diagnostics.noLog"
    );
  });

  it("a failed read says so", async () => {
    api.day.mockRejectedValue(new Error("network"));
    render(<TravTrackDiagnostics today="2026-10-29" canDelete />);
    expect(await screen.findByRole("alert")).toHaveTextContent("track:errors.network");
  });

  it("buckets points and fixes into the hours of the day", () => {
    const bars = hourBars(day());
    expect(bars).toHaveLength(24);
    expect(bars[6]).toEqual({ points: 3, fixes: 5 });
  });
});
