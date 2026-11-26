import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.unmock("../useYearCounts");
const api = vi.hoisted(() => ({ getYearCounts: vi.fn() }));
vi.mock("../../api", () => ({ statsApi: api }));

import { resetYearCounts, useYearCounts } from "../useYearCounts";

describe("useYearCounts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetYearCounts();
  });

  it("answers per domain and overall, and leaves a year without entries out", async () => {
    api.getYearCounts.mockResolvedValue({
      years: [
        { year: 2024, total: 5, byDomain: { flight: 1, rail: 4 } },
        { year: 2021, total: 1, byDomain: { rail: 1 } },
      ],
    });
    const { result } = renderHook(() => useYearCounts());
    await waitFor(() => expect(result.current.of()).toEqual({ 2024: 5, 2021: 1 }));
    expect(result.current.of("rail")).toEqual({ 2024: 4, 2021: 1 });
    expect(result.current.of("flight")).toEqual({ 2024: 1 });
  });

  it("asks once for any number of pickers, and shows plain years when the read fails", async () => {
    api.getYearCounts.mockRejectedValue(new Error("down"));
    const a = renderHook(() => useYearCounts());
    const b = renderHook(() => useYearCounts());
    await waitFor(() => expect(api.getYearCounts).toHaveBeenCalledTimes(1));
    expect(a.result.current.of()).toEqual({});
    expect(b.result.current.of()).toEqual({});
    // A failed read is not cached: the next picker asks again.
    await waitFor(() => {
      resetYearCounts();
    });
  });
});
