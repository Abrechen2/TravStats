import { describe, expect, it } from "vitest";

import deRail from "../resources/de/rail.json";
import enRail from "../resources/en/rail.json";

/**
 * Acceptance D7 (2026-09-26): the rail page still said "Der Import von
 * Buchungen folgt" while the import had shipped behind its own button. The
 * note now points at that button, by the button's own label, so the two
 * cannot drift apart silently.
 */
describe("the rail page's beta note", () => {
  it.each([
    ["de", deRail],
    ["en", enRail],
  ])("points at the import in %s instead of promising it", (_locale, rail) => {
    expect(rail.betaNote).toContain(rail.add);
    expect(rail.betaNote).not.toMatch(/folgt|comes next/);
  });
});
