import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts && "source" in opts ? `${key}|${String(opts.source)}` : key,
  }),
}));
const choose = vi.fn();
vi.mock("../../../lib/api/travtrackDaySources", () => ({
  daySourcesApi: { choose: (...args: unknown[]) => choose(...args) },
}));

import TrackDaySources from "../TrackDaySources";
import type { TravTrackDay } from "../../../lib/api/travtrack";
import type { DaySourceSummary } from "../../../lib/api/travtrackDaySources";

const FROM = Date.parse("2026-08-10T00:00:00Z");
const summary = (over: Partial<DaySourceSummary> = {}): DaySourceSummary => ({
  scored: true,
  sources: [
    { source: "companion:phone-1", kind: "phone", score: 0.9, points: 700, accuracyKnownShare: 1 },
    { source: "gpx:takeout", kind: "import", score: 0.5, points: 40, accuracyKnownShare: 0 },
  ],
  segments: [{ fromMs: FROM, untilMs: FROM + 86_400_000, source: "companion:phone-1" }],
  override: null,
  mixed: true,
  bestScore: 0.9,
  outliers: { count: 0, decision: null },
  bridges: [],
  breaks: [],
  clockOffset: null,
  truncated: false,
  questionable: true,
  ...over,
});
const day = (sources: DaySourceSummary, extra: Partial<TravTrackDay> = {}): TravTrackDay => ({
  date: "2026-08-10",
  zone: "UTC",
  segments: [],
  coverage: [],
  context: [],
  pointCount: 0,
  truncated: false,
  sources,
  ...extra,
});

describe("TrackDaySources — which source the day is drawn from", () => {
  beforeEach(() => {
    choose.mockReset();
  });

  it("names the source in use and stores a choice for the whole day", async () => {
    choose.mockResolvedValue(summary());
    const onChanged = vi.fn();
    render(<TrackDaySources day={day(summary())} onChanged={onChanged} />);
    expect(screen.getByTestId("track-day-sources-used").textContent).toContain(
      "track:daySources.used|track:daySources.kind.phone"
    );
    fireEvent.change(screen.getByTestId("track-day-sources-select"), {
      target: { value: "gpx:takeout" },
    });
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(choose).toHaveBeenCalledWith("2026-08-10", { overrideSource: "gpx:takeout" });
  });

  it("says why a choice failed instead of pretending it was stored", async () => {
    choose.mockRejectedValue({ response: { data: { code: "TRAVTRACK_SOURCE_NOT_ON_DAY" } } });
    const onChanged = vi.fn();
    render(<TrackDaySources day={day(summary())} onChanged={onChanged} />);
    fireEvent.change(screen.getByTestId("track-day-sources-select"), {
      target: { value: "gpx:takeout" },
    });
    expect((await screen.findByRole("alert")).textContent).toBe("track:errors.sourceNotOnDay");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("a network failure is a network failure", async () => {
    choose.mockRejectedValue(new Error("offline"));
    render(<TrackDaySources day={day(summary())} onChanged={vi.fn()} />);
    fireEvent.change(screen.getByTestId("track-day-sources-select"), {
      target: { value: "companion:phone-1" },
    });
    expect((await screen.findByRole("alert")).textContent).toBe("track:errors.network");
  });

  it("shows outliers, estimated stretches and a clock offset, and lets outliers be shown again", async () => {
    choose.mockResolvedValue(summary());
    render(
      <TrackDaySources
        day={day(
          summary({
            outliers: { count: 2, decision: null },
            clockOffset: { source: "gpx:takeout", relativeTo: "companion:phone-1", offsetS: 3600 },
          }),
          {
            estimated: [
              { fromMs: FROM, untilMs: FROM + 3_600_000, from: [48, 11], to: [48.1, 11.1] },
            ],
          }
        )}
        onChanged={vi.fn()}
      />
    );
    expect(screen.getByTestId("track-day-outliers")).toBeTruthy();
    expect(screen.getByTestId("track-day-estimated").textContent).toBe(
      "track:daySources.estimated"
    );
    expect(screen.getByTestId("track-day-clock-offset")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "track:daySources.outliersShow" }));
    await waitFor(() =>
      expect(choose).toHaveBeenCalledWith("2026-08-10", { outlierDecision: "keep" })
    );
  });

  it("stays out of the way on a clean single-source day, and says when a day is not rated yet", () => {
    const clean = summary({ sources: [summary().sources[0]], mixed: false, questionable: false });
    const { container, rerender } = render(
      <TrackDaySources day={day(clean)} onChanged={vi.fn()} />
    );
    expect(container.textContent).toBe("");
    rerender(<TrackDaySources day={day(summary({ scored: false }))} onChanged={vi.fn()} />);
    expect(screen.getByText("track:daySources.notScored")).toBeTruthy();
  });
});
