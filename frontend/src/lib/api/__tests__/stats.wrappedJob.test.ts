import { describe, expect, it, vi } from "vitest";

const get = vi.hoisted(() => vi.fn());
vi.mock("../client", () => ({ api: { get } }));

import { statsApi } from "../stats";

/**
 * UAT rc.45 M1: the year in review took longer than the 10 s client timeout on
 * a large account. A slow story now answers 202 with a job id, and the client
 * polls the job instead of reporting a failure.
 */
describe("statsApi.getWrapped — a slow story is polled as a job", () => {
  it("follows a 202 to the job's result", async () => {
    get.mockImplementation(async (url: string) => {
      if (url === "/stats/wrapped") return { status: 202, data: { jobId: "j1" } };
      if (url === "/jobs/j1") {
        return {
          status: 200,
          data: { success: true, data: { status: "succeeded", result: { year: 2025 } } },
        };
      }
      throw new Error(`unexpected ${url}`);
    });
    await expect(statsApi.getWrapped()).resolves.toEqual({ year: 2025 });
  });

  it("returns a quick story directly", async () => {
    get.mockResolvedValue({ status: 200, data: { year: 2024 } });
    await expect(statsApi.getWrapped(2024)).resolves.toEqual({ year: 2024 });
  });
});
