import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePagination } from "../usePagination";

// The tester's logbook had 123 flights in one endless list.
describe("usePagination", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  const rows = Array.from({ length: 123 }, (_, i) => i);

  it("cuts the rows into pages of the chosen size", () => {
    const { result } = renderHook(() => usePagination(rows, "flights-test"));
    expect(result.current.pageSize).toBe(50);
    expect(result.current.paged).toHaveLength(50);
    expect(result.current.pageCount).toBe(3);
    act(() => result.current.setPage(3));
    // Page 3 of 50 holds rows 100..122 — the remaining 23, not a full page.
    expect(result.current.paged).toEqual(rows.slice(100, 123));
  });

  it("goes back to the first page when the row set shrinks under the current page", () => {
    const { result, rerender } = renderHook(({ r }) => usePagination(r, "flights-test"), {
      initialProps: { r: rows },
    });
    act(() => result.current.setPage(3));
    rerender({ r: rows.slice(0, 10) });
    expect(result.current.page).toBe(1);
    expect(result.current.paged).toHaveLength(10);
  });

  it("shows everything when the size is 'all'", () => {
    const { result } = renderHook(() => usePagination(rows, "flights-test"));
    act(() => result.current.setPageSize("all"));
    expect(result.current.paged).toHaveLength(123);
    expect(result.current.pageCount).toBe(1);
  });
});
