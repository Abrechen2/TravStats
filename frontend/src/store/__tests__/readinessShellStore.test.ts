import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook } from "@testing-library/react";

import { fetchReadiness, fetchReadinessAttention } from "../../lib/api/readiness";
import { FOCUS_REFRESH_MIN_MS, useReadinessShellStore } from "../readinessShellStore";
import { useReadinessRefresh } from "../../hooks/useReadinessRefresh";

vi.mock("../../lib/api/readiness", () => ({
  fetchReadiness: vi.fn(),
  fetchReadinessAttention: vi.fn(),
}));

const answer = (show: boolean) =>
  ({
    invitation: { show, reason: show ? "update" : null, snoozedUntil: null, keys: [] },
    banner: { show: false, itemIds: [] },
    summary: { required: 0, recommended: 2, unknown: 0, newNotes: 0, blockedByAdmin: 0, ready: 0 },
  }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  useReadinessShellStore.getState().reset();
  vi.mocked(fetchReadiness).mockResolvedValue(answer(true));
  vi.mocked(fetchReadinessAttention).mockResolvedValue({ problem: 0, warning: 2 });
});

describe("the header's attention counts", () => {
  it("come from the same read as the card: one evaluation per refresh, not two (Codex, rc.45)", async () => {
    await useReadinessShellStore.getState().refresh();
    expect(fetchReadiness).toHaveBeenCalledTimes(1);
    expect(fetchReadinessAttention).not.toHaveBeenCalled();
    expect(useReadinessShellStore.getState().attention).toEqual({ problem: 0, warning: 2 });
  });

  it("keeps the dot and the card when a read fails", async () => {
    await useReadinessShellStore.getState().refresh();
    vi.mocked(fetchReadiness).mockRejectedValueOnce(new Error("down"));
    await useReadinessShellStore.getState().refresh();
    expect(useReadinessShellStore.getState().invitation?.show).toBe(true);
    expect(useReadinessShellStore.getState().attention).toEqual({ problem: 0, warning: 2 });
  });
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
