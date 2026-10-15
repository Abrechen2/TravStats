import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { PlanView } from "../../../lib/api/travplan";
import { usePlan } from "../usePlan";
import { planFixture, deferred } from "./planFixture";
const mocks = vi.hoisted(() => ({ get: vi.fn(), write: vi.fn(), t: (key: string) => key }));
vi.mock("../../../lib/api/travplan", () => ({
  travplanApi: { get: mocks.get, write: mocks.write },
}));
vi.mock("../../../hooks/useTranslation", () => ({ useTranslation: () => ({ t: mocks.t }) }));
beforeEach(() => {
  mocks.get.mockReset();
  mocks.write.mockReset();
});
describe("travel-plan request lifecycle", () => {
  it("does not replace the next trip with a late response for the previous one", async () => {
    const old = deferred<PlanView>();
    const next = planFixture("trip-two");
    mocks.get.mockReturnValueOnce(old.promise).mockResolvedValueOnce(next);
    const { result, rerender } = renderHook(({ id }) => usePlan(id), {
      initialProps: { id: "trip-one" },
    });
    rerender({ id: "trip-two" });
    await waitFor(() => expect(result.current.plan).toEqual(next));
    await act(async () => old.resolve(planFixture()));
    expect(result.current.plan).toEqual(next);
  });
  it("sends one write while a save is pending and accepts its new revision", async () => {
    const plan = planFixture();
    const saved = planFixture("trip-one", 2);
    const pending = deferred<PlanView>();
    mocks.get.mockResolvedValue(plan);
    mocks.write.mockReturnValue(pending.promise);
    const { result } = renderHook(() => usePlan("trip-one"));
    await waitFor(() => expect(result.current.plan).toEqual(plan));
    let first!: Promise<boolean>;
    act(() => {
      first = result.current.mutate({ type: "handover" });
    });
    expect(result.current.busy).toBe(true);
    let duplicate = true;
    await act(async () => {
      duplicate = await result.current.mutate({ type: "handover" });
    });
    expect(duplicate).toBe(false);
    expect(mocks.write).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(saved);
      await first;
    });
    expect(await first).toBe(true);
    expect(result.current.plan?.revision).toBe(2);
    expect(result.current.busy).toBe(false);
  });
  it("reports a version conflict and reloads the server state without claiming a save", async () => {
    const plan = planFixture();
    const fresh = planFixture("trip-one", 3);
    mocks.get.mockResolvedValueOnce(plan).mockResolvedValueOnce(fresh);
    mocks.write.mockRejectedValue({
      response: { status: 409, data: { error: { code: "PLAN_CONFLICT" } } },
    });
    const { result } = renderHook(() => usePlan("trip-one"));
    await waitFor(() => expect(result.current.plan).toEqual(plan));
    let saved = true;
    await act(async () => {
      saved = await result.current.mutate({ type: "handover" });
    });
    expect(saved).toBe(false);
    expect(result.current.plan).toEqual(fresh);
    expect(result.current.error).toBe("errors.PLAN_CONFLICT");
    expect(result.current.busy).toBe(false);
  });
  it("keeps the last readable plan after a network error and allows an explicit retry", async () => {
    const plan = planFixture();
    mocks.get.mockResolvedValue(plan);
    mocks.write
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(planFixture("trip-one", 2));
    const { result } = renderHook(() => usePlan("trip-one"));
    await waitFor(() => expect(result.current.plan).toEqual(plan));
    await act(async () => {
      expect(await result.current.mutate({ type: "handover" })).toBe(false);
    });
    expect(result.current.plan).toEqual(plan);
    expect(result.current.error).toBe("errors.unknown");
    await act(async () => {
      expect(await result.current.mutate({ type: "handover" })).toBe(true);
    });
    expect(result.current.plan?.revision).toBe(2);
    expect(result.current.error).toBe("");
  });
  it("ignores a completed write after the page has unmounted", async () => {
    const plan = planFixture();
    const pending = deferred<PlanView>();
    mocks.get.mockResolvedValue(plan);
    mocks.write.mockReturnValue(pending.promise);
    const { result, unmount } = renderHook(() => usePlan("trip-one"));
    await waitFor(() => expect(result.current.plan).toEqual(plan));
    let write!: Promise<boolean>;
    act(() => {
      write = result.current.mutate({ type: "handover" });
    });
    unmount();
    pending.resolve(planFixture("trip-one", 2));
    expect(await write).toBe(false);
  });
});
