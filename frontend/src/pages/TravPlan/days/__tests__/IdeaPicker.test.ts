import { describe, it, expect } from "vitest";
import { unplannedIdeas } from "../IdeaPicker";
import type { PlanIdea, PlanItem } from "../../../../lib/api/travplan";

const idea = (id: string, priority: PlanIdea["priority"], itemId: string | null): PlanIdea => ({
  id,
  title: id,
  category: "",
  priority,
  note: "",
  itemId,
});

describe("unplannedIdeas", () => {
  it("keeps ideas without a dated entry, must-dos first", () => {
    const items = [
      { id: "dated", day: "2026-05-02" },
      { id: "undated", day: null },
    ] as PlanItem[];
    const ideas = [
      idea("maybe", "maybe", null),
      idea("planned", "must", "dated"),
      idea("parked", "optional", "undated"),
      idea("must", "must", null),
    ];
    expect(unplannedIdeas({ ideas, items }).map((i) => i.id)).toEqual(["must", "parked", "maybe"]);
  });
});
