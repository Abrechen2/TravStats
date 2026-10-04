import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const { get, put } = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("../../lib/api/webPrefs", () => ({ webPrefsApi: { get, put } }));

import { useWebPrefsSync } from "../useWebPrefsSync";
import { useThemeStore } from "../../store/themeStore";

/**
 * The hook's half of forgejo#200: the sync runs only for a confirmed,
 * non-demo session (the caller passes null otherwise) and stops sending the
 * moment the account is gone.
 */
describe("useWebPrefsSync", () => {
  beforeEach(() => {
    window.localStorage.clear();
    useThemeStore.setState({ mapTheme: "glassmorphism" });
    get.mockReset().mockResolvedValue({ sections: {}, updatedAt: null });
    put.mockReset().mockImplementation(async (sections: Record<string, unknown>) => ({
      sections,
      updatedAt: null,
      stale: [],
      dropped: [],
    }));
  });
  afterEach(() => vi.useRealTimers());

  it("does nothing without a user", async () => {
    renderHook(() => useWebPrefsSync(null));
    await act(async () => undefined);
    expect(get).not.toHaveBeenCalled();
  });

  it("loads for a user, and sends nothing once the user is gone", async () => {
    vi.useFakeTimers();
    const { rerender } = renderHook(({ id }: { id: string | null }) => useWebPrefsSync(id), {
      initialProps: { id: "user-1" as string | null },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(get).toHaveBeenCalledTimes(1);

    rerender({ id: null });
    act(() => useThemeStore.getState().setMapTheme("classic"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(put).not.toHaveBeenCalled();
  });

  it("sends a change at once when the tab is hidden", async () => {
    vi.useFakeTimers();
    renderHook(() => useWebPrefsSync("user-1"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    act(() => useThemeStore.getState().setMapTheme("classic"));

    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
    });
    visibility.mockRestore();
    expect(put).toHaveBeenCalledTimes(1);
    expect(put.mock.calls[0][0]).toMatchObject({ theme: { value: { mapTheme: "classic" } } });
  });
});
