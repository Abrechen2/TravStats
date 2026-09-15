import { describe, it, expect, vi, beforeEach } from "vitest";

// The trip AI summary calls Ollama, which routinely takes >10s. It must NOT use
// the 10s DEFAULT axios timeout (that aborts the request while the backend is
// still generating — the user sees an error toast even though it succeeds
// server-side). It must use the long PARSER timeout. (regression: trip summary
// timed out on prod)
const { postMock } = vi.hoisted(() => ({
  postMock: vi.fn().mockResolvedValue({ data: { summary: "x", model: "m", durationMs: 1 } }),
}));
vi.mock("../client", () => ({
  api: { post: postMock, get: vi.fn(), patch: vi.fn(), delete: vi.fn() },
}));

import { tripsApi } from "../trips";
import { API_TIMEOUTS } from "../../../config/constants";

describe("tripsApi.summarize", () => {
  beforeEach(() => postMock.mockClear());

  it("uses the long PARSER timeout, not the 10s default", async () => {
    await tripsApi.summarize("t1", "en");
    // The reader's language travels in the body (since 2026-09-05 the server
    // writes in it instead of German for everyone).
    expect(postMock).toHaveBeenCalledWith(
      "/trips/t1/summarize",
      { language: "en" },
      { timeout: API_TIMEOUTS.PARSER }
    );
    // guard the intent: PARSER must comfortably exceed a slow LLM generation
    expect(API_TIMEOUTS.PARSER).toBeGreaterThanOrEqual(60000);
  });
});
