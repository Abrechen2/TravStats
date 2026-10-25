import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { TravTrackDay, TravTrackDayEntry } from "../../../lib/api/travtrack";
import de from "../../../i18n/resources/de/track.json";
import en from "../../../i18n/resources/en/track.json";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key} ${JSON.stringify(opts)}` : key,
  }),
}));

import TrackTimeline from "../TrackTimeline";
import { dayAnchors } from "../trackContextLabel";

/**
 * The day as the logbook tells it (TravTrack plan E10): every entry TravStats
 * holds, linked to its page; the open TravTrack questions, linked to their
 * inbox card; and the moving stretches nothing covers — "Unterwegs, ohne
 * Eintrag", never with a guessed mode.
 */

const D0 = Date.parse("2026-10-19T22:00:00Z");
const H = 3_600_000;

const entry = (over: Partial<TravTrackDayEntry>): TravTrackDayEntry => ({
  kind: "rail",
  id: "r1",
  label: "ICE 725 Frankfurt–Würzburg",
  href: "/rail/r1",
  anchor: { lat: 50.1, lon: 8.66 },
  unlabelled: false,
  fromMs: D0 + 10 * H,
  untilMs: D0 + 12 * H,
  ...over,
});

const day = (context: TravTrackDayEntry[]): TravTrackDay => ({
  date: "2026-10-20",
  zone: "Europe/Berlin",
  segments: [],
  coverage: [{ fromMs: D0, untilMs: D0 + 24 * H, state: "recorded" }],
  context,
  pointCount: 0,
  truncated: false,
});

const renderDay = (context: TravTrackDayEntry[]) =>
  render(
    <MemoryRouter>
      <TrackTimeline day={day(context)} />
    </MemoryRouter>
  );

describe("TrackTimeline", () => {
  it("labels a rail ride, a hotel night and a café visit and links each to its page", () => {
    renderDay([
      entry({}),
      entry({
        kind: "lodging",
        id: "s1",
        label: "Hotel Krone",
        href: "/lodging/l1",
        fromMs: D0 + 16 * H,
        untilMs: D0 + 24 * H,
      }),
      entry({
        kind: "poi",
        id: "v1",
        label: "Café Schmitt",
        href: "/places/p1",
        fromMs: D0 + 13 * H,
        untilMs: D0 + 13 * H,
      }),
    ]);
    const list = screen.getByTestId("track-timeline");
    expect(within(list).getByText(/track:timeline.rail.*ICE 725/)).toHaveAttribute(
      "href",
      "/rail/r1"
    );
    expect(within(list).getByText(/track:timeline.lodging.*Hotel Krone/)).toHaveAttribute(
      "href",
      "/lodging/l1"
    );
    expect(within(list).getByText(/track:timeline.poi.*Café Schmitt/)).toHaveAttribute(
      "href",
      "/places/p1"
    );
    // A visit is a moment: one clock, not a span from and to the same minute.
    expect(within(list).getAllByRole("listitem")[2]).toHaveTextContent("track:timeline.at");
  });

  it("an open TravTrack question links to its inbox card", () => {
    renderDay([
      entry({
        kind: "suggestion",
        suggestion: "stay",
        id: "q1",
        label: "Mainufer",
        href: "/pending-updates?view=list&item=dawarich%3Aq1",
        anchor: null,
      }),
      entry({
        kind: "suggestion",
        suggestion: "journey",
        id: "q2",
        label: "42",
        href: "/pending-updates?view=list&item=location%3Aq2",
        fromMs: D0 + 14 * H,
        untilMs: D0 + 15 * H,
      }),
    ]);
    expect(screen.getByText(/track:timeline.suggestion.stay.*Mainufer/)).toHaveAttribute(
      "href",
      "/pending-updates?view=list&item=dawarich%3Aq1"
    );
    expect(screen.getByText(/track:timeline.suggestion.journey.*42/)).toHaveAttribute(
      "href",
      "/pending-updates?view=list&item=location%3Aq2"
    );
  });

  it("an uncovered moving stretch reads 'Unterwegs, ohne Eintrag' and names no mode", () => {
    renderDay([entry({ kind: "movement", id: null, label: "", href: null, unlabelled: true })]);
    const item = within(screen.getByTestId("track-timeline")).getByRole("listitem");
    expect(item).toHaveTextContent("track:timeline.movement");
    expect(within(item).queryByRole("link")).toBeNull();
    expect(item.textContent).not.toMatch(/rail|road|bus|train|car/i);
    expect(de.timeline.movement).toBe("Unterwegs, ohne Eintrag");
    expect(en.timeline.movement).toBe("On the move, no entry");
  });

  it("an entry of a domain the web does not know yet is still listed, unlinked", () => {
    renderDay([entry({ kind: "hovercraft", label: "", href: null })]);
    const item = within(screen.getByTestId("track-timeline")).getByRole("listitem");
    expect(item).toHaveTextContent("track:timeline.entry");
    expect(within(item).queryByRole("link")).toBeNull();
  });

  it("says when TravStats knows nothing of the day", () => {
    renderDay([]);
    expect(screen.getByText("track:timeline.none")).toBeInTheDocument();
  });

  it("puts on the map only the labels that carry an anchor", () => {
    const t = (key: string) => key;
    const anchors = dayAnchors(
      [
        entry({}),
        entry({ kind: "poi", id: "v1", label: "Café", anchor: null }),
        entry({ kind: "movement", id: null, label: "", href: null, unlabelled: true }),
      ],
      t
    );
    expect(anchors.map((a) => [a.lat, a.lon, a.kind])).toEqual([
      [50.1, 8.66, "rail"],
      [50.1, 8.66, "movement"],
    ]);
    expect(anchors[1].text).toBe("track:timeline.movement");
  });
});
