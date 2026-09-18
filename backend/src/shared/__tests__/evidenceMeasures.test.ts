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

  /**
   * Pins fix-round-1 finding 2 against a future edit rather than leaving it
   * to a reader: `CrossDomainKpis`/`OverviewTab` fold over `aggregate()`'s
   * visible-domain population, and four AchievementsPage measures fold over
   * `visibleAchievements = filterAchievementsByDomain(achievements, enabled)`
   * — both are `domainFiltered`, not `allTime`.
   *
   * Deliberately NOT a blanket "every measure whose surface contains
   * `AchievementsPage`" or "every component physically under
   * `Stats/Overview/`" check — both are too coarse and would force a wrong
   * answer onto a real sibling:
   *   - `achievementTotalPoints` shares the `AchievementsPage (header meta)`
   *     surface label with `achievementUnlockedCount`, but reads
   *     `summary?.totalPoints` from the server's `AchievementSummary`
   *     directly, never through `visibleAchievements` — it stays `allTime`.
   *   - `TravelAccountSection` lives in the same `Stats/Overview/` directory
   *     as `CrossDomainKpis`/`OverviewTab`, but fetches
   *     `GET /stats/travel-account` on its own and never consults
   *     `useEnabledDomains()` or the chip toggles (see its own header
   *     comment: "Fetches on its own rather than joining useDomainStats") —
   *     its eleven measures stay `allTime` too.
   * So this asserts by KEY for the achievement four (naming exactly what
   * finding 2 named) and by an unambiguous surface substring for the two
   * Overview components that have no such sibling.
   */
  it("scopes every domain-toggle-dependent Overview/Achievements measure as domainFiltered", () => {
    const domainFilteredKeys = [
      "achievementUnlockedCount",
      "achievementRetiredUnlockedCount",
      "achievementTierProgress",
      "achievementCategoryCount",
    ];
    for (const key of domainFilteredKeys) {
      expect(EVIDENCE_MEASURES[key].scopes).toContain("domainFiltered");
    }

    const domainFilteredSurfaces = ["CrossDomainKpis", "OverviewTab"];
    for (const spec of Object.values(EVIDENCE_MEASURES)) {
      if (domainFilteredSurfaces.some((surface) => spec.surface.includes(surface))) {
        expect(spec.scopes).toContain("domainFiltered");
      }
    }
  });
});
