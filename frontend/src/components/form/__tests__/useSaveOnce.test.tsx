/**
 * forgejo#247: a failed reload after a successful create must not read as a
 * failed save, and must not let the next click create the record again.
 */
import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useSaveOnce } from "../useSaveOnce";

vi.mock("../../../lib/logger", () => ({ logger: { error: vi.fn() } }));

describe("useSaveOnce", () => {
  it("sends one request for a double click", async () => {
    const { result } = renderHook(() => useSaveOnce<{ id: string }>());
    let resolve: (value: { id: string }) => void = () => undefined;
    const api = vi.fn(() => new Promise<{ id: string }>((r) => (resolve = r)));

    let first: Promise<unknown> = Promise.resolve();
    let second: Promise<unknown> = Promise.resolve();
    act(() => {
      first = result.current.save(api);
      second = result.current.save(api);
    });
    await act(async () => {
      resolve({ id: "1" });
      await first;
    });
    expect(api).toHaveBeenCalledTimes(1);
    await expect(second).resolves.toEqual({ status: "skipped" });
    expect(result.current.saved).toEqual({ id: "1" });
  });

  it("returns the refusal and allows another try when the request fails", async () => {
    const { result } = renderHook(() => useSaveOnce<{ id: string }>());
    const api = vi
      .fn<() => Promise<{ id: string }>>()
      .mockRejectedValueOnce(new Error("503"))
      .mockResolvedValueOnce({ id: "1" });

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.save(api);
    });
    expect(outcome).toEqual({ status: "failed", error: expect.any(Error) });
    expect(result.current.saved).toBeNull();
    expect(result.current.saving).toBe(false);

    await act(async () => {
      outcome = await result.current.save(api);
    });
    expect(outcome).toEqual({ status: "saved", value: { id: "1" } });
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("a failed follow-up is not a refusal, and the next click sends nothing", async () => {
    const { result } = renderHook(() => useSaveOnce<{ id: string }>());
    const api = vi.fn().mockResolvedValue({ id: "1" });
    const onSaved = vi.fn().mockRejectedValue(new Error("reload failed"));

    let outcome: unknown;
    await act(async () => {
      outcome = await result.current.save(api, onSaved);
    });
    expect(outcome).toMatchObject({ status: "savedButAfterFailed", value: { id: "1" } });
    expect(result.current.afterSaveFailed).toBe(true);
    expect(result.current.saved).toEqual({ id: "1" });

    await act(async () => {
      outcome = await result.current.save(api, onSaved);
    });
    expect(outcome).toEqual({ status: "skipped" });
    expect(api).toHaveBeenCalledTimes(1);
  });

  it("reset() forgets the earlier success, so the next save sends again", async () => {
    const { result } = renderHook(() => useSaveOnce<{ id: string }>());
    const api = vi.fn().mockResolvedValue({ id: "1" });
    await act(async () => {
      await result.current.save(api);
    });
    act(() => result.current.reset());
    expect(result.current.saved).toBeNull();
    await act(async () => {
      await result.current.save(api);
    });
    expect(api).toHaveBeenCalledTimes(2);
  });
});

describe("useSaveOnce — the after-save notice", () => {
  it("speaks of the list by default, and of whatever the caller names otherwise", () => {
    const list = renderHook(() => useSaveOnce<string>());
    expect(list.result.current.afterSaveFailedKey).toBe("common:form.savedButRefreshFailed");
    const detail = renderHook(() =>
      useSaveOnce<string>({ afterSaveFailedKey: "common:form.savedButViewRefreshFailed" })
    );
    expect(detail.result.current.afterSaveFailedKey).toBe("common:form.savedButViewRefreshFailed");
  });
});

// Fix round 2: the reset on re-open happens in the render that opens, and a
// save still running across a close/re-open cannot mark the new opening done.
describe("useSaveOnce — re-opening", () => {
  it("is clean in the very render that re-opens", async () => {
    const api = vi.fn().mockResolvedValue("1");
    const { result, rerender } = renderHook(({ open }) => useSaveOnce<string>({ open }), {
      initialProps: { open: true },
    });
    await act(async () => {
      await result.current.save(api);
    });
    expect(result.current.saved).toBe("1");
    rerender({ open: false });
    rerender({ open: true });
    expect(result.current.saved).toBeNull();
    await act(async () => {
      await result.current.save(api);
    });
    expect(api).toHaveBeenCalledTimes(2);
  });

  it("a save that settles after a re-open does not mark the new opening as saved", async () => {
    let resolve: (value: string) => void = () => undefined;
    const api = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => new Promise<string>((r) => (resolve = r)))
      .mockResolvedValue("2");
    const { result, rerender } = renderHook(({ open }) => useSaveOnce<string>({ open }), {
      initialProps: { open: true },
    });
    let first: Promise<unknown> = Promise.resolve();
    act(() => {
      first = result.current.save(api);
    });
    rerender({ open: false });
    rerender({ open: true });
    await act(async () => {
      resolve("1");
      await first;
    });
    expect(result.current.saved).toBeNull();
    expect(result.current.saving).toBe(false);
    await act(async () => {
      await result.current.save(api);
    });
    expect(api).toHaveBeenCalledTimes(2);
    expect(result.current.saved).toBe("2");
  });

  it("a manual reset() during a save keeps the second click out until the first settles", async () => {
    let resolve: (value: string) => void = () => undefined;
    const api = vi
      .fn<() => Promise<string>>()
      .mockImplementationOnce(() => new Promise<string>((r) => (resolve = r)))
      .mockResolvedValue("2");
    const { result } = renderHook(() => useSaveOnce<string>());
    let first: Promise<unknown> = Promise.resolve();
    act(() => {
      first = result.current.save(api);
    });
    act(() => result.current.reset());
    let second: unknown;
    await act(async () => {
      second = await result.current.save(api);
    });
    expect(second).toEqual({ status: "skipped" });
    expect(result.current.saving).toBe(true);
    await act(async () => {
      resolve("1");
      await first;
    });
    await act(async () => {
      await result.current.save(api);
    });
    expect(api).toHaveBeenCalledTimes(2);
  });
});
