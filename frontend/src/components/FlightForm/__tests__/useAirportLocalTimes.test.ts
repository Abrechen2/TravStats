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
});
