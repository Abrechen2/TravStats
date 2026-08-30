import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";

import RankedBarList from "../RankedBarList";
import type { RankedRow } from "../RankedBarList";

/**
 * The bars have to be as long as the numbers beside them say.
 *
 * This is the defect that reached a browser twice on 2026-08-30: first the bars
 * rendered with no length at all, then with the SAME length for 4 visits and
 * for 3. Both times every test was green, because the numbers were right and
 * nothing looked at the geometry — a chart whose bars disagree with its own
 * figures is worse than no chart, since the reader trusts the picture first.
 *
 * The widths below are written out as the values a reader would measure, not
 * re-derived from the component's formula. A test that recomputes the rule it
 * is checking passes for any rule.
 */
function widths(): string[] {
  // The bar is the only element carrying an inline width; the track around it
  // is a full-width container.
  return Array.from(document.querySelectorAll<HTMLElement>("li div[style*='width']")).map(
    (el) => el.style.width
  );
}

function rows(...weights: number[]): RankedRow[] {
  return weights.map((weight, i) => ({
    key: `row-${i}`,
    label: `Row ${i}`,
    weight,
    value: String(weight),
  }));
}

describe("RankedBarList bar geometry", () => {
  it("gives the largest row the full width and scales the rest against it", () => {
    // 4 visits and 3 visits — the pair that shipped identical.
    render(<RankedBarList title="Besuche" rows={rows(4, 3, 2, 1)} emptyLabel="leer" />);

    expect(widths()).toEqual(["100%", "75%", "50%", "25%"]);
  });

  it("keeps a tiny row visible rather than drawing nothing", () => {
    // A hairline is a reading; a zero-width bar reads as "no data", which is a
    // different statement from "very little".
    render(<RankedBarList title="Besuche" rows={rows(1000, 1)} emptyLabel="leer" />);

    const [first, second] = widths();
    expect(first).toBe("100%");
    expect(second).toBe("2%");
  });

  it("does not produce NaN when every row weighs nothing", () => {
    // A rating list where nothing is rated yet: dividing by the maximum would
    // be a division by zero, and `width: NaN%` silently drops the attribute.
    render(<RankedBarList title="Bewertung" rows={rows(0, 0)} emptyLabel="leer" />);

    for (const width of widths()) {
      expect(width).toBe("2%");
      expect(width).not.toContain("NaN");
    }
  });

  it("scales against the largest row, not against a fixed ceiling", () => {
    // These lists compare rows to each other. Against an absolute maximum a
    // narrow real range would render as a row of identical stubs.
    render(<RankedBarList title="Preis" rows={rows(0.52, 0.5)} emptyLabel="leer" />);

    const [first, second] = widths();
    expect(first).toBe("100%");
    expect(parseFloat(second)).toBeCloseTo(96.15, 1);
  });

  it("draws no bars at all when the list is empty", () => {
    render(<RankedBarList title="Besuche" rows={[]} emptyLabel="Noch nichts erfasst" />);

    expect(widths()).toEqual([]);
    expect(screen.getByText("Noch nichts erfasst")).toBeInTheDocument();
  });
});
