import { describe, expect, it, vi, beforeEach } from "vitest";
import { commitPlaceImport, previewPlaceImport, resolvePlaceImport } from "../placeImport";
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

  it("starts the Takeout resolution as a job and resolves with its result (#358)", async () => {
    const resolution = {
      listCountry: "JP",
      trip: null,
      tripReason: "no_trip",
      googleConfigured: false,
      rows: [],
    };
    mockedApi.post.mockResolvedValue({ data: { success: true, data: { jobId: "job-1" } } });
    mockedApi.get.mockResolvedValue({
      data: {
        success: true,
        data: {
          id: "job-1",
          kind: "placeImport.resolve",
          status: "succeeded",
          startedAt: "2026-10-10T00:00:00Z",
          finishedAt: "2026-10-10T00:00:01Z",
          result: resolution,
          error: null,
          progress: { done: 1, total: 1 },
        },
      },
    });
    const onProgress = vi.fn();

    const result = await resolvePlaceImport(
      "Japan.csv",
      [{ sourceRowIndex: 0, name: "Invented", externalRef: "gmaps:1" }],
      onProgress
    );

    expect(mockedApi.post).toHaveBeenCalledWith("/place-import/resolve", {
      listName: "Japan.csv",
      rows: [{ sourceRowIndex: 0, name: "Invented", externalRef: "gmaps:1" }],
    });
    expect(mockedApi.get).toHaveBeenCalledWith("/jobs/job-1");
    expect(onProgress).toHaveBeenCalledWith({ done: 1, total: 1 });
    expect(result).toEqual(resolution);
  });
});
