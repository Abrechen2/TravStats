import { describe, it, expect } from "vitest";
import { describeLodgingCommitResult } from "../lodgingImportResult";
import type { LodgingImportCommitResult } from "../../types/lodgingImport";

/**
 * Translation function stub — maps i18n keys to readable test labels.
 */
function makeMockTranslate() {
  const translations: Record<string, string> = {
    "lodging:import.commitResult.success":
      "Imported {{createdLodgings}} hotel(s) and {{createdStays}} stay(s), skipped {{skipped}} (already present).",
    "lodging:import.commitResult.partial":
      "Imported {{createdLodgings}} hotel(s) and {{createdStays}} stay(s), skipped {{skipped}} (already present), {{failedCount}} row(s) failed: {{reasons}}",
    "lodging:import.commitResult.failureCodes.ownership_mismatch": "belongs to another account",
    "lodging:import.commitResult.failureCodes.missing_lodging_reference": "missing hotel reference",
    "lodging:import.commitResult.failureCodes.unexpected_error": "unexpected error",
  };

  return (key: string, options?: Record<string, unknown>): string => {
    let result = translations[key] ?? key;
    if (options) {
      Object.entries(options).forEach(([k, v]) => {
        result = result.replace(`{{${k}}}`, String(v));
      });
    }
    return result;
  };
}

