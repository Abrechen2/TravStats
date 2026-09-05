/**
 * The bug this file exists to prevent: the flights table wrote its status
 * colours as a nested ternary whose ELSE branch caught everything that was not
 * flown or scheduled. A `historical` flight — real, just recorded without
 * exact times — came out in the cancelled red, indistinguishable from one that
 * never took off.
 *
 * Since 2.7.0 the palette is `design/tokens.json`, so the cases below assert
 * the mapping rather than four literals. Two of them changed meaning with it,
 * and both changes are the design system overruling an earlier local decision:
 *
 *  - `historical` was an archival amber and is now the token grey. Amber is
 *    `warn` in the shared vocabulary, and a flight recorded without exact times
 *    is not something to decide about.
 *  - `in_progress` had a purple of its own, chosen so a cruise under way read
 *    as neither past nor future. The shared system does not spend a hue on it:
 *    even the Companion's `live` token is the same value as `good`. What is
 *    running is said by the LABEL, and the colour vocabulary stays small.
 */
import { describe, it, expect } from "vitest";
import { statusPillStyle } from "../statusPillStyle";

describe("statusPillStyle", () => {
  it("does not paint a historical entry like a cancelled one", () => {
    expect(statusPillStyle("historical")).not.toEqual(statusPillStyle("cancelled"));
  });

  it("reads every colour from the token layer, never a literal", () => {
    for (const status of ["flown", "scheduled", "cancelled", "historical", "in_progress"]) {
      expect(statusPillStyle(status).color, status).toMatch(/^var\(--ts-status-[a-z]+\)$/);
    }
  });

  it("treats the done states alike across domains", () => {
    // A flown flight and a completed stay are the same state in two vocabularies.
    expect(statusPillStyle("completed")).toEqual(statusPillStyle("flown"));
  });

  it("treats the upcoming states alike across domains", () => {
    expect(statusPillStyle("booked")).toEqual(statusPillStyle("scheduled"));
  });

  it("gives a running entry the done colour and lets its label carry the news", () => {
    expect(statusPillStyle("in_progress")).toEqual(statusPillStyle("flown"));
  });

  it("does not reuse the brand accent for a status", () => {
    // The accent already means "the thing you are looking at" everywhere else.
    expect(statusPillStyle("in_progress").color).not.toContain("accent");
    expect(statusPillStyle("flown").color).not.toContain("accent");
  });

  it("renders an unknown status neutrally, not as cancelled", () => {
    const unknown = statusPillStyle("something-new");
    expect(unknown).not.toEqual(statusPillStyle("cancelled"));
    expect(unknown.color).toBe("var(--ts-status-historical)");
  });

  it("follows the shared recipe: 12 % fill, 45 % border, and a dash for provisional", () => {
    const flown = statusPillStyle("flown");
    expect(flown.background).toContain("12%");
    expect(flown.border).toContain("45%");
    expect(flown.border).toContain("solid");
    expect(statusPillStyle("pending").border).toContain("dashed");
  });
});
