import { describe, it, expect } from "vitest";
import {
  describeLodgingCommitResult,
  describeLodgingRevertResult,
  describeLodgingRowErrors,
} from "../lodgingImportResult";
import type {
  LodgingImportCommitResult,
  LodgingImportRevertResult,
} from "../../types/lodgingImport";

/**
 * Translation function stub — maps i18n keys to readable test labels.
 */
function makeMockTranslate() {
  const translations: Record<string, string> = {
    "lodging:units.hotels": "{{count}} hotel(s)",
    "lodging:units.stays": "{{count}} stay(s)",
    "lodging:units.rows": "{{count}} row(s)",
    "lodging:import.commitResult.success":
      "Imported {{hotels}} and {{stays}}, skipped {{skipped}} (already present).",
    "lodging:import.commitResult.partial":
      "Imported {{hotels}} and {{stays}}, skipped {{skipped}} (already present), {{rows}} failed: {{reasons}}",
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

/**
 * Translation function stub for the revert-result toast (Task 18b). Mirrors
 * the batch-list translations added to `lodging.json`'s `import.batches.*`
 * subtree.
 */
function makeMockRevertTranslate() {
  const translations: Record<string, string> = {
    "lodging:units.hotels": "{{count}} hotel(s)",
    "lodging:units.stays": "{{count}} stay(s)",
    "lodging:import.batches.revertResult.success": "{{hotels}} and {{stays}} deleted.",
    "lodging:import.batches.revertResult.withDetached":
      "{{hotels}} and {{stays}} deleted, {{kept}} kept (they have other stays).",
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

describe("describeLodgingRevertResult", () => {
  // The owner's revert semantics: a batch-created lodging with foreign stays
  // (hand-added, or attached by a later batch) survives, merely detached —
  // `detachedLodgings` is what lets the message honestly say "kept" instead
  // of silently losing that distinction. A result with `detachedLodgings > 0`
  // MUST read differently from one with 0.
  it("reports a clean revert (no detached lodgings) without a 'kept' clause", () => {
    const t = makeMockRevertTranslate();
    const result: LodgingImportRevertResult = {
      deletedLodgings: 3,
      deletedStays: 5,
      detachedLodgings: 0,
    };

    const toast = describeLodgingRevertResult(result, t);

    expect(toast.type).toBe("success");
    expect(toast.message).toContain("3 hotel");
    expect(toast.message).toContain("5 stay");
    expect(toast.message).not.toContain("kept");
  });

  it("reports the kept count when detachedLodgings > 0", () => {
    const t = makeMockRevertTranslate();
    const result: LodgingImportRevertResult = {
      deletedLodgings: 2,
      deletedStays: 4,
      detachedLodgings: 1,
    };

    const toast = describeLodgingRevertResult(result, t);

    expect(toast.type).toBe("success");
    expect(toast.message).toContain("2 hotel");
    expect(toast.message).toContain("4 stay");
    expect(toast.message).toContain("1 hotel");
    expect(toast.message).toContain("kept");
  });

  it("produces a message that visibly differs between detached>0 and detached=0", () => {
    const t = makeMockRevertTranslate();
    const clean = describeLodgingRevertResult(
      { deletedLodgings: 1, deletedStays: 1, detachedLodgings: 0 },
      t
    );
    const withDetached = describeLodgingRevertResult(
      { deletedLodgings: 1, deletedStays: 1, detachedLodgings: 1 },
      t
    );

    expect(clean.message).not.toBe(withDetached.message);
  });

  it("handles zero counts across the board without crashing", () => {
    const t = makeMockRevertTranslate();
    const toast = describeLodgingRevertResult(
      { deletedLodgings: 0, deletedStays: 0, detachedLodgings: 0 },
      t
    );

    expect(toast.type).toBe("success");
    expect(toast.message).toContain("0 hotel");
    expect(toast.message).toContain("0 stay");
  });
});

/**
 * `describeLodgingRowErrors` exists because of a real dead end: a stays CSV
 * whose every row was dropped produced "not a single row could be read" and
 * nothing else — no reason, no offending value, no way forward. The reason
 * was known all along (it sat in `rowErrors`); it just never reached the
 * user. These tests pin that it does now, and that the sentence names the
 * DOMINANT reason with a sample the user can compare against their file.
 */
function makeMockRowErrorTranslate() {
  const translations: Record<string, string> = {
    "lodging:import.errors.noRows": "Not a single row of this file could be read.",
    "lodging:import.errors.noRowsReason":
      "Not a single row of this file could be read — {{reason}}.",
    "lodging:import.errors.skippedRows": "{{count}} row(s) were skipped because of invalid values.",
    "lodging:import.errors.rowReasons.missing_name": "{{count}}× no hotel name",
    "lodging:import.errors.rowReasons.unreadable_date": "{{count}}× unreadable date",
    "lodging:import.errors.rowReasons.unreadable_number": "{{count}}× unreadable number",
    "lodging:import.errors.rowSample": ' (e.g. "{{sample}}" in row {{row}})',
  };

  return (key: string, options?: Record<string, unknown>): string => {
    let result = translations[key] ?? key;
    if (options) {
      Object.entries(options).forEach(([k, v]) => {
        result = result.split(`{{${k}}}`).join(String(v));
      });
    }
    return result;
  };
}

describe("describeLodgingRowErrors", () => {
  it("returns null when nothing went wrong", () => {
    const t = makeMockRowErrorTranslate();
    expect(describeLodgingRowErrors([], 3, t)).toBeNull();
  });

  it("names the dominant reason and a sample when EVERY row was dropped", () => {
    const t = makeMockRowErrorTranslate();
    const message = describeLodgingRowErrors(
      [
        { rowIndex: 0, code: "unreadable_date", message: "…", sample: "03/07/2026" },
        { rowIndex: 1, code: "unreadable_date", message: "…", sample: "04/07/2026" },
      ],
      0,
      t
    );

    expect(message).toContain("Not a single row");
    expect(message).toContain("2× unreadable date");
    // The sample points at the FIRST offending row, counted like a
    // spreadsheet: row 1 is the header, so data row index 0 is row 2.
    expect(message).toContain('"03/07/2026" in row 2');
  });

  it("lists every reason, most frequent first", () => {
    const t = makeMockRowErrorTranslate();
    const message = describeLodgingRowErrors(
      [
        { rowIndex: 0, code: "missing_name", message: "…" },
        { rowIndex: 1, code: "unreadable_date", message: "…", sample: "x" },
        { rowIndex: 2, code: "unreadable_date", message: "…", sample: "y" },
      ],
      0,
      t
    );

    expect(message).not.toBeNull();
    expect(message?.indexOf("2× unreadable date")).toBeLessThan(
      message?.indexOf("1× no hotel name") ?? -1
    );
  });

  it("keeps the softer skipped-rows wording when some rows survived", () => {
    const t = makeMockRowErrorTranslate();
    const message = describeLodgingRowErrors(
      [{ rowIndex: 4, code: "unreadable_number", message: "…", sample: "N/A" }],
      12,
      t
    );

    expect(message).toContain("1 row(s) were skipped");
    expect(message).not.toContain("Not a single row");
  });
});
