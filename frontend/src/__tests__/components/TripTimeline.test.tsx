import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import TripTimeline, { type TimelineEvent } from "../../components/Trip/TripTimeline";

describe("TripTimeline", () => {
  const events: TimelineEvent[] = [
    { id: "f1", domain: "flight", date: "2026-04-15", title: "BER → MAD", subtitle: "LH 1234" },
    {
      id: "c1",
      domain: "cruise",
      date: "2026-04-16",
      title: "AIDAnova",
      subtitle: "Barcelona → Palma",
    },
  ];

  it("renders events in chronological order", () => {
    render(<TripTimeline events={events} />);
    const titles = screen.getAllByTestId("timeline-event-title");
    expect(titles[0]).toHaveTextContent("BER → MAD");
    expect(titles[1]).toHaveTextContent("AIDAnova");
  });

  it("badges each event with its domain icon", () => {
    render(<TripTimeline events={events} />);
    expect(screen.getAllByTestId("timeline-event-badge")).toHaveLength(2);
  });
});
