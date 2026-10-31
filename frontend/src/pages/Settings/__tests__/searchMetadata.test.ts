import { describe, expect, it } from "vitest";
import deSettings from "../../../i18n/resources/de/settings.json";
import enSettings from "../../../i18n/resources/en/settings.json";
import deAdmin from "../../../i18n/resources/de/admin.json";
import enAdmin from "../../../i18n/resources/en/admin.json";
import { SETTINGS_PAGES } from "../settingsModel";
import { ADMIN_PAGES } from "../../Admin/adminSections";

/**
 * Search metadata comes from the same section definitions the page renders
 * from (settings redesign, package 3): a section that draws expert-only rows
 * carries `expertRows`, and that flag — not a second list in the search — is
 * what says it has `search.expertKeywords.<id>` words. The audit found
 * `settings:features` drawing an expert row while the parallel list omitted it.
 */
const flagged = (pages: typeof SETTINGS_PAGES): string[] =>
  pages.flatMap((p) => p.sections.filter((s) => s.expertRows).map((s) => s.id)).sort();

describe.each([
  ["de settings", deSettings, SETTINGS_PAGES],
  ["en settings", enSettings, SETTINGS_PAGES],
  ["de admin", deAdmin, ADMIN_PAGES],
  ["en admin", enAdmin, ADMIN_PAGES],
] as const)("%s search metadata", (_name, copy, pages) => {
  it("has expert keywords for exactly the sections flagged expertRows", () => {
    const keys = Object.keys((copy.search as { expertKeywords: object }).expertKeywords).sort();
    expect(keys).toEqual(flagged(pages as typeof SETTINGS_PAGES));
  });
});

describe("a section with a folded expert row is not searched as a plain one", () => {
  it("flags the sections that fold their rows", () => {
    const folds = [...SETTINGS_PAGES, ...ADMIN_PAGES]
      .flatMap((p) => p.sections.filter((s) => s.foldsRows).map((s) => s.id))
      .sort();
    expect(folds).toEqual(["externalServices", "externalServices"]);
  });
});
