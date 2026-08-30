import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useSectionVisibility } from "../useSectionVisibility";

/**
 * Which blocks of a statistics tab a reader wants.
 *
 * Asked for by a tester who records no prices and had a cost block on every
 * screen (Alex, 2026-08-29).
 *
 * THE STORAGE SHAPE IS THE WHOLE DESIGN. Only the HIDDEN keys are kept, so a
 * section added months later still appears for someone who set their
 * preferences today. A stored allow-list would swallow every future block
 * silently, and nobody would ever work out why their page stopped growing.
 */
describe("useSectionVisibility", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("shows everything before anyone has said otherwise", () => {
    const { result } = renderHook(() => useSectionVisibility("flight"));

    expect(result.current.isVisible("business")).toBe(true);
    expect(result.current.isVisible("a-section-invented-later")).toBe(true);
    expect(result.current.hiddenCount).toBe(0);
  });

  it("hides a section and brings it back", () => {
    const { result } = renderHook(() => useSectionVisibility("flight"));

    act(() => result.current.toggle("business"));
    expect(result.current.isVisible("business")).toBe(false);
    expect(result.current.hiddenCount).toBe(1);

    act(() => result.current.toggle("business"));
    expect(result.current.isVisible("business")).toBe(true);
  });

  it("stores the HIDDEN keys, so a later section is not swallowed", () => {
    const { result } = renderHook(() => useSectionVisibility("flight"));
    act(() => result.current.toggle("business"));

    const stored = JSON.parse(
      window.localStorage.getItem("stats.hiddenSections.flight") ?? "[]"
    ) as string[];
    expect(stored).toEqual(["business"]);

    // A block that did not exist when the preference was saved is visible.
    const { result: later } = renderHook(() => useSectionVisibility("flight"));
    expect(later.current.isVisible("shipped-next-year")).toBe(true);
    expect(later.current.isVisible("business")).toBe(false);
  });

  it("keeps each tab's answer to itself", () => {
    // Hiding costs on flights says nothing about cruises.
    const { result: flight } = renderHook(() => useSectionVisibility("flight"));
    act(() => flight.current.toggle("business"));

    const { result: cruise } = renderHook(() => useSectionVisibility("cruise"));
    expect(cruise.current.isVisible("business")).toBe(true);
  });

  it("comes back from an experiment", () => {
    const { result } = renderHook(() => useSectionVisibility("flight"));
    act(() => result.current.toggle("business"));
    act(() => result.current.toggle("seats"));
    expect(result.current.hiddenCount).toBe(2);

    act(() => result.current.reset());
    expect(result.current.hiddenCount).toBe(0);
    expect(result.current.isVisible("business")).toBe(true);
  });

  it("shows everything when the stored value is not a list of keys", () => {
    // Local storage is editable by hand and survives version changes. Hiding
    // the whole page over a bad value would be the worst possible reading.
    window.localStorage.setItem("stats.hiddenSections.flight", '{"business":true}');

    const { result } = renderHook(() => useSectionVisibility("flight"));
    expect(result.current.isVisible("business")).toBe(true);
    expect(result.current.hiddenCount).toBe(0);
  });
});
