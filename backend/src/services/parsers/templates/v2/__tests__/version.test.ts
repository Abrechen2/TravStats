import { describe, it, expect } from "@jest/globals";
import { compareVersions, isValidVersion } from "../version";

/**
 * The v1 registry compares versions as strings, so "2.10.0" sorts below
 * "2.9.0" and an update is skipped forever. v2 compares numerically.
 */
describe("v2 template versions", () => {
  it.each([
    ["2.10.0", "2.9.0", 1],
    ["2.9.0", "2.10.0", -1],
    ["1.0.0", "1.0.0", 0],
    ["1.2", "1.2.0", 0],
    ["2026.10.01", "2026.10.1", 0],
    ["2026.10.02", "2026.10.01", 1],
    ["2026.10.01.2", "2026.10.01", 1],
    ["2026.9.30", "2026.10.01", -1],
    ["2.7.0-rc.10", "2.7.0", -1],
    ["2.7.0", "2.7.0-rc.10", 1],
    ["2.7.0-rc.10", "2.7.0-rc.9", 1],
    ["2.7.0-alpha", "2.7.0-alpha.1", -1],
    ["2.7.0-1", "2.7.0-alpha", -1],
    ["2.7.0-beta", "2.7.0-alpha", 1],
    ["1.0.0+build.5", "1.0.0", 0],
    ["99999999999999999999.0", "99999999999999999998.0", 1],
  ])("%s vs %s → %d", (a, b, expected) => {
    expect(compareVersions(a, b)).toBe(expected);
  });

  it.each(["2.7.0", "2026.10.01", "2.7.0-rc.10", "1.0.0+sha.abc", "1.2"])("accepts %s", (v) => {
    expect(isValidVersion(v)).toBe(true);
  });

  it.each(["", "2", "v2.7.0", "2025-04b", "1.2.3.4.5", "1..2", "1.2.3-", "latest"])(
    "rejects %s",
    (v) => {
      expect(isValidVersion(v)).toBe(false);
    }
  );

  it("throws on an invalid version instead of guessing an order", () => {
    expect(() => compareVersions("2025-04b", "1.0.0")).toThrow("Not a version");
  });
});
