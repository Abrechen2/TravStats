import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ATTRIBUTION_CLEARANCE } from "../attributionClearance";

/** The body of every `@media (max-width: 639px) { … }` block, braces matched. */
function phoneBlocks(css: string): string[] {
  const marker = "@media (max-width: 639px)";
  const blocks: string[] = [];
  let from = css.indexOf(marker);
  while (from !== -1) {
    const open = css.indexOf("{", from);
    let depth = 1;
    let i = open + 1;
    for (; i < css.length && depth > 0; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}") depth--;
    }
    blocks.push(css.slice(open + 1, i - 1));
    from = css.indexOf(marker, i);
  }
  return blocks;
}

/**
 * The map panel's phone offset lives in CSS (a media query), the clearance in
 * TypeScript. This holds the two together: the day one changes alone, the
 * collapsed panel sits on the map credit again (CT106 audit B02).
 */
describe("map panel dock", () => {
  it("lifts the panel on a phone by exactly the attribution clearance", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../../../theme/ui.css"), "utf-8");
    const rules = phoneBlocks(css)
      .map((block) => /\.ts-map-panel-dock\s*\{([^}]*)\}/.exec(block)?.[1])
      .filter((rule): rule is string => rule !== undefined);
    expect(rules).toHaveLength(1);
    expect(rules[0]).toContain(`bottom: ${ATTRIBUTION_CLEARANCE}px`);
  });
});
