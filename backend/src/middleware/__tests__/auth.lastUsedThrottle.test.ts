import { shouldTouchLastUsed } from "../auth";

describe("PAT last-used stamp (forgejo#383 PERF-28)", () => {
  const now = Date.parse("2026-10-31T12:00:00Z");

  it("stamps a token that has never been used", () => {
    expect(shouldTouchLastUsed(null, now)).toBe(true);
  });

  it("does not rewrite the stamp on every request within a minute", () => {
    expect(shouldTouchLastUsed(new Date(now - 5_000), now)).toBe(false);
    expect(shouldTouchLastUsed(new Date(now - 59_999), now)).toBe(false);
  });

  it("stamps again once the stored value is a minute old", () => {
    expect(shouldTouchLastUsed(new Date(now - 60_000), now)).toBe(true);
  });
});
