import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";

// vi.hoisted lets these vi.fn()s survive vi.mock factory hoisting and stay
// reachable from the test bodies below (see ImmichAlbumSection.test.tsx).
const { airlines, aircraft } = vi.hoisted(() => ({
  airlines: vi.fn(),
  aircraft: vi.fn(),
}));
vi.mock("../../lib/api/suggestions", () => ({
  suggestionsApi: { airlines, aircraft },
}));

import { useSuggestions } from "../useSuggestions";

describe("useSuggestions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    airlines.mockResolvedValue(["Lufthansa"]);
    aircraft.mockResolvedValue(["A320"]);
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  // Task 26: the airline picker forwards the live query so the DB-backed
  // /suggestions/airlines endpoint can search past its 50-row cap instead of
  // always returning the first 50 alphabetically.
  it("forwards the query to suggestionsApi.airlines once the debounce settles", async () => {
    const { rerender } = renderHook(({ q }: { q: string }) => useSuggestions(q), {
      initialProps: { q: "" },
    });
    airlines.mockClear(); // drop the mount-time call with the initial (empty) query

    rerender({ q: "luft" });
    await vi.advanceTimersByTimeAsync(300);

    expect(airlines).toHaveBeenCalledWith("luft");
  });

  // Debounce: rapid keystrokes must coalesce into a single request for the
  // FINAL value, not one request per keystroke. Removing the setTimeout in
  // useSuggestions (or firing on every change) makes this assertion fail
  // with 4 calls instead of 1.
  it("coalesces rapid query changes into a single debounced call", async () => {
    const { rerender } = renderHook(({ q }: { q: string }) => useSuggestions(q), {
      initialProps: { q: "" },
    });
    airlines.mockClear();

    rerender({ q: "l" });
    await vi.advanceTimersByTimeAsync(100);
    rerender({ q: "lu" });
    await vi.advanceTimersByTimeAsync(100);
    rerender({ q: "luf" });
    await vi.advanceTimersByTimeAsync(100);
    rerender({ q: "luft" });
    // Only the last change gets the full 300ms window without interruption.
    await vi.advanceTimersByTimeAsync(300);

    expect(airlines).toHaveBeenCalledTimes(1);
    expect(airlines).toHaveBeenCalledWith("luft");
  });

  // Callers that never pass a query (FlightEditModal, FlightReviewModal) must
  // keep getting the old unfiltered (first-50) behavior — no `q` forwarded.
  it("calls suggestionsApi.airlines with an empty string when no query is given", async () => {
    renderHook(() => useSuggestions());
    await vi.advanceTimersByTimeAsync(300);

    expect(airlines).toHaveBeenCalledWith("");
  });

  it("still fetches aircraft suggestions once on mount, unaffected by the query debounce", async () => {
    renderHook(({ q }: { q: string }) => useSuggestions(q), { initialProps: { q: "luft" } });
    await vi.advanceTimersByTimeAsync(0);

    expect(aircraft).toHaveBeenCalledTimes(1);
    expect(aircraft).toHaveBeenCalledWith();
  });
});
