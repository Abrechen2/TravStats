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
});
