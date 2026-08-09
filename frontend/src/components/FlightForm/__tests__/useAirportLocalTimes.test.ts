import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

// Deviation from the brief's sketch: FlightEditModal (and therefore this
// hook, extracted from it) resolves airports via `airportsApi.getByCode`,
// not `airportsApi.search` — see FlightEditModal.tsx's hydration effect and
// the mock in FlightEditModal.timezone.test.tsx. getByCode returns a single
// Airport and rejects on a miss, so the "unresolved" case below is modeled
// as a rejection, matching the real API contract.
const mocks = vi.hoisted(() => ({ getByCode: vi.fn() }));
vi.mock("../../../lib/api/airports", () => ({ airportsApi: { getByCode: mocks.getByCode } }));

import { useAirportLocalTimes } from "../useAirportLocalTimes";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getByCode.mockImplementation(async (code: string) =>
    code === "HND" ? { iata: "HND", timezone: "Asia/Tokyo" } : { iata: "JFK", timezone: "America/New_York" }
  );
});

describe("useAirportLocalTimes", () => {
  it("starts on the browser zone and reports not hydrated", () => {
    const { result } = renderHook(() =>
      useAirportLocalTimes({ isOpen: true, depCode: "HND", arrCode: "JFK", browserTimezone: "Europe/Berlin" })
    );
    expect(result.current.hydrated).toBe(false);
    expect(result.current.depTimezone).toBe("Europe/Berlin");
  });

  it("moves BOTH zones to airport-local together, never one alone", async () => {
    const { result } = renderHook(() =>
      useAirportLocalTimes({ isOpen: true, depCode: "HND", arrCode: "JFK", browserTimezone: "Europe/Berlin" })
    );
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.depTimezone).toBe("Asia/Tokyo");
    expect(result.current.arrTimezone).toBe("America/New_York");
  });

  // A half-resolved pair is the failure this whole phase guards against.
  it("stays unhydrated when only one airport resolves", async () => {
    mocks.getByCode.mockImplementation(async (code: string) => {
      if (code === "HND") return { iata: "HND", timezone: "Asia/Tokyo" };
      throw new Error("not found");
    });
    const { result } = renderHook(() =>
      useAirportLocalTimes({ isOpen: true, depCode: "HND", arrCode: "JFK", browserTimezone: "Europe/Berlin" })
    );
    await waitFor(() => expect(mocks.getByCode).toHaveBeenCalledTimes(2));
    expect(result.current.hydrated).toBe(false);
    expect(result.current.depTimezone).toBe("Europe/Berlin");
  });

  it("re-resolves when the departure airport changes", async () => {
    const { result, rerender } = renderHook(
      (props: { depCode: string }) =>
        useAirportLocalTimes({ isOpen: true, depCode: props.depCode, arrCode: "JFK", browserTimezone: "Europe/Berlin" }),
      { initialProps: { depCode: "HND" } }
    );
    await waitFor(() => expect(result.current.hydrated).toBe(true));

    mocks.getByCode.mockImplementation(async () => ({ iata: "FRA", timezone: "Europe/Berlin" }));
    rerender({ depCode: "FRA" });

    await waitFor(() => expect(result.current.depTimezone).toBe("Europe/Berlin"));
  });

  // The race this regression test pins: FlightEditModal only re-syncs its
  // form fields when `hydrated` turns true (it's a no-op while false). If
  // the hook un-hydrates synchronously the moment a code changes — before
  // the new lookup resolves — a submit fired in that window pairs whatever
  // wall-clock is still on screen (the PREVIOUS airport-local value) with
  // `browserTimezone`, silently drifting the instant. Not reachable until
  // airports become editable (Task 4), but the hook must hold the last
  // known-good pair through the resolve window regardless of who's watching.
  it("does not un-hydrate while re-resolving after a code change", async () => {
    const { result, rerender } = renderHook(
      (props: { depCode: string }) =>
        useAirportLocalTimes({ isOpen: true, depCode: props.depCode, arrCode: "JFK", browserTimezone: "Europe/Berlin" }),
      { initialProps: { depCode: "HND" } }
    );
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.depTimezone).toBe("Asia/Tokyo");
    expect(result.current.arrTimezone).toBe("America/New_York");

    // Block the re-resolution so the transient state is observable.
    let resolveFra: (value: { iata: string; timezone: string }) => void = () => {};
    const pending = new Promise<{ iata: string; timezone: string }>((resolve) => {
      resolveFra = resolve;
    });
    mocks.getByCode.mockImplementation(() => pending);

    rerender({ depCode: "FRA" });

    // Still mid-flight: the previous known-good pair must still be reported,
    // and hydrated must still be true. This is the state a submit fired
    // right now would use.
    expect(result.current.hydrated).toBe(true);
    expect(result.current.depTimezone).toBe("Asia/Tokyo");
    expect(result.current.arrTimezone).toBe("America/New_York");

    resolveFra({ iata: "FRA", timezone: "Europe/Berlin" });
    await waitFor(() => expect(result.current.depTimezone).toBe("Europe/Berlin"));
    expect(result.current.hydrated).toBe(true);
  });

  // Two lookups can be in flight at once (isOpen/depCode/arrCode changing
  // mid-resolve). A stale response landing after a newer one must never
  // overwrite it.
  it("ignores a stale lookup that resolves after a newer one", async () => {
    let resolveOld: (value: { iata: string; timezone: string }) => void = () => {};
    let resolveNew: (value: { iata: string; timezone: string }) => void = () => {};
    const oldPromise = new Promise<{ iata: string; timezone: string }>((resolve) => {
      resolveOld = resolve;
    });
    const newPromise = new Promise<{ iata: string; timezone: string }>((resolve) => {
      resolveNew = resolve;
    });
    let calls = 0;
    mocks.getByCode.mockImplementation(() => {
      calls += 1;
      // Calls 1-2 are the initial HND/JFK resolution; calls 3-4 are the
      // FRA re-resolution triggered by rerender below.
      return calls <= 2 ? oldPromise : newPromise;
    });

    const { result, rerender } = renderHook(
      (props: { depCode: string }) =>
        useAirportLocalTimes({ isOpen: true, depCode: props.depCode, arrCode: "JFK", browserTimezone: "Europe/Berlin" }),
      { initialProps: { depCode: "HND" } }
    );

    rerender({ depCode: "FRA" });

    // Resolve the NEWER lookup first, then the STALE older one.
    resolveNew({ iata: "FRA", timezone: "Europe/Berlin" });
    await waitFor(() => expect(result.current.depTimezone).toBe("Europe/Berlin"));

    resolveOld({ iata: "HND", timezone: "Asia/Tokyo" });
    // Give a wrongly-unguarded continuation a chance to run and clobber it.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(result.current.depTimezone).toBe("Europe/Berlin");
    expect(result.current.arrTimezone).toBe("Europe/Berlin");
  });
});
