import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

vi.mock("../../lib/api/places", () => ({ listPlaces: vi.fn() }));
vi.mock("../../lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

import { useTripPlaceCounts } from "../useTripPlaceCounts";
import { listPlaces } from "../../lib/api/places";
import { logger } from "../../lib/logger";

describe("useTripPlaceCounts", () => {
  beforeEach(() => {
    vi.mocked(listPlaces).mockReset();
    vi.mocked(logger.warn).mockReset();
  });

  it("counts visited places per trip", async () => {
    vi.mocked(listPlaces).mockResolvedValue([
      { id: "a", visits: [{ tripId: "t1", visitedAt: "2020-01-01T00:00:00Z" }] },
    ] as never);
    const { result } = renderHook(() => useTripPlaceCounts(true));
    await waitFor(() => expect(result.current.counts.get("t1")).toBe(1));
  });

  it("reports a failed read instead of showing every trip without places", async () => {
    vi.mocked(listPlaces).mockRejectedValue(new Error("503"));
    const { result } = renderHook(() => useTripPlaceCounts(true));
    await waitFor(() => expect(result.current.failed).toBe(true));
    expect(logger.warn).toHaveBeenCalled();
  });

  it("reads nothing while the places domain is off", () => {
    renderHook(() => useTripPlaceCounts(false));
    expect(listPlaces).not.toHaveBeenCalled();
  });
});
