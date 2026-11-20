import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor, act } from "@testing-library/react";

vi.mock("../../lib/api/places", () => ({ listPlaces: vi.fn() }));
vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { useTripPlaceVisits } from "../useTripPlaceVisits";
import { listPlaces } from "../../lib/api/places";
import { logger } from "../../lib/logger";

const place = {
  id: "p1",
  name: "Cafe",
  visits: [
    { id: "v1", placeId: "p1", tripId: "t1" },
    { id: "v2", placeId: "p1", tripId: "other" },
  ],
} as never;

describe("useTripPlaceVisits", () => {
  beforeEach(() => {
    vi.mocked(listPlaces).mockReset();
    vi.mocked(logger.warn).mockReset();
  });

  it("keeps only the visits of this trip", async () => {
    vi.mocked(listPlaces).mockResolvedValue([place]);
    const { result } = renderHook(() => useTripPlaceVisits("t1", true));
    await waitFor(() => expect(result.current.placeVisits).toHaveLength(1));
    expect(result.current.failed).toBe(false);
  });

  it("reports a failed load instead of an empty list that looks like 'no places'", async () => {
    vi.mocked(listPlaces).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useTripPlaceVisits("t1", true));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(logger.warn).toHaveBeenCalled();
  });

  it("loads again on reload and clears the failure when it works", async () => {
    vi.mocked(listPlaces).mockRejectedValueOnce(new Error("boom")).mockResolvedValue([place]);
    const { result } = renderHook(() => useTripPlaceVisits("t1", true));
    await waitFor(() => expect(result.current.failed).toBe(true));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.placeVisits).toHaveLength(1));
    expect(result.current.failed).toBe(false);
  });

  it("does not fetch while the places domain is off", () => {
    renderHook(() => useTripPlaceVisits("t1", false));
    expect(listPlaces).not.toHaveBeenCalled();
  });
});
