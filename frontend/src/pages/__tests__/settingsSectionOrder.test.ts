import { describe, it, expect } from "vitest";
import {
  SETTINGS_GROUPS,
  GENERAL_CONTENT_ORDER,
  GENERAL_GROUP_IDS,
  isGeneralGroup,
} from "../Settings/settingsModel";

// The tester saw the left menu highlight jump to an unrelated entry while
// scrolling. Cause: the menu listed each general group's sections via its own
// `sections` array, while the "Allgemein" page body read a second,
// hand-written order (`GENERAL_CONTENT_ORDER`) that interleaved sections
// across groups differently ("everyday first" vs. "grouped by kind"). Once
// `GENERAL_CONTENT_ORDER` is DERIVED from the same `sections` arrays instead
// of hand-copied, the two orders structurally cannot diverge again — this
// test pins the derivation, not just today's values.
describe("settings section order", () => {
  it("draws the Allgemein page in exactly the order its four groups list their own sections", () => {
    const expectedFromMenu = SETTINGS_GROUPS.filter((g) => isGeneralGroup(g.id)).flatMap(
      (g) => g.sections
    );
    expect(GENERAL_CONTENT_ORDER).toEqual(expectedFromMenu);
  });

  it("keeps every general section in exactly one place in the page order", () => {
    const seen = new Set(GENERAL_CONTENT_ORDER);
    expect(seen.size).toBe(GENERAL_CONTENT_ORDER.length);
  });

  it("lists the general groups in the same order for GENERAL_GROUP_IDS and the menu", () => {
    // GENERAL_GROUP_IDS drives the legacy redirect too; keeping it as the
    // single group-ordering list leaves nowhere for a THIRD order to appear.
    expect(SETTINGS_GROUPS.filter((g) => isGeneralGroup(g.id)).map((g) => g.id)).toEqual([
      ...GENERAL_GROUP_IDS,
    ]);
  });
});
