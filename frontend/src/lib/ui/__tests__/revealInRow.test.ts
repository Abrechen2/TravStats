import { describe, it, expect } from "vitest";
import { revealInRow } from "../revealInRow";

function box(left: number, width: number): DOMRect {
  return {
    left,
    right: left + width,
    width,
    top: 0,
    bottom: 10,
    height: 10,
    x: left,
    y: 0,
    toJSON: () => ({}),
  };
}

function fake(left: number, width: number): HTMLElement {
  const el = document.createElement("div");
  el.getBoundingClientRect = () => box(left, width);
  return el;
}

describe("revealInRow", () => {
  it("scrolls right just far enough to show a child beyond the right edge", () => {
    const row = fake(0, 300);
    row.scrollLeft = 0;
    Object.defineProperty(row, "scrollLeft", { value: 0, writable: true });
    revealInRow(row, fake(320, 80), 16);
    expect(row.scrollLeft).toBe(320 + 80 - (300 - 16));
  });

  it("scrolls left to show a child before the left edge", () => {
    const row = fake(0, 300);
    Object.defineProperty(row, "scrollLeft", { value: 200, writable: true });
    revealInRow(row, fake(-40, 80), 16);
    expect(row.scrollLeft).toBe(200 - 56);
  });

  it("leaves a row alone when the child is already in view", () => {
    const row = fake(0, 300);
    Object.defineProperty(row, "scrollLeft", { value: 50, writable: true });
    revealInRow(row, fake(100, 80), 16);
    expect(row.scrollLeft).toBe(50);
  });
});