describe("describeLodgingCommitResult", () => {
  describe("clean success (no failures)", () => {
    it("returns success type and success message", () => {
      const t = makeMockTranslate();
      const result: LodgingImportCommitResult = {
        batchId: "b1",
        createdLodgings: 5,
        createdStays: 8,
        skipped: 0,
        failed: [],
      };

      const toast = describeLodgingCommitResult(result, t);

      expect(toast.type).toBe("success");
      expect(toast.message).toContain("5 hotel");
      expect(toast.message).toContain("8 stay");
      expect(toast.message).not.toContain("failed");
    });

    it("renders the success message correctly with zero counts", () => {
      const t = makeMockTranslate();
      const result: LodgingImportCommitResult = {
        batchId: "b1",
        createdLodgings: 0,
        createdStays: 0,
        skipped: 0,
        failed: [],
      };

      const toast = describeLodgingCommitResult(result, t);

      expect(toast.type).toBe("success");
      expect(toast.message).toContain("0 hotel");
      expect(toast.message).toContain("0 stay");
    });
  });

  // Finding 3: `result.skipped` was dropped by both toast branches, violating
  // the Task-16 carry-in ("present createdLodgings/createdStays/skipped/
  // failed[] honestly"). The headline externalRef-dedup feature (re-import
  // the same file/e-mail is a no-op) otherwise reads as an unexplained
  // "0 hotels, 0 stays imported".
  describe("skipped rows are surfaced (Finding 3)", () => {
    it("includes the skipped count in a clean success message", () => {
      const t = makeMockTranslate();
      const result: LodgingImportCommitResult = {
        batchId: "b1",
        createdLodgings: 3,
        createdStays: 4,
        skipped: 2,
        failed: [],
      };

      const toast = describeLodgingCommitResult(result, t);

      expect(toast.type).toBe("success");
      expect(toast.message).toContain("2");
    });

    it("explains a same-file re-import — everything skipped, nothing created, nothing failed", () => {
      const t = makeMockTranslate();
      const result: LodgingImportCommitResult = {
        batchId: "b1",
        createdLodgings: 0,
        createdStays: 0,
        skipped: 12,
        failed: [],
      };

      const toast = describeLodgingCommitResult(result, t);

      expect(toast.type).toBe("success");
      // Must not read as an unexplained no-op: the skipped count has to be
      // present alongside the (honestly zero) created counts.
      expect(toast.message).toContain("0 hotel");
      expect(toast.message).toContain("0 stay");
      expect(toast.message).toContain("12");
    });

    it("includes the skipped count in a partial-failure warning message too", () => {
      const t = makeMockTranslate();
      const result: LodgingImportCommitResult = {
        batchId: "b1",
        createdLodgings: 1,
        createdStays: 1,
        skipped: 5,
        failed: [{ sourceRowIndex: 0, code: "unexpected_error", error: "Database error" }],
      };

      const toast = describeLodgingCommitResult(result, t);

      expect(toast.type).toBe("warning");
      expect(toast.message).toContain("5");
      expect(toast.message).toContain("1 row(s) failed");
    });
  });

  describe("single failure code", () => {
    it("returns warning type for ownership_mismatch failure", () => {
      const t = makeMockTranslate();
      const result: LodgingImportCommitResult = {
        batchId: "b1",
        createdLodgings: 2,
        createdStays: 3,
        skipped: 0,
        failed: [
          {
            sourceRowIndex: 5,
            code: "ownership_mismatch",
            error: "The hotel belongs to another account",
          },
        ],
      };

      const toast = describeLodgingCommitResult(result, t);

      expect(toast.type).toBe("warning");
      expect(toast.message).toContain("2 hotel");
      expect(toast.message).toContain("3 stay");
      expect(toast.message).toContain("1 row(s) failed");
      expect(toast.message).toContain("belongs to another account");
    });

    it("returns warning type for missing_lodging_reference failure", () => {
      const t = makeMockTranslate();
      const result: LodgingImportCommitResult = {
        batchId: "b1",
        createdLodgings: 1,
        createdStays: 1,
        skipped: 0,
        failed: [
          {
            sourceRowIndex: 2,
            code: "missing_lodging_reference",
            error: "Stay row missing a lodging reference",
          },
        ],
      };

      const toast = describeLodgingCommitResult(result, t);

      expect(toast.type).toBe("warning");
      expect(toast.message).toContain("missing hotel reference");
      expect(toast.message).toContain("1 row(s) failed");
    });

    it("returns warning type for unexpected_error failure", () => {
      const t = makeMockTranslate();
      const result: LodgingImportCommitResult = {
        batchId: "b1",
        createdLodgings: 0,
        createdStays: 1,
        skipped: 0,
        failed: [
          {
            sourceRowIndex: 0,
            code: "unexpected_error",
            error: "Database constraint violation",
          },
        ],
      };

      const toast = describeLodgingCommitResult(result, t);

      expect(toast.type).toBe("warning");
      expect(toast.message).toContain("unexpected error");
      expect(toast.message).toContain("1 row(s) failed");
    });
  });

  describe("multiple failures of the same code", () => {
    it("aggregates ownership_mismatch failures into a count", () => {
      const t = makeMockTranslate();
      const result: LodgingImportCommitResult = {
        batchId: "b1",
        createdLodgings: 2,
        createdStays: 2,
        skipped: 0,
        failed: [
          { sourceRowIndex: 1, code: "ownership_mismatch", error: "Belongs to another account" },
          { sourceRowIndex: 3, code: "ownership_mismatch", error: "Belongs to another account" },
          { sourceRowIndex: 5, code: "ownership_mismatch", error: "Belongs to another account" },
        ],
      };

      const toast = describeLodgingCommitResult(result, t);

      expect(toast.type).toBe("warning");
      expect(toast.message).toContain("3 row(s) failed");
      expect(toast.message).toContain("3× belongs to another account");
    });

    it("aggregates missing_lodging_reference failures into a count", () => {
      const t = makeMockTranslate();
      const result: LodgingImportCommitResult = {
        batchId: "b1",
        createdLodgings: 1,
        createdStays: 1,
        skipped: 0,
        failed: [
          {
            sourceRowIndex: 0,
            code: "missing_lodging_reference",
            error: "Missing lodging reference",
          },
          {
            sourceRowIndex: 1,
            code: "missing_lodging_reference",
            error: "Missing lodging reference",
          },
        ],
      };

      const toast = describeLodgingCommitResult(result, t);

      expect(toast.type).toBe("warning");
      expect(toast.message).toContain("2 row(s) failed");
      expect(toast.message).toContain("2× missing hotel reference");
    });
  });

  describe("mixed failure codes in one result", () => {
    it("includes both codes and their respective counts in the message", () => {
      const t = makeMockTranslate();
      const result: LodgingImportCommitResult = {
        batchId: "b1",
        createdLodgings: 3,
        createdStays: 4,
        skipped: 0,
        failed: [
          { sourceRowIndex: 1, code: "ownership_mismatch", error: "Belongs to another account" },
          { sourceRowIndex: 3, code: "ownership_mismatch", error: "Belongs to another account" },
          {
            sourceRowIndex: 5,
            code: "missing_lodging_reference",
            error: "Missing lodging reference",
          },
          { sourceRowIndex: 7, code: "unexpected_error", error: "Database error" },
        ],
      };

      const toast = describeLodgingCommitResult(result, t);

      expect(toast.type).toBe("warning");
      expect(toast.message).toContain("4 row(s) failed");
      expect(toast.message).toContain("2× belongs to another account");
      expect(toast.message).toContain("1× missing hotel reference");
      expect(toast.message).toContain("1× unexpected error");
    });

    it("separates reasons with commas when multiple codes are present", () => {
      const t = makeMockTranslate();
      const result: LodgingImportCommitResult = {
        batchId: "b1",
        createdLodgings: 1,
        createdStays: 1,
        skipped: 0,
        failed: [
          { sourceRowIndex: 0, code: "ownership_mismatch", error: "Belongs to another account" },
          {
            sourceRowIndex: 1,
            code: "missing_lodging_reference",
            error: "Missing lodging reference",
          },
        ],
      };

      const toast = describeLodgingCommitResult(result, t);

      expect(toast.message).toContain(", ");
      expect(toast.message).toMatch(
        /belongs to another account.*missing hotel reference|missing hotel reference.*belongs to another account/
      );
    });
  });

  describe("edge cases", () => {
    it("handles a partial commit with only failures and zero creates", () => {
      const t = makeMockTranslate();
      const result: LodgingImportCommitResult = {
        batchId: "b1",
        createdLodgings: 0,
        createdStays: 0,
        skipped: 0,
        failed: [
          { sourceRowIndex: 0, code: "ownership_mismatch", error: "All rows failed" },
          { sourceRowIndex: 1, code: "ownership_mismatch", error: "All rows failed" },
        ],
      };

      const toast = describeLodgingCommitResult(result, t);

      expect(toast.type).toBe("warning");
      expect(toast.message).toContain("0 hotel");
      expect(toast.message).toContain("0 stay");
      expect(toast.message).toContain("2 row(s) failed");
    });

    it("never uses the error string in the message (only the code)", () => {
      const t = makeMockTranslate();
      const result: LodgingImportCommitResult = {
        batchId: "b1",
        createdLodgings: 1,
        createdStays: 1,
        skipped: 0,
        failed: [
          {
            sourceRowIndex: 0,
            code: "unexpected_error",
            error: "This is a very specific technical error message that should not appear",
          },
        ],
      };

      const toast = describeLodgingCommitResult(result, t);

      expect(toast.message).not.toContain("This is a very specific technical error message");
      expect(toast.message).toContain("unexpected error");
    });
  });
});
