import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";

import CrossDomainHeatmap from "../CrossDomainHeatmap";
import CrossDomainActivityChart from "../CrossDomainActivityChart";

/**
 * Wide charts scroll inside themselves; the page does not scroll sideways.
 *
 * Forgejo #8: at a 390px viewport the /stats document measured about 718px
 * wide, so the whole page slid under the reader's thumb and content sat off
 * the right edge. Two grids caused it — the 31-day heatmap, whose day numbers
 * alone need roughly 510px, and the activity chart, which grows a column per
 * year of the user's history.
 *
 * WHAT THIS TEST CAN AND CANNOT DO, said plainly rather than implied: jsdom
 * computes no layout, so it cannot measure a scroll width and cannot prove the
 * page stops overflowing. What it can check is the STRUCTURE the fix relies on
 * — that each wide grid really does sit inside a scrolling ancestor, not
 * beside one. That is the part a later refactor would silently undo. The real
 * measurement belongs in a viewport check during RC acceptance.
 */
vi.mock("../../../../hooks/useTranslation", () => ({
  useTranslation: () => ({ t: (k: string) => k, i18n: { language: "de" } }),
}));

function scrollingAncestorOf(el: Element | null): Element | null {
  let node = el?.parentElement ?? null;
  while (node) {
    if (node.className.includes?.("overflow-x-auto")) return node;
    node = node.parentElement;
  }
  return null;
}

describe("wide overview charts stay inside their own box", () => {
  it("puts the day-number heatmap in a horizontal scroller", () => {
    const { container } = render(
      <CrossDomainHeatmap statsMap={{}} visible={{}} year={2024} />
    );

    // The grid is identified by the layout that makes it wide in the first
    // place, not by a class we could rename without noticing.
    const grid = Array.from(container.querySelectorAll<HTMLElement>("div")).find((d) =>
      d.style.gridTemplateColumns?.includes("repeat(31")
    );
    expect(grid).toBeDefined();

    const scroller = scrollingAncestorOf(grid ?? null);
    expect(scroller).not.toBeNull();
    // And it must not grow a vertical scrollbar alongside the horizontal one —
    // the lesson YearHeatmap already carries from #248.
    expect(scroller?.className).toContain("overflow-y-hidden");
  });

  it("puts the per-year activity chart in a horizontal scroller", () => {
    const { container } = render(
      <CrossDomainActivityChart
        statsMap={{}}
        visible={{}}
        years={[2019, 2020, 2021, 2022, 2023, 2024]}
        selectedYear={null}
        compareYear={null}
        compareEnabled={false}
      />
    );

    const grid = Array.from(container.querySelectorAll<HTMLElement>("div")).find((d) =>
      d.style.gridTemplateColumns?.startsWith("repeat(6")
    );
    expect(grid).toBeDefined();
    expect(scrollingAncestorOf(grid ?? null)).not.toBeNull();
  });
});
