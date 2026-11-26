import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";

import { nextInterval, useVisiblePolling } from "../useVisiblePolling";

/**
 * Perf audit 2026-11, item 11: the inbox counters polled every 30 s in every
 * tab, hidden ones included (about 23k requests a day per forgotten tab).
 */
let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers();
  visibility = "visible";
  vi.spyOn(document, "visibilityState", "get").mockImplementation(() => visibility);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const OPTS = { intervalMs: 30_000, maxIntervalMs: 300_000 };

async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("useVisiblePolling", () => {
  it("polls at once and then every interval while visible", async () => {
    const poll = vi.fn().mockResolvedValue(true);
    renderHook(() => useVisiblePolling(poll, OPTS, []));
    await advance(0);
    expect(poll).toHaveBeenCalledTimes(1);
    await advance(30_000);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("skips hidden tabs and polls again when the tab comes back", async () => {
    const poll = vi.fn().mockResolvedValue(true);
    renderHook(() => useVisiblePolling(poll, OPTS, []));
    await advance(0);
    visibility = "hidden";
    await advance(10 * 60_000);
    expect(poll).toHaveBeenCalledTimes(1);
    visibility = "visible";
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await advance(0);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("backs off after failed rounds and recovers after a good one", () => {
    expect(nextInterval(30_000, false, OPTS)).toBe(60_000);
    expect(nextInterval(240_000, false, OPTS)).toBe(300_000);
    expect(nextInterval(300_000, true, OPTS)).toBe(30_000);
  });

  it("waits the doubled interval after a failed round", async () => {
    const poll = vi.fn().mockResolvedValue(false);
    renderHook(() => useVisiblePolling(poll, OPTS, []));
    await advance(0);
    await advance(30_000);
    expect(poll).toHaveBeenCalledTimes(1);
    await advance(30_000);
    expect(poll).toHaveBeenCalledTimes(2);
  });

  it("does not poll when disabled (signed out)", async () => {
    const poll = vi.fn().mockResolvedValue(true);
    renderHook(() => useVisiblePolling(poll, { ...OPTS, enabled: false }, []));
    await advance(60_000);
    expect(poll).not.toHaveBeenCalled();
  });
});
