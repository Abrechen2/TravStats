import { describe, it, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import type { PickingInfo } from "@deck.gl/core";
import { useDeckHoverCursor } from "../useDeckHoverCursor";

const over = { object: { id: "a" } } as unknown as PickingInfo;
const off = { object: null } as unknown as PickingInfo;

describe("useDeckHoverCursor", () => {
  it("starts off", () => {
    const { result } = renderHook(() => useDeckHoverCursor());
    expect(result.current.isHovering).toBe(false);
  });

  it("turns on over a pickable object and off again", () => {
    const { result } = renderHook(() => useDeckHoverCursor());

    act(() => result.current.onHover(over));
    expect(result.current.isHovering).toBe(true);

    act(() => result.current.onHover(off));
    expect(result.current.isHovering).toBe(false);
  });

  // onHover fires on every mouse move across the canvas. Without the ref guard
  // a slow drag over a cluster of markers would set state on each event and
  // re-render the map for no change at all.
  it("does not re-render while the pointer stays on the same side of the edge", () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useDeckHoverCursor();
    });

    const initial = renders;
    act(() => {
      result.current.onHover(over);
    });
    const afterEnter = renders;
    expect(afterEnter).toBeGreaterThan(initial);

    act(() => {
      result.current.onHover(over);
      result.current.onHover(over);
      result.current.onHover(over);
    });
    expect(renders).toBe(afterEnter);
  });

  it("treats a picking info without an object as off", () => {
    const { result } = renderHook(() => useDeckHoverCursor());
    act(() => result.current.onHover(over));
    act(() => result.current.onHover({} as unknown as PickingInfo));
    expect(result.current.isHovering).toBe(false);
  });
});
