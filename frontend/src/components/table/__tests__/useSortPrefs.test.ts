import { describe, it, expect, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useSortPrefs } from "../useSortPrefs";

const KNOWN = ["name", "date", "price"] as const;
type Key = (typeof KNOWN)[number];

describe("useSortPrefs", () => {
  beforeEach(() => localStorage.clear());

  it("starts on the table's default", () => {
    const { result } = renderHook(() => useSortPrefs<Key>("t", "date", "desc", KNOWN));
    expect(result.current.sortBy).toBe("date");
    expect(result.current.sortOrder).toBe("desc");
  });

  // The whole point: a reload used to drop back to the default.
  it("remembers the choice across a remount", () => {
    const first = renderHook(() => useSortPrefs<Key>("t", "date", "desc", KNOWN));
    act(() => first.result.current.setSort("price", "asc"));
    first.unmount();

    const second = renderHook(() => useSortPrefs<Key>("t", "date", "desc", KNOWN));
    expect(second.result.current.sortBy).toBe("price");
    expect(second.result.current.sortOrder).toBe("asc");
  });

  it("keeps tables apart", () => {
    const a = renderHook(() => useSortPrefs<Key>("a", "date", "desc", KNOWN));
    act(() => a.result.current.setSort("name", "asc"));
    const b = renderHook(() => useSortPrefs<Key>("b", "date", "desc", KNOWN));
    expect(b.result.current.sortBy).toBe("date");
  });

  // A column dropped in a later release must not leave the table sorted by
  // something that no longer exists.
  it("falls back to the default when the stored column is gone", () => {
    localStorage.setItem("travstats:table-sort:t", JSON.stringify({ by: "retired", order: "asc" }));
    const { result } = renderHook(() => useSortPrefs<Key>("t", "date", "desc", KNOWN));
    expect(result.current.sortBy).toBe("date");
    expect(result.current.sortOrder).toBe("desc");
  });

  it("survives a corrupt preference", () => {
    localStorage.setItem("travstats:table-sort:t", "{not json");
    const { result } = renderHook(() => useSortPrefs<Key>("t", "date", "desc", KNOWN));
    expect(result.current.sortBy).toBe("date");
  });
});
