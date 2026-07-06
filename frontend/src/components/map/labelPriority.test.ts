import { describe, it, expect } from "vitest";
import { labelBudget, pickLabelled } from "./labelPriority";

const w = (n: number) => ({ v: n });
const weightOf = (x: { v: number }) => x.v;

describe("labelBudget", () => {
  it("grows monotonically with zoom", () => {
    const zooms = [0, 1, 2, 3, 4, 5, 6];
    const budgets = zooms.map(labelBudget);
    for (let i = 1; i < budgets.length; i++) {
      expect(budgets[i]).toBeGreaterThanOrEqual(budgets[i - 1]);
    }
  });

  it("keeps a small floor at world zoom", () => {
    expect(labelBudget(0)).toBe(5);
    expect(labelBudget(1)).toBe(5);
  });

  it("is large enough to label most markers by mid zoom", () => {
    expect(labelBudget(6)).toBeGreaterThan(60);
  });
});

describe("pickLabelled", () => {
  const items = [w(1), w(50), w(3), w(20), w(100), w(2)];

  it("labels nothing when off", () => {
    expect(pickLabelled(items, weightOf, "off", 10)).toEqual([]);
  });

  it("labels everything when all (any zoom)", () => {
    expect(pickLabelled(items, weightOf, "all", 0)).toHaveLength(items.length);
  });

  it("spends the zoom budget on the heaviest markers first", () => {
    // zoom 0 → budget 5, but force a tighter view: use few items vs budget.
    const many = Array.from({ length: 40 }, (_, i) => w(i));
    const picked = pickLabelled(many, weightOf, "important", 1); // budget 5
    expect(picked).toHaveLength(5);
    // The five heaviest (39,38,37,36,35) survive.
    expect(picked.map(weightOf).sort((a, b) => a - b)).toEqual([35, 36, 37, 38, 39]);
  });

  it("returns all items when they fit under budget", () => {
    const picked = pickLabelled(items, weightOf, "important", 6); // huge budget
    expect(picked).toHaveLength(items.length);
  });
});
