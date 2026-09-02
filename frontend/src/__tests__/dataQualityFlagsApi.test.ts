import { describe, expect, it, vi, beforeEach } from "vitest";

/**
 * The URLs, pinned.
 *
 * `resolve` and `dismiss` are two answers with two different consequences —
 * one re-opens on the next run, the other never does. A copy-paste that pointed
 * both at `/dismiss` would still render two differently-labelled buttons and
 * would still show a success toast, so nothing above this layer can see it.
 */

const get = vi.fn();
const post = vi.fn();

vi.mock("../lib/api/client", () => ({
  api: {
    get: (...args: unknown[]) => get(...args),
    post: (...args: unknown[]) => post(...args),
  },
}));

import { dataQualityFlagsApi } from "../lib/api/dataQualityFlags";

describe("dataQualityFlagsApi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({ data: { flags: [], count: 0 } });
    post.mockResolvedValue({ data: { success: true } });
  });

  it("lists flags with the status/kind filter as query params", async () => {
    await dataQualityFlagsApi.getAll({ status: "all", kind: "stay_dates_reversed" });
    expect(get).toHaveBeenCalledWith("/data-quality-flags", {
      params: { status: "all", kind: "stay_dates_reversed" },
    });
  });

  it("posts a correction report to /resolve", async () => {
    await dataQualityFlagsApi.resolve("abc");
    expect(post).toHaveBeenCalledWith("/data-quality-flags/abc/resolve");
  });

  it("posts a 'this is not wrong' to /dismiss", async () => {
    await dataQualityFlagsApi.dismiss("abc");
    expect(post).toHaveBeenCalledWith("/data-quality-flags/abc/dismiss");
  });

  it("re-runs the checks via /run", async () => {
    post.mockResolvedValue({
      data: { opened: 0, reopened: 0, updated: 0, autoResolved: 0, open: 0 },
    });
    await dataQualityFlagsApi.run();
    expect(post).toHaveBeenCalledWith("/data-quality-flags/run");
  });
});
