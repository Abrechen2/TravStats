import { describe, expect, it } from "vitest";
import {
  bulkEditGaps,
  bulkEditPreview,
  bulkEditRequest,
  emptyBulkEditDraft,
} from "../bulkEditModel";
import { BULK_FIELDS } from "../../../shared/bulkEditFields";
import type { BulkRow } from "../useRowSelection";

const row = (over: Partial<BulkRow>): BulkRow => ({ id: "a", label: "A", ...over });

describe("bulk edit model", () => {
  it("is not ready until a field is chosen, and only counts the domain's own fields", () => {
    const draft = { ...emptyBulkEditDraft(), tags: { mode: "add" as const, values: ["x"] } };
    expect(bulkEditGaps(emptyBulkEditDraft(), BULK_FIELDS.rail)).toEqual(["nothing"]);
    expect(bulkEditGaps(draft, BULK_FIELDS.rail)).toEqual([]);
    // A stay has no tags: the same draft is still "nothing" for it.
    expect(bulkEditGaps(draft, BULK_FIELDS.stay)).toContain("nothing");
  });

  it("asks for the value of every mode that needs one", () => {
    const draft = {
      ...emptyBulkEditDraft(),
      trip: { mode: "set" as const, tripId: "" },
      operator: { mode: "set" as const, value: " " },
      companions: { mode: "add" as const, values: [] },
    };
    expect(bulkEditGaps(draft, BULK_FIELDS.rail).sort()).toEqual([
      "companions",
      "operator",
      "trip",
    ]);
  });

  it("builds the request from the rows' versions and leaves out fields the domain lacks", () => {
    const draft = {
      ...emptyBulkEditDraft(),
      status: { mode: "cancel" as const },
      operator: { mode: "set" as const, value: " DB " },
    };
    const rows = [row({ id: "a", updatedAt: "2026-01-01T00:00:00.000Z" }), row({ id: "b" })];
    expect(bulkEditRequest(draft, BULK_FIELDS.rail, rows)).toEqual({
      ids: ["a", "b"],
      baseVersions: { a: "2026-01-01T00:00:00.000Z" },
      status: { mode: "cancel" },
      operator: { mode: "set", value: "DB" },
    });
    expect(bulkEditRequest(draft, BULK_FIELDS.cruise, rows)).not.toHaveProperty("operator");
  });

  it("counts what changes and what already is as asked", () => {
    const rows = [
      row({ id: "a", tripId: "t1", tags: ["x"], status: "cancelled" }),
      row({ id: "b", tripId: null, tags: [], status: "completed" }),
    ];
    const preview = bulkEditPreview(
      {
        ...emptyBulkEditDraft(),
        trip: { mode: "set", tripId: "t1" },
        tags: { mode: "add", values: ["x"] },
        status: { mode: "cancel" },
      },
      rows
    );
    expect(preview.trip).toEqual({ kind: "set", gain: 1, replace: 0, already: 1 });
    expect(preview.tags).toMatchObject({ change: 1, already: 1 });
    expect(preview.status).toEqual({ mode: "cancel", change: 1, already: 1 });
    const reinstated = bulkEditPreview(
      { ...emptyBulkEditDraft(), status: { mode: "reinstate" } },
      rows
    );
    expect(reinstated.status).toEqual({ mode: "reinstate", change: 1, already: 1 });
  });
});
