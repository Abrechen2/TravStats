import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ATTRIBUTION_CLEARANCE } from "../attributionClearance";

/**
 * The map panel's phone offset lives in CSS (a media query), the clearance in
 * TypeScript. This holds the two together: the day one changes alone, the
 * collapsed panel sits on the map credit again (CT106 audit B02).
 */
describe("map panel dock", () => {
  it("lifts the panel on a phone by exactly the attribution clearance", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../../../theme/ui.css"), "utf-8");
    const phone = css.slice(css.indexOf("@media (max-width: 639px)"));
    const rule = phone.slice(
      phone.indexOf(".ts-map-panel-dock"),
      phone.indexOf("}", phone.indexOf(".ts-map-panel-dock"))
    );
    expect(rule).toContain(`bottom: ${ATTRIBUTION_CLEARANCE}px`);
  });
});
