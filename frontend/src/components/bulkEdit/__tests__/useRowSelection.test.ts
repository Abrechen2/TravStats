import { describe, it, expect } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useRowSelection, type BulkRow } from "../useRowSelection";

const row = (id: string, over: Partial<BulkRow> = {}): BulkRow => ({ id, label: id, ...over });

describe("useRowSelection", () => {
  it("selects nothing until started, and forgets everything on stop", () => {
    const { result } = renderHook(() => useRowSelection());
    expect(result.current.selecting).toBe(false);
    act(() => result.current.start());
    act(() => result.current.toggle([row("a")]));
    expect(result.current.isSelected("a")).toBe(true);
    act(() => result.current.stop());
    expect(result.current.selecting).toBe(false);
    expect(result.current.selected.size).toBe(0);
  });

  it("ticks every leg of a connection together and unticks them together", () => {
    const legs = [row("a"), row("b")];
    const { result } = renderHook(() => useRowSelection());
    act(() => result.current.toggle(legs));
    expect(result.current.allSelected(legs)).toBe(true);
    act(() => result.current.toggle([row("a")]));
    // One leg off makes the entry only partly chosen; a toggle then completes it.
    expect(result.current.allSelected(legs)).toBe(false);
    act(() => result.current.toggle(legs));
    expect(result.current.allSelected(legs)).toBe(true);
    act(() => result.current.toggle(legs));
    expect(result.current.selected.size).toBe(0);
  });

  it("keeps the selection across pages and replaces chosen rows with fresher copies", () => {
    const { result } = renderHook(() => useRowSelection());
    act(() => result.current.selectAll([row("a", { updatedAt: "old" })]));
    act(() => result.current.selectAll([row("b")]));
    expect(result.current.selected.size).toBe(2);
    act(() => result.current.refresh([row("a", { updatedAt: "new" }), row("z")]));
    expect(result.current.selected.get("a")?.updatedAt).toBe("new");
    expect(result.current.selected.has("z")).toBe(false);
  });
});
