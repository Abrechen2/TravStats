import { describe, expect, it, beforeEach, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useServerPagination } from "../useServerPagination";

vi.mock("../../../lib/logger", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

/**
 * The arithmetic the flights logbook pages with.
 *
 * Its sibling `usePagination` slices rows the browser already holds; this one
 * only produces `limit` and `offset`, because the rows are on the server.
 * Both traps below are the ones that make a server-paged list lie.
 */
describe("useServerPagination", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("asks for offset 25 on page 2 at 25 rows", () => {
    const { result } = renderHook(() => useServerPagination(174, "flights-list", ""));
    act(() => result.current.setPageSize(25));
    act(() => result.current.setPage(2));
    expect(result.current.limit).toBe(25);
    expect(result.current.offset).toBe(25);
    expect(result.current.pageCount).toBe(7);
  });

  it("starts at offset 0", () => {
    const { result } = renderHook(() => useServerPagination(174, "flights-list", ""));
    expect(result.current.page).toBe(1);
    expect(result.current.offset).toBe(0);
  });

  /**
   * Page 7 of "all flights" is not page 7 of "flights with Lufthansa".
   * Staying put shows an empty table under a filled-in filter bar — and
   * worse, asks the server for it first.
   */
  it("returns to page 1 when the filters change", () => {
    const { result, rerender } = renderHook(
      ({ signature }: { signature: string }) => useServerPagination(174, "flights-list", signature),
      { initialProps: { signature: "" } }
    );
    act(() => result.current.setPage(4));
    expect(result.current.page).toBe(4);

    rerender({ signature: "airlineExact=Lufthansa" });
    // In the SAME render pass, so the caller's fetch effect never sees the
    // stale offset — an effect-based reset would spend a request on it.
    expect(result.current.page).toBe(1);
    expect(result.current.offset).toBe(0);
  });

  it("stays put when the filters do not change", () => {
    const { result, rerender } = renderHook(
      ({ signature }: { signature: string }) => useServerPagination(174, "flights-list", signature),
      { initialProps: { signature: "year=2024" } }
    );
    act(() => result.current.setPage(3));
    rerender({ signature: "year=2024" });
    expect(result.current.page).toBe(3);
  });

  it("returns to page 1 when the page size changes, because the boundaries move", () => {
    const { result } = renderHook(() => useServerPagination(174, "flights-list", ""));
    act(() => result.current.setPage(3));
    act(() => result.current.setPageSize(25));
    expect(result.current.page).toBe(1);
  });

  it("remembers the page size, and shares the key shape with usePagination", () => {
    const { result, unmount } = renderHook(() => useServerPagination(174, "flights-list", ""));
    act(() => result.current.setPageSize(25));
    expect(localStorage.getItem("travstats:table-page-size:flights-list")).toBe("25");
    unmount();

    const second = renderHook(() => useServerPagination(174, "flights-list", ""));
    expect(second.result.current.pageSize).toBe(25);
  });

  /**
   * "Alle" is a promise about a row count nobody has checked. A value stored
   * by the client-paged version of this list must not silently become "the
   * first 500 of 900" under that label.
   */
  it("falls back to the default when the stored size is 'all'", () => {
    localStorage.setItem("travstats:table-page-size:flights-list", "all");
    const { result } = renderHook(() => useServerPagination(174, "flights-list", ""));
    expect(result.current.pageSize).toBe(50);
  });

  it("caps a stored size at what the server will serve", () => {
    localStorage.setItem("travstats:table-page-size:flights-list", "5000");
    const { result } = renderHook(() => useServerPagination(174, "flights-list", ""));
    expect(result.current.limit).toBe(500);
  });

  it("reports one page for an empty set rather than zero", () => {
    const { result } = renderHook(() => useServerPagination(0, "flights-list", ""));
    expect(result.current.pageCount).toBe(1);
    expect(result.current.page).toBe(1);
  });
});
