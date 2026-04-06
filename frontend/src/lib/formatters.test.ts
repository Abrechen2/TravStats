import { describe, it, expect } from "vitest";
import { formatDuration } from "./formatters";

describe("formatDuration", () => {
  it("shows only minutes when under 60", () => {
    expect(formatDuration(45)).toBe("45min");
  });
  it("shows only hours when no remainder", () => {
    expect(formatDuration(120)).toBe("2h");
  });
  it("shows hours and minutes", () => {
    expect(formatDuration(155)).toBe("2h 35min");
  });
  it("handles 0", () => {
    expect(formatDuration(0)).toBe("0min");
  });
});
