import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { ATTRIBUTION_CLEARANCE, ATTRIBUTION_BAR_CLEARANCE_MIN } from "../attributionClearance";

/**
 * #273 — the map key covered MapLibre's attribution bar. The fix was a number;
 * this holds the number, and holds that every tab reads the same one.
 */
describe("bottom-right overlays clear the attribution bar (#273)", () => {
  it("keeps the clearance above the measured overlap", () => {
    expect(ATTRIBUTION_CLEARANCE).toBeGreaterThanOrEqual(ATTRIBUTION_BAR_CLEARANCE_MIN);
  });

  it("lets no dashboard tab carry its own copy of the number", () => {
    const tabsDir = join(__dirname, "..", "..", "Dashboard", "tabs");
    const offenders = readdirSync(tabsDir)
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) =>
        /const ATTRIBUTION_CLEARANCE\s*=/.test(readFileSync(join(tabsDir, f), "utf8"))
      );
    expect(offenders).toEqual([]);
  });

  it("is what the tabs that draw a key actually use", () => {
    const tabsDir = join(__dirname, "..", "..", "Dashboard", "tabs");
    const users = readdirSync(tabsDir)
      .filter((f) => f.endsWith(".tsx"))
      .filter((f) => /bottom: ATTRIBUTION_CLEARANCE/.test(readFileSync(join(tabsDir, f), "utf8")));
    expect(users.sort()).toEqual(["AllTab.tsx", "PoiTab.tsx", "TourTab.tsx"]);
  });
});
