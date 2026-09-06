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
 * A ratchet, not a rule with a deadline: the list below is what still has to
 * move, frozen at today's count. It fails on a NEW entry and equally on a
 * STALE one, so it can only ever shrink — the same shape as the file-size and
 * OpenAPI ratchets, and for the same reason. Blocks 4 to 6 empty it.
 */
const PAGES = resolve(__dirname, "..", "pages");

/** Frozen 2026-09-06. Remove a name when its page moves onto AppShell. */
const STILL_BUILDS_ITS_OWN_SHELL: readonly string[] = [
  "AchievementsPage.tsx",
  "AdminPage.tsx",
  "AdvancedStatsPage.tsx",
  "AircraftPage.tsx",
  "CruiseDetailPage.tsx",
  "CuratedChecklistPage.tsx",
  "FlightDetailPage.tsx",
  "LodgingChainDetailPage.tsx",
  "LodgingDetailPage.tsx",
  "NotFoundPage.tsx",
  "ParserPage.tsx",
  "PendingUpdatesPage.tsx",
  "PlaceDetailPage.tsx",
  "PlaceListDetailPage.tsx",
  "PlaceListsPage.tsx",
  "TripDetailPage.tsx",
  "TripRouteEditorPage.tsx",
  "TripsPage.tsx",
];

function pagesImportingNavigationBar(): string[] {
  return readdirSync(PAGES)
    .filter((name) => name.endsWith(".tsx"))
    .filter((name) =>
      /from\s+"\.\.\/components\/NavigationBar"/.test(readFileSync(join(PAGES, name), "utf8"))
    )
    .sort();
}

describe("AppShell owns the navigation and the width", () => {
  it("gains no new page that builds its own shell", () => {
    const offenders = pagesImportingNavigationBar();
    const added = offenders.filter((name) => !STILL_BUILDS_ITS_OWN_SHELL.includes(name));
    expect(added, "a new page imports NavigationBar — use AppShell instead").toEqual([]);
  });

  it("has no stale entry — a page that moved must leave the list", () => {
    const offenders = pagesImportingNavigationBar();
    const stale = STILL_BUILDS_ITS_OWN_SHELL.filter((name) => !offenders.includes(name));
    expect(stale, "these pages no longer import NavigationBar; drop them from the list").toEqual(
      []
    );
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
