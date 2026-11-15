import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { fetchReadiness } from "../../lib/api/readiness";
import { FOCUS_REFRESH_MIN_MS, useReadinessShellStore } from "../readinessShellStore";
import { useReadinessRefresh } from "../../hooks/useReadinessRefresh";

vi.mock("../../lib/api/readiness", () => ({ fetchReadiness: vi.fn() }));

const answer = (show: boolean) =>
  ({
    invitation: { show, reason: show ? "update" : null, snoozedUntil: null, keys: [] },
    banner: { show: false, itemIds: [] },
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  useReadinessShellStore.getState().reset();
  vi.mocked(fetchReadiness).mockResolvedValue(answer(true));
});

describe("readiness refresh rules", () => {
  it("reads once on login and never on a timer", async () => {
    vi.useFakeTimers();
    renderHook(() => useReadinessRefresh(true));
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
    vi.useRealTimers();
    expect(fetchReadiness).toHaveBeenCalledTimes(1);
  });

  it("does not read before the session is confirmed", () => {
    renderHook(() => useReadinessRefresh(false));
    expect(fetchReadiness).not.toHaveBeenCalled();
  });

  it("re-reads on focus only after ten minutes", async () => {
    const { refreshOnFocus, refresh } = useReadinessShellStore.getState();
    await refresh();
    const t0 = useReadinessShellStore.getState().lastReadAt!;
    await refreshOnFocus(t0 + FOCUS_REFRESH_MIN_MS - 1000);
    expect(fetchReadiness).toHaveBeenCalledTimes(1);
    await refreshOnFocus(t0 + FOCUS_REFRESH_MIN_MS + 1000);
    expect(fetchReadiness).toHaveBeenCalledTimes(2);
  });

  it("keeps what is shown when a read fails", async () => {
    await useReadinessShellStore.getState().refresh();
    vi.mocked(fetchReadiness).mockRejectedValueOnce(new Error("down"));
    await useReadinessShellStore.getState().refresh();
    expect(useReadinessShellStore.getState().invitation?.show).toBe(true);
  });

  it("lets only the newest read land", async () => {
    let first!: (v: never) => void;
    vi.mocked(fetchReadiness).mockImplementationOnce(
      () => new Promise((r) => (first = r as never))
    );
    const slow = useReadinessShellStore.getState().refresh();
    vi.mocked(fetchReadiness).mockResolvedValueOnce(answer(false));
    await useReadinessShellStore.getState().refresh();
    first(answer(true));
    await slow;
    expect(useReadinessShellStore.getState().invitation?.show).toBe(false);
  });
});
