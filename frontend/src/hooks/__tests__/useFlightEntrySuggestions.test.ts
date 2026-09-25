import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";

const getEntrySuggestions = vi.hoisted(() => vi.fn());
vi.mock("../../lib/api/flights", () => ({ flightsApi: { getEntrySuggestions } }));
vi.mock("../../lib/logger", () => ({ logger: { warn: vi.fn() } }));

import { NO_ENTRY_SUGGESTIONS, useFlightEntrySuggestions } from "../useFlightEntrySuggestions";

const answer = {
  seats: ["12A"],
  flightNumbers: ["LH2440"],
  frequentFlyerNumber: "992000111",
  departureTerminals: ["2"],
};

async function settle(): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(600);
  });
}

describe("useFlightEntrySuggestions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    getEntrySuggestions.mockReset().mockResolvedValue(answer);
  });
  afterEach(() => vi.useRealTimers());

  it("asks once the inputs settle, with blanks left out", async () => {
    const { result } = renderHook(() =>
      useFlightEntrySuggestions({ airline: " Lufthansa ", dep: "MUC", arr: "" })
    );
    await settle();
    expect(getEntrySuggestions).toHaveBeenLastCalledWith({
      airline: "Lufthansa",
      dep: "MUC",
      arr: undefined,
    });
    expect(result.current).toEqual(answer);
  });

  it("does not ask per keystroke of the airline", async () => {
    const { rerender } = renderHook(
      ({ airline }: { airline: string }) => useFlightEntrySuggestions({ airline }),
      { initialProps: { airline: "" } }
    );
    await settle();
    getEntrySuggestions.mockClear();
    for (const prefix of ["L", "Lu", "Luf", "Lufthansa"]) {
      rerender({ airline: prefix });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
    }
    await settle();
    expect(getEntrySuggestions).toHaveBeenCalledTimes(1);
    expect(getEntrySuggestions).toHaveBeenCalledWith(
      expect.objectContaining({ airline: "Lufthansa" })
    );
  });

  it("asks nothing while disabled", async () => {
    renderHook(() => useFlightEntrySuggestions({ airline: "LH", enabled: false }));
    await settle();
    expect(getEntrySuggestions).not.toHaveBeenCalled();
  });

  it("offers nothing when the request fails", async () => {
    getEntrySuggestions.mockRejectedValue(new Error("429"));
    const { result } = renderHook(() => useFlightEntrySuggestions({ airline: "LH" }));
    await settle();
    expect(result.current).toEqual(NO_ENTRY_SUGGESTIONS);
  });
});
