import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StarRating } from "../StarRating";

describe("StarRating", () => {
  it("always keeps the plain numeric value alongside the star glyphs (not colour-only)", () => {
    render(<StarRating value={4.3} />);
    expect(screen.getByText(/4\.3/)).toBeInTheDocument();
  });

  it("renders '—' for a null (unrated) value", () => {
    render(<StarRating value={null} />);
    expect(screen.getByText("—")).toBeInTheDocument();
  });

  it("rounds to the nearest half-star for the glyphs", () => {
    const { container } = render(<StarRating value={4.5} />);
    // 4.5 → 4 filled + 1 half glyph, no full 5th star.
    const glyphs = container.querySelector("[aria-hidden]")?.textContent ?? "";
    expect(glyphs).toContain("★★★★");
    expect(glyphs).toContain("⯪");
  });

  it("never exceeds `max` filled+half+empty glyphs", () => {
    const { container } = render(<StarRating value={5} max={5} />);
    const glyphs = container.querySelector("[aria-hidden]")?.textContent ?? "";
    expect([...glyphs].filter((c) => c === "★").length).toBeLessThanOrEqual(5);
  });
});
