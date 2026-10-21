import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

import { JitterNote } from "../JitterNote";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (k: string, o?: Record<string, unknown>) => (o?.count !== undefined ? `${k}:${o.count}` : k),
  }),
}));

describe("JitterNote (forgejo#319)", () => {
  it("says how many fixes a stored recording left out of its line and distance", () => {
    render(<JitterNote jitterDropped={174} />);
    expect(screen.getByTestId("track-jitter-note")).toHaveTextContent(
      "common:trackJitter.dropped:174"
    );
  });

  it("says the trip recording only left them off the line", () => {
    render(<JitterNote jitterDropped={12} variant="line" />);
    expect(screen.getByTestId("track-jitter-note")).toHaveTextContent(
      "common:trackJitter.droppedLine:12"
    );
  });

  it("says a recording was not checked, rather than staying silent like a clean one", () => {
    render(<JitterNote jitterDropped={null} />);
    expect(screen.getByTestId("track-jitter-note")).toHaveTextContent(
      "common:trackJitter.unchecked"
    );
  });

  it("says nothing about a checked recording with nothing to remove", () => {
    render(<JitterNote jitterDropped={0} />);
    expect(screen.queryByTestId("track-jitter-note")).toBeNull();
  });
});
