import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
  }),
}));

import TrackCoverageBar from "../TrackCoverageBar";

/**
 * The day's coverage bar (TravTrack plan T6): each piece as wide as its share
 * of the day, named by its state; a privacy zone has no state of its own.
 */

const H = 3_600_000;
const D0 = Date.parse("2026-10-11T15:00:00Z");

describe("TrackCoverageBar", () => {
  it("draws each piece as its share of the day, with its state and times", () => {
    render(
      <TrackCoverageBar
        zone="Asia/Seoul"
        coverage={[
          { fromMs: D0, untilMs: D0 + 6 * H, state: "noData" },
          { fromMs: D0 + 6 * H, untilMs: D0 + 18 * H, state: "recorded" },
          { fromMs: D0 + 18 * H, untilMs: D0 + 24 * H, state: "phonePaused" },
        ]}
      />
    );
    const pieces = screen.getByTestId("track-coverage-bar").children;
    expect([...pieces].map((p) => p.getAttribute("data-state"))).toEqual([
      "noData",
      "recorded",
      "phonePaused",
    ]);
    expect((pieces[1] as HTMLElement).style.width).toBe("50%");
    expect(pieces[0].getAttribute("aria-label")).toContain('"from":"00:00"');
    // The legend names the states shown, and only those.
    expect(screen.getByText("track:coverage.phonePaused")).toBeInTheDocument();
    expect(screen.queryByText("track:coverage.deleted")).not.toBeInTheDocument();
  });

  it("draws nothing without a day", () => {
    const { container } = render(<TrackCoverageBar zone="UTC" coverage={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("TrackCoverageBar — a silence the logbook explains", () => {
  it("names the entry and links to it instead of reading 'no data'", () => {
    render(
      <MemoryRouter>
        <TrackCoverageBar
          zone="Asia/Seoul"
          coverage={[
            { fromMs: D0, untilMs: D0 + 6 * H, state: "noData" },
            {
              fromMs: D0 + 6 * H,
              untilMs: D0 + 9 * H,
              state: "entry",
              entry: { domain: "flight", id: "f1" },
            },
          ]}
          context={[
            {
              kind: "flight",
              id: "f1",
              label: "KE1201",
              href: "/flights/f1",
              anchor: null,
              unlabelled: false,
              fromMs: D0 + 6 * H,
              untilMs: D0 + 9 * H,
            },
          ]}
        />
      </MemoryRouter>
    );
    const piece = screen.getByRole("link");
    expect(piece).toHaveAttribute("href", "/flights/f1");
    expect(piece).toHaveAttribute("data-state", "entry");
    expect(piece.getAttribute("aria-label")).toContain("track:timeline.flight");
    expect(piece.getAttribute("aria-label")).toContain("KE1201");
    expect(piece.getAttribute("aria-label")).not.toContain("coverage.noData");
    expect(screen.getByText("track:coverage.entry")).toBeInTheDocument();
  });
});
