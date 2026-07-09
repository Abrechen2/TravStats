import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import Sparkline from "./Sparkline";

describe("Sparkline", () => {
  it("renders a polyline for >=2 points", () => {
    const { container } = render(<Sparkline points={[1, 4, 2, 8]} />);
    const poly = container.querySelector("polyline");
    expect(poly).not.toBeNull();
    // 4 points → 4 coordinate pairs
    expect(poly!.getAttribute("points")!.trim().split(/\s+/)).toHaveLength(4);
  });

  it("renders nothing (no svg) for an empty series", () => {
    const { container } = render(<Sparkline points={[]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("does not crash on a flat series and still draws a line", () => {
    const { container } = render(<Sparkline points={[5, 5, 5]} />);
    expect(container.querySelector("polyline")).not.toBeNull();
  });

  it("renders a filled area polygon when filled", () => {
    const { container } = render(<Sparkline points={[1, 2, 3]} filled />);
    expect(container.querySelector("polygon")).not.toBeNull();
  });
});
