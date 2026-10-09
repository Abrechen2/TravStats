import { describe, it, expect, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useFlightSubmit } from "./useFlightSubmit";
import type { Airport } from "../../lib/api";

const airport = { iata: "MUC" } as Airport;

type OnSubmit = Parameters<typeof useFlightSubmit>[0]["onSubmit"];

function setup(onSubmit: (...args: unknown[]) => unknown, over: Record<string, unknown> = {}) {
  const deps = {
    t: (k: string) => k,
    departure: airport,
    arrival: airport,
    canSubmit: true,
    onSubmit: onSubmit as OnSubmit,
    buildFlightPayload: () => ({ flightNumber: "LH1" }) as never,
    storeHistoricalData: vi.fn(),
    maybeAssignTrip: vi.fn().mockResolvedValue(undefined),
    prepareReturnFlightForm: vi.fn(),
    afterReturnPrepared: vi.fn(),
    setLoading: vi.fn(),
    setError: vi.fn(),
    setDuplicateFlight: vi.fn(),
    setTimeEstimationWarning: vi.fn(),
    ...over,
  };
  return { deps, hook: renderHook(() => useFlightSubmit(deps)) };
}

const event = { preventDefault: () => {} } as React.FormEvent;
const networkError = Object.assign(new Error("Network Error"), { isAxiosError: true });

/** forgejo#247 — the create form's save: once, with a failure that remembers what it was. */
describe("useFlightSubmit", () => {
  it("sends one create for two clicks in the same frame", async () => {
    let settle: () => void = () => {};
    const onSubmit = vi.fn(() => new Promise<void>((r) => (settle = r)));
    const { hook } = setup(onSubmit);
    let first: Promise<void> = Promise.resolve();
    let second: Promise<void> = Promise.resolve();
    act(() => {
      first = hook.result.current.handleSubmit(event);
      second = hook.result.current.handleSubmit(event);
    });
    settle();
    await act(async () => {
      await first;
      await second;
    });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("keeps the failure's key, and a retry repeats the path that failed", async () => {
    const onSubmit = vi.fn().mockRejectedValueOnce(networkError).mockResolvedValueOnce(undefined);
    const { hook, deps } = setup(onSubmit);
    await act(() => hook.result.current.handleSubmitAndReturn(event));
    expect(hook.result.current.failure).toEqual({
      key: "common:saveErrors.network",
      field: null,
      variant: "saveAndReturn",
    });
    expect(deps.setError).toHaveBeenLastCalledWith("common:saveErrors.network");
    await act(() => hook.result.current.retry());
    expect(onSubmit).toHaveBeenLastCalledWith({ flightNumber: "LH1" }, { hasMoreFlights: true });
    expect(deps.prepareReturnFlightForm).toHaveBeenCalledTimes(1);
    expect(hook.result.current.failure).toBeNull();
  });

  it("names the field a time refusal belongs to", async () => {
    const refused = Object.assign(new Error("422"), {
      isAxiosError: true,
      response: {
        status: 422,
        data: {
          error: "Time field refused",
          code: "LOCAL_TIME_NONEXISTENT",
          field: "departureLocal",
        },
      },
    });
    const { hook } = setup(vi.fn().mockRejectedValue(refused));
    await act(() => hook.result.current.handleSubmit(event));
    expect(hook.result.current.failure).toMatchObject({
      key: "common:saveErrors.localTimeNonexistent",
      field: "departureLocal",
    });
  });

  it("refuses without a request when a required time is missing", async () => {
    const onSubmit = vi.fn();
    const { hook, deps } = setup(onSubmit, { canSubmit: false });
    await act(() => hook.result.current.handleSubmit(event));
    expect(onSubmit).not.toHaveBeenCalled();
    expect(deps.setError).toHaveBeenCalledWith("errors:missingTimes");
  });
});
