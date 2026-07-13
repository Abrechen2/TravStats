import { describe, expect, it } from "vitest";
import { withFallback } from "../src/cache.js";

const NOW = new Date("2026-07-13T12:00:00Z");

describe("withFallback", () => {
  it("uses fresh data and reports no staleness", () => {
    const out = withFallback({ ok: true, data: { n: 1 } }, undefined, NOW);
    expect(out.data).toEqual({ n: 1 });
    expect(out.staleSince).toBeNull();
    expect(out.reason).toBeNull();
  });

  it("falls back to the cache and reports WHEN it was collected", () => {
    const out = withFallback(
      { ok: false, reason: "ssh timeout" },
      { data: { n: 7 }, collectedAt: "2026-07-13T09:00:00Z" },
      NOW
    );
    expect(out.data).toEqual({ n: 7 });
    expect(out.staleSince).toBe("2026-07-13T09:00:00Z");
    expect(out.reason).toBe("ssh timeout");
  });

  it("returns null data — never a silent empty — when the collector fails with no cache", () => {
    const out = withFallback({ ok: false, reason: "gh not logged in" }, undefined, NOW);
    expect(out.data).toBeNull();
    expect(out.reason).toBe("gh not logged in");
  });
});
