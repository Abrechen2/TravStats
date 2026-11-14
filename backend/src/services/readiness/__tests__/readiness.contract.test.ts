import {
  CHECK_CATALOGUE,
  CHECK_IDS,
  NOTE_CATALOGUE,
  NOTE_IDS,
} from "../../../shared/readinessCatalogue";
import { catalogueProblems } from "../contract";
import { CHECKS } from "../registry";
import { NOTES } from "../upgrades/notes";
import { CHECK_IMPLS } from "../checkImpls";

/**
 * The registry's contract (spec 2026-11-14 §5, §9). The catalogue itself is
 * data in `shared/readinessCatalogue.ts`; the frontend's test reads the same
 * list for DE/EN keys and `resolveAddress`.
 */
describe("readiness catalogue contract", () => {
  it("holds for the real registry", () => {
    expect(catalogueProblems(CHECKS, NOTES)).toEqual([]);
  });

  it("lists every id once and gives each an evaluator", () => {
    expect(CHECK_CATALOGUE.map((c) => c.id)).toEqual([...CHECK_IDS]);
    expect(Object.keys(CHECK_IMPLS).sort()).toEqual([...CHECK_IDS].sort());
    expect(NOTE_CATALOGUE.map((n) => n.id)).toEqual([...NOTE_IDS]);
  });

  it("keeps every account item recommended in stage 1 (owner, 2026-11-14)", () => {
    for (const c of CHECK_CATALOGUE) {
      if (c.scope === "user") expect(c.severity).toBe("recommended");
    }
  });

  describe("the guard itself fails on a broken catalogue", () => {
    const check = CHECKS[0];
    const note = NOTES[0];

    it("catches a duplicated check id and a check without an evaluator", () => {
      const problems = catalogueProblems([check, check, { ...CHECKS[1], evaluate: undefined }], []);
      expect(problems.join("\n")).toMatch(/duplicated/);
      expect(problems.join("\n")).toMatch(/no evaluator/);
    });

    it("catches a note with both or neither of action and noActionReason", () => {
      const both = {
        ...note,
        action: { kind: "address" as const, address: "/settings/x" },
        noActionReason: "r",
      };
      const neither = { ...note, action: null, noActionReason: null };
      expect(catalogueProblems(CHECKS, [both]).join()).toMatch(/exactly one/);
      expect(catalogueProblems(CHECKS, [neither]).join()).toMatch(/exactly one/);
    });

    it("catches a check-backed note that names no existing check", () => {
      const dangling = {
        ...note,
        action: { kind: "check" as const, checkId: "admin.nope" as never },
        noActionReason: null,
      };
      expect(catalogueProblems(CHECKS, [dangling]).join()).toMatch(/unknown check/);
    });

    it("catches an item blocked by something that is not an admin item", () => {
      const user = CHECKS.find((c) => c.scope === "user")!;
      const bad = { ...user, blockedBy: "user.domains" as const };
      expect(
        catalogueProblems([...CHECKS.filter((c) => c.id !== user.id), bad], []).join()
      ).toMatch(/admin item/);
    });

    it("catches a copy key used twice", () => {
      const twin = { ...CHECKS[1], titleKey: CHECKS[0].titleKey };
      expect(catalogueProblems([CHECKS[0], twin], []).join()).toMatch(/used twice/);
    });
  });
});
