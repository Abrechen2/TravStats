import { describe, expect, it } from "vitest";
import { describePlaceCommitResult } from "../placeImportResult";

/**
 * #358: rows written as trip stops or recognised as the user's stays are not
 * places, so a toast that only counted places would read "0 created" over an
 * import that did work.
 */
const t = (key: string, options?: Record<string, unknown>): string =>
  options ? `${key}${JSON.stringify(options)}` : key;

describe("describePlaceCommitResult", () => {
  it("mentions trip stops and matched stays next to the places", () => {
    const toast = describePlaceCommitResult(
      { batchId: "b", created: 2, skipped: 0, stops: 3, matchedStays: 1, failed: [] },
      t
    );
    expect(toast.type).toBe("success");
    expect(toast.message).toContain('takeoutExtra{"stops":3,"stays":1}');
  });

  it("says nothing extra for a plain place import", () => {
    const toast = describePlaceCommitResult(
      { batchId: "b", created: 2, skipped: 0, stops: 0, matchedStays: 0, failed: [] },
      t
    );
    expect(toast.message).not.toContain("takeoutExtra");
  });

  it("names a refused trip or stay as its own reason", () => {
    const toast = describePlaceCommitResult(
      {
        batchId: "b",
        created: 0,
        skipped: 0,
        stops: 0,
        matchedStays: 0,
        failed: [{ sourceRowIndex: 0, code: "invalid_target", error: "x" }],
      },
      t
    );
    expect(toast.type).toBe("warning");
    expect(toast.message).toContain("failureCodes.invalid_target");
  });
});
