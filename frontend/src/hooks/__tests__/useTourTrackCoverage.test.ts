import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";

/**
 * The tour editor's "which recording covers this leg" comes from the server
 * now. The hook's one job beyond fetching is honesty: a failed or stale answer
 * must read as UNKNOWN, never as "no recording covers any leg".
 */
const coverageMock = vi.fn();
vi.mock("../../lib/api/tours", () => ({
  toursApi: { tracks: { coverage: (...a: unknown[]) => coverageMock(...a) } },
}));

vi.mock("../../lib/logger", () => ({ logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { useTourTrackCoverage } from "../useTourTrackCoverage";

describe("useTourTrackCoverage", () => {
  beforeEach(() => {
    coverageMock.mockReset();
  });

  it("maps only the legs the server calls covered", async () => {
    coverageMock.mockResolvedValue([
      {
        legId: "l1",
        fromStopId: "a",
        toStopId: "b",
        verdict: { trackId: "t1", status: "covered", reason: "complete" },
      },
      {
        legId: "l2",
        fromStopId: "b",
        toStopId: "c",
        verdict: { trackId: "t1", status: "notCovered", reason: "recordingGap" },
      },
      { legId: "l3", fromStopId: "c", toStopId: "d", verdict: null },
    ]);
    const { result } = renderHook(() => useTourTrackCoverage("trip", "route", "k1"));
    await waitFor(() => expect(result.current.known).toBe(true));
    expect([...result.current.coveringTrackByLegId]).toEqual([["l1", "t1"]]);
    expect(coverageMock).toHaveBeenCalledWith("trip", "route");
  });

  it("stays unknown when the request fails", async () => {
    coverageMock.mockImplementation(() => Promise.reject(new Error("offline")));
    const { result } = renderHook(() => useTourTrackCoverage("trip", "route", "k1"));
    await waitFor(() => expect(coverageMock).toHaveBeenCalled());
    expect(result.current.known).toBe(false);
  });

  it("is unknown again the moment the legs or recordings change, until re-asked", async () => {
    coverageMock.mockResolvedValue([]);
    const { result, rerender } = renderHook(
      ({ key }) => useTourTrackCoverage("trip", "route", key),
      {
        initialProps: { key: "k1" },
      }
    );
    await waitFor(() => expect(result.current.known).toBe(true));
    let resolve: (v: unknown[]) => void = () => undefined;
    coverageMock.mockReturnValue(new Promise((r) => (resolve = r)));
    rerender({ key: "k2" });
    expect(result.current.known).toBe(false);
    resolve([]);
    await waitFor(() => expect(result.current.known).toBe(true));
  });
});
