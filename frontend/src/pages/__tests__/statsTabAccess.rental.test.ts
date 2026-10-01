import { describe, expect, it } from "vitest";
import { resolveStatsTab, visibleStatsTabs } from "../statsTabAccess";

/**
 * The rental statistics tab answers to the `rentalDomain` beta gate as well
 * as the user's domain — a deep link must not open it on an instance that
 * hides rentals (the leak rail's tab once had).
 */
describe("statistics tab access — rental", () => {
  it("draws no rental tab while the instance gate is closed, even with the domain on", () => {
    expect(visibleStatsTabs(["flight", "rental"], "allowed", false, false)).toEqual(["flight"]);
    expect(visibleStatsTabs(["flight", "rental"], "allowed", false, true)).toEqual([
      "flight",
      "rental",
    ]);
  });

  it("sends a deep link to the overview while the gate is closed", () => {
    expect(resolveStatsTab("rental", ["flight", "rental"], "allowed", false, false)).toBe("all");
    expect(resolveStatsTab("rental", ["flight", "rental"], "allowed", false, true)).toBe("rental");
  });
});
