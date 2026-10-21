import { describe, expect, it } from "vitest";
import { createRef } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { HoverTooltip, type HoverTooltipApi } from "../HoverTooltip";
import { FLOATING_CARD_Z } from "../FloatingCard";

/**
 * forgejo#323 browser look: clicking a ferry line opened its card while the
 * tooltip for the same line stayed on top of it, and the tooltip sat below the
 * map's floating panels.
 */
describe("HoverTooltip", () => {
  function setup(): { api: HoverTooltipApi } {
    const ref = createRef<HoverTooltipApi>();
    render(<HoverTooltip ref={ref} />);
    if (!ref.current) throw new Error("no tooltip api");
    return { api: ref.current };
  }

  it("hides on a press and stays hidden over the same object, until another one", () => {
    const { api } = setup();
    act(() => api.show({ html: "<b>Kiel – Oslo</b>", x: 10, y: 120 }));
    expect(screen.getByText("Kiel – Oslo")).toBeInTheDocument();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByText("Kiel – Oslo")).toBeNull();
    act(() => api.show({ html: "<b>Kiel – Oslo</b>", x: 12, y: 121 }));
    expect(screen.queryByText("Kiel – Oslo")).toBeNull();
    act(() => api.show({ html: "<b>Oslo</b>", x: 40, y: 120 }));
    expect(screen.getByText("Oslo")).toBeInTheDocument();
  });

  it("stacks above the map's floating panels", () => {
    const { api } = setup();
    act(() => api.show({ html: "<i>tip</i>", x: 1, y: 1 }));
    const box = screen.getByText("tip").parentElement as HTMLElement;
    expect(Number(box.style.zIndex)).toBe(FLOATING_CARD_Z);
    expect(FLOATING_CARD_Z).toBeGreaterThan(40);
  });
});
