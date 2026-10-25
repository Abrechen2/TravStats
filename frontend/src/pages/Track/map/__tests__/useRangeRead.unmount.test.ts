import { describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import type { TravTrackRange } from "../../../../lib/api/travtrackViews";

const views = vi.hoisted(() => ({ range: vi.fn() }));
vi.mock("../../../../lib/api/travtrackViews", () => ({ travTrackViewsApi: views }));

import { useRangeRead } from "../useRangeRead";

/**
 * An abandoned range read stops (Codex round 2): a year's continuation must
 * not keep fetching parts after the map left it — unmounted or another span.
 */

const part = (next: string | null): TravTrackRange => ({
  from: "2026-01-01T00:00:00.000Z",
  to: "2027-01-01T00:00:00.000Z",
  segments: [],
  pointIds: [],
  pointCount: 0,
  readCount: 0,
  simplified: false,
  omittedSegments: 0,
  next,
  cursor: next ? "1:1" : null,
});

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

const YEAR = { fromDay: "2026-01-01", toDay: "2026-12-31" };

describe("useRangeRead — stopping", () => {
  it("unmounting stops the continuation before its next request", async () => {
    const first = deferred<TravTrackRange>();
    views.range.mockReset().mockReturnValueOnce(first.promise).mockResolvedValue(part(null));
    const { unmount } = renderHook(() => useRangeRead(YEAR, 0));
    expect(views.range).toHaveBeenCalledTimes(1);
    unmount();
    await act(async () => first.resolve(part("2026-03-01T00:00:00.000Z")));
    expect(views.range).toHaveBeenCalledTimes(1);
  });

  it("another span stops the old read; only the new one goes on", async () => {
    const first = deferred<TravTrackRange>();
    views.range.mockReset().mockReturnValueOnce(first.promise).mockResolvedValue(part(null));
    const { rerender } = renderHook(({ span }) => useRangeRead(span, 0), {
      initialProps: { span: YEAR },
    });
    rerender({ span: { fromDay: "2025-01-01", toDay: "2025-12-31" } });
    await act(async () => first.resolve(part("2026-03-01T00:00:00.000Z")));
    expect(views.range.mock.calls.map((c) => c[0].fromDay)).toEqual(["2026-01-01", "2025-01-01"]);
  });
});
