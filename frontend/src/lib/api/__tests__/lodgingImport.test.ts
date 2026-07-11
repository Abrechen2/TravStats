import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  commitLodgingImport,
  listLodgingImportBatches,
  previewLodgingImport,
  revertLodgingImportBatch,
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

  it("lists batches and unwraps the envelope", async () => {
    mockedApi.get.mockResolvedValue({
      data: {
        success: true,
        data: [
          {
            id: "b1",
            source: "csv",
            fileName: "places.csv",
            createdAt: "2026-07-01T00:00:00.000Z",
            lodgingCount: 2,
            stayCount: 3,
          },
        ],
      },
    });

    const result = await listLodgingImportBatches();

    expect(mockedApi.get).toHaveBeenCalledWith("/lodging-import/batches");
    expect(result).toHaveLength(1);
    expect(result[0].lodgingCount).toBe(2);
  });

  // The backend deletes only what the batch created — a batch-created
  // lodging with foreign stays survives, detached, rather than deleted. The
  // revert result carries all THREE counters so the UI can render
  // "3 gelöscht, 1 behalten" instead of the older two-counter shape.
  it("deletes a batch and returns all three revert counters", async () => {
    mockedApi.delete.mockResolvedValue({
      data: { success: true, data: { deletedLodgings: 2, deletedStays: 3, detachedLodgings: 1 } },
    });
    const result = await revertLodgingImportBatch("b1");
    expect(mockedApi.delete).toHaveBeenCalledWith("/lodging-import/batches/b1");
    expect(result.deletedStays).toBe(3);
    expect(result.deletedLodgings).toBe(2);
    expect(result.detachedLodgings).toBe(1);
  });

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
