import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  commitLodgingImport,
  previewLodgingImport,
  suggestLodgingCsvMapping,
} from "../lodgingImport";
import { api } from "../client";

vi.mock("../client", () => ({
  api: { post: vi.fn(), get: vi.fn(), delete: vi.fn() },
  parserApi: { post: vi.fn() },
}));

const mockedApi = vi.mocked(api);

describe("lodgingImport api client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts candidates to /lodging-import/preview and unwraps the envelope", async () => {
    mockedApi.post.mockResolvedValue({
      data: {
        success: true,
        data: { rows: [], summary: { newRows: 0, alreadyPresent: 0, needsInput: 0 } },
      },
    });

    const result = await previewLodgingImport([
      { sourceRowIndex: 0, lodging: { name: "X" }, stay: null },
    ]);

    expect(mockedApi.post).toHaveBeenCalledWith("/lodging-import/preview", {
      candidates: [{ sourceRowIndex: 0, lodging: { name: "X" }, stay: null }],
    });
    expect(result.summary.newRows).toBe(0);
  });

  it("posts source, fileName and rows to /lodging-import/commit and mirrors the failure code", async () => {
    mockedApi.post.mockResolvedValue({
      data: {
        success: true,
        data: {
          batchId: "b1",
          createdLodgings: 1,
          createdStays: 0,
          skipped: 0,
          failed: [
            { sourceRowIndex: 2, code: "ownership_mismatch", error: "not yours" },
          ],
        },
      },
    });

    const result = await commitLodgingImport("csv", "places.csv", [
      { sourceRowIndex: 0, action: "create", lodging: { name: "X" }, stay: null },
    ]);

    expect(mockedApi.post).toHaveBeenCalledWith("/lodging-import/commit", {
      source: "csv",
      fileName: "places.csv",
      rows: [{ sourceRowIndex: 0, action: "create", lodging: { name: "X" }, stay: null }],
    });
    expect(result.batchId).toBe("b1");
    expect(result.failed[0].code).toBe("ownership_mismatch");
  });

  // The batch list and the revert moved to `lib/api/importBatches.ts` when
  // flights and cruises started recording their imports too — their tests
  // moved with them. What stays here is the lodging-specific half: preview,
  // commit, and the mapping suggestion.

  it("resolves to {} when the mapping suggestion fails — it never rejects", async () => {
    mockedApi.post.mockRejectedValue(new Error("ollama down"));
    const mapping = await suggestLodgingCsvMapping(["Hotel"], [{ Hotel: "NH" }]);
    expect(mapping).toEqual({});
  });

  it("resolves the mapping suggestion payload on success", async () => {
    mockedApi.post.mockResolvedValue({
      data: { success: true, data: { mapping: { Hotel: "name" } } },
    });
    const mapping = await suggestLodgingCsvMapping(["Hotel"], [{ Hotel: "NH" }]);
    expect(mapping).toEqual({ Hotel: "name" });
  });
});
