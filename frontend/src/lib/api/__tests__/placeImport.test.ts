import { describe, expect, it, vi, beforeEach } from "vitest";
import { commitPlaceImport, previewPlaceImport } from "../placeImport";
import { api } from "../client";

vi.mock("../client", () => ({
  api: { post: vi.fn(), get: vi.fn(), delete: vi.fn() },
  parserApi: { post: vi.fn() },
}));

const mockedApi = vi.mocked(api);

describe("placeImport api client", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts candidates to /place-import/preview and unwraps the envelope", async () => {
    mockedApi.post.mockResolvedValue({
      data: {
        success: true,
        data: { rows: [], summary: { newRows: 0, alreadyPresent: 0, needsInput: 0 } },
      },
    });

    const result = await previewPlaceImport([
      { sourceRowIndex: 0, name: "Colosseo", lat: 41.89, lon: 12.49 },
    ]);

    expect(mockedApi.post).toHaveBeenCalledWith("/place-import/preview", {
      candidates: [{ sourceRowIndex: 0, name: "Colosseo", lat: 41.89, lon: 12.49 }],
    });
    expect(result.summary.newRows).toBe(0);
  });

  it("posts source, fileName and rows to /place-import/commit and mirrors the failure code", async () => {
    mockedApi.post.mockResolvedValue({
      data: {
        success: true,
        data: {
          batchId: "b1",
          created: 1,
          skipped: 1,
          failed: [{ sourceRowIndex: 2, code: "no_position", error: "…" }],
        },
      },
    });

    const result = await commitPlaceImport("csv", "orte.csv", [
      { sourceRowIndex: 0, name: "Colosseo", lat: 41.89, lon: 12.49 },
    ]);

    expect(mockedApi.post).toHaveBeenCalledWith("/place-import/commit", {
      source: "csv",
      fileName: "orte.csv",
      rows: [{ sourceRowIndex: 0, name: "Colosseo", lat: 41.89, lon: 12.49 }],
    });
    expect(result.created).toBe(1);
    expect(result.skipped).toBe(1);
    expect(result.failed[0].code).toBe("no_position");
  });
});
