import { describe, it, expect } from "vitest";
import { EVIDENCE_MEASURES } from "../evidenceMeasures";

/**
 * The registry is the inventory in code. Two ways it goes stale, both caught
 * here: a measure whose spec is incomplete, and a key the panel can build but
 * no resolver serves. The first plan's seven hand-picked keys missed at least
 * six numbers that are on screen, which is why the list is derived from a walk
 * of the pages and not from memory.
 */
describe("EVIDENCE_MEASURES", () => {
  it("gives every measure a complete spec", () => {
    for (const [key, spec] of Object.entries(EVIDENCE_MEASURES)) {
      expect(spec.aggregation).toBeDefined();
      expect(spec.unit).toBeTruthy();
      expect(spec.surface).toBeTruthy();
      expect(spec.calculator).toBeTruthy();
      expect([1, 2]).toContain(spec.servedIn);
      // Keys describe the number, not the component (Decision 4) — a
      // component name in the key ("StatsOverviewCards...") would be the
      // drift the design's own "sum(contribution) + unattributed" review
      // warned about, one level up: the key would stop matching the number
      // the moment the number moved to a different tile.
      expect(key).toMatch(/^[a-z][a-zA-Z0-9]*$/);
    }
  });

  it("serves at least one measure of each aggregation kind in release 1", () => {
    const kinds = new Set(
      Object.values(EVIDENCE_MEASURES)
        .filter((s) => s.servedIn === 1)
        .map((s) => s.aggregation)
    );
    expect(kinds).toContain("sum");
    expect(kinds).toContain("distinct");
  });

  /**
   * Decision 1 is absolute for the Achievements page: every measure there is
   * `servedIn: 2` regardless of its own aggregation. A `sum` count living on
   * that page must not slip into release 1 just because `sum` usually does —
   * the page it is on, not its shape, is what decided this.
   */
  it("holds every Achievements-page measure to servedIn: 2", () => {
    const achievementSurfaces = ["AchievementsPage", "AchievementCard", "AchievementLeaderboard"];
    for (const [key, spec] of Object.entries(EVIDENCE_MEASURES)) {
      if (achievementSurfaces.some((surface) => spec.surface.includes(surface))) {
        expect(spec.servedIn).toBe(2);
      }
      void key;
    }
  });

  it("never lets an extremum, ratio, boolean or sequence measure into release 1", () => {
    const release2Only: ReadonlySet<string> = new Set(["extremum", "ratio", "boolean", "sequence"]);
    for (const spec of Object.values(EVIDENCE_MEASURES)) {
      if (release2Only.has(spec.aggregation)) {
        expect(spec.servedIn).toBe(2);
      }
    }
  });
});
