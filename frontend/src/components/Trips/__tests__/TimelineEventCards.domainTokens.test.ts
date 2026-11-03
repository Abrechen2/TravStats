import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The trip timeline tiles took their tint from hard-coded 2.6 colours
 * (rgba(212,119,143) for a stay, a fixed blue for a cruise), so a change to the
 * domain colour tokens never reached them. Every tile tint must come from a
 * `--domain-*-soft` token.
 */
describe("TimelineEventCards domain colours", () => {
  const src = readFileSync(join(__dirname, "..", "TimelineEventCards.tsx"), "utf8");

  it("tints no tile with a hard-coded rgba() colour", () => {
    expect(src).not.toMatch(/bg="rgba\(/);
  });

  it.each(["flight", "cruise", "lodging", "poi"])("routes the %s tile through its token", (d) => {
    expect(src).toContain(`bg="var(--domain-${d}-soft)"`);
  });
});
