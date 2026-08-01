import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

const mocks = vi.hoisted(() => ({ getByCode: vi.fn() }));
vi.mock("../../../lib/api/airports", () => ({ airportsApi: { getByCode: mocks.getByCode } }));

import { useAirportLocalTimes } from "../useAirportLocalTimes";

const ARGS = {
  isOpen: true,
  depCode: "HND",
  arrCode: "JFK",
  browserTimezone: "Europe/Berlin",
};

beforeEach(() => {
  mocks.getByCode.mockReset().mockImplementation(async (code: string) =>
    code === "HND"
      ? { iata: "HND", timezone: "Asia/Tokyo" }
      : { iata: "JFK", timezone: "America/New_York" }
  );
});

describe("useAirportLocalTimes", () => {
  it("starts on the browser zone and reports not hydrated", () => {
    const { result } = renderHook(() => useAirportLocalTimes(ARGS));
    expect(result.current.hydrated).toBe(false);
    expect(result.current.depTimezone).toBe("Europe/Berlin");
    expect(result.current.arrTimezone).toBe("Europe/Berlin");
  });

  it("moves BOTH zones to airport-local together, never one alone", async () => {
    const { result } = renderHook(() => useAirportLocalTimes(ARGS));
    await waitFor(() => expect(result.current.hydrated).toBe(true));
    expect(result.current.depTimezone).toBe("Asia/Tokyo");
    expect(result.current.arrTimezone).toBe("America/New_York");
  });

  // A half-resolved pair is the failure this whole phase guards against: one
  // field rendered airport-local, the other browser-local, and submit pairing
  // each with the wrong basis.
  it("stays unhydrated when only one airport resolves", async () => {
    mocks.getByCode.mockImplementation(async (code: string) => {
      if (code === "HND") return { iata: "HND", timezone: "Asia/Tokyo" };
      throw new Error("not found");
    });
    const { result } = renderHook(() => useAirportLocalTimes(ARGS));

    await waitFor(() => expect(mocks.getByCode).toHaveBeenCalledTimes(2));
    expect(result.current.hydrated).toBe(false);
    expect(result.current.depTimezone).toBe("Europe/Berlin");
    expect(result.current.arrTimezone).toBe("Europe/Berlin");
  });

  it("stays unhydrated when an airport record carries no timezone", async () => {
    mocks.getByCode.mockImplementation(async (code: string) =>
      code === "HND" ? { iata: "HND", timezone: "Asia/Tokyo" } : { iata: "JFK" }
    );
    const { result } = renderHook(() => useAirportLocalTimes(ARGS));

    await waitFor(() => expect(mocks.getByCode).toHaveBeenCalledTimes(2));
    expect(result.current.hydrated).toBe(false);
  });

  it("re-resolves when the departure airport changes", async () => {
    const { result, rerender } = renderHook(
      (props: { depCode: string }) => useAirportLocalTimes({ ...ARGS, depCode: props.depCode }),
      { initialProps: { depCode: "HND" } }
    );
    await waitFor(() => expect(result.current.depTimezone).toBe("Asia/Tokyo"));

    // Deliberately NOT a zone equal to the browser's: "Europe/Berlin" is also
    // the unhydrated fallback, so asserting on it would pass on the reset
    // state and never observe the re-resolution at all.
    mocks.getByCode.mockImplementation(async (code: string) =>
      code === "SIN"
        ? { iata: "SIN", timezone: "Asia/Singapore" }
        : { iata: "JFK", timezone: "America/New_York" }
    );
    rerender({ depCode: "SIN" });

    await waitFor(() => expect(result.current.depTimezone).toBe("Asia/Singapore"));
    expect(result.current.hydrated).toBe(true);
    expect(result.current.arrTimezone).toBe("America/New_York");
  });

  it("does not resolve anything while the modal is closed", () => {
    renderHook(() => useAirportLocalTimes({ ...ARGS, isOpen: false }));
    expect(mocks.getByCode).not.toHaveBeenCalled();
  });
});
