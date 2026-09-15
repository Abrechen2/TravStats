import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A page asks for a width by name; it does not build the shell itself.
 *
 * Every page used to import `NavigationBar` and then pick one of ten different
 * `max-w-*` values, which is why no two pages agreed on how wide a page is.
 * `components/ui/AppShell.tsx` owns both since 2.7.0.
 *
 * CLOSED on 2026-09-15, so absolute rather than frozen.
 *
 * It began as a ratchet with 17 names — what still had to move, failing on a
 * new entry and equally on a stale one so the list could only shrink. It
 * reached zero: every page under `pages/` now asks for a width by name. The
 * empty list stays in the file on purpose, as the `dark:` warden's does. It
 * records that the list got to zero rather than that the rule was never
 * needed, and it is what a reviewer reads when someone proposes a page that
 * "just needs its own layout for a moment".
 */
const PAGES = resolve(__dirname, "..", "pages");

/** Empty since 2026-09-15. A name here would mean a page went backwards. */
const STILL_BUILDS_ITS_OWN_SHELL: readonly string[] = [];

function pagesImportingNavigationBar(): string[] {
  return readdirSync(PAGES)
    .filter((name) => name.endsWith(".tsx"))
    .filter((name) =>
      /from\s+"\.\.\/components\/NavigationBar"/.test(readFileSync(join(PAGES, name), "utf8"))
    )
    .sort();
}

describe("AppShell owns the navigation and the width", () => {
  it("has no page left that builds its own shell", () => {
    expect(
      pagesImportingNavigationBar(),
      "a page imports NavigationBar — ask AppShell for a width instead"
    ).toEqual([]);
    expect(STILL_BUILDS_ITS_OWN_SHELL).toEqual([]);
  });

  it("finds pages to judge — otherwise the scan has drifted and passes silently", () => {
    // The scan looks for one import string. If `AppShell` is ever renamed or
    // moved, this assertion is what stops the warden from reporting a clean
    // tree because it is reading nothing at all.
    const pages = readdirSync(PAGES).filter((name) => name.endsWith(".tsx"));
    expect(pages.length).toBeGreaterThan(20);
  });

  it("keeps the four logbook lists on the shell", () => {
    // The point of block 3: one row, one width, one heading style across the
    // four domain lists. Naming them here means a regression is a failing test
    // rather than something someone notices in a screenshot months later.
    const offenders = pagesImportingNavigationBar();
    for (const page of [
      "FlightsTablePage.tsx",
      "CruisesPage.tsx",
      "LodgingListPage.tsx",
      "PlacesListPage.tsx",
      "SettingsPage.tsx",
    ]) {
      expect(offenders, `${page} must use AppShell`).not.toContain(page);
    }
  });
});
