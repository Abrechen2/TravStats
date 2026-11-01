import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { WorkspaceSection } from "../sections/WorkspaceSection";
import { assignIdeaToDay, IDEA_DRAG_TYPE } from "../ideaAssignment";
import type { PlanCtx } from "../planContext";
import type { PlanIdea, PlanItem } from "../../../lib/api/travplan";
import { planFixture } from "./planFixture";

vi.mock("../../../hooks/useTranslation", () => ({
  useTranslation: () => ({
    t: (key: string, opts?: Record<string, unknown>) =>
      opts ? `${key}:${Object.values(opts).join(",")}` : key,
  }),
}));

const idea = {
  id: "i1",
  title: "Castelo",
  note: "",
  category: "sight",
  priority: "optional",
  itemId: null,
} as unknown as PlanIdea;

function setup(extra: Partial<PlanCtx> = {}) {
  const plan = planFixture();
  plan.state = { ...plan.state, ideas: [idea] };
  const mutate = vi.fn().mockResolvedValue(true);
  const ctx = {
    plan,
    state: plan.state,
    busy: false,
    day: "2026-11-02",
    setDay: vi.fn(),
    days: ["2026-11-01", "2026-11-02"],
    edit: vi.fn(),
    mutate,
    query: "",
    setQuery: vi.fn(),
    ...extra,
  } as unknown as PlanCtx;
  render(<WorkspaceSection ctx={ctx} />);
  return mutate;
}

describe("ideas tray assignment (spec 5.8)", () => {
  it("assigns an idea dropped on a day chip to that day", () => {
    const mutate = setup();
    const data = { [IDEA_DRAG_TYPE]: "i1" };
    fireEvent.drop(screen.getByTestId("day-drop-2026-11-01"), {
      dataTransfer: {
        types: [IDEA_DRAG_TYPE],
        getData: (k: string) => data[k as keyof typeof data] ?? "",
      },
    });
    expect(mutate).toHaveBeenCalledWith({
      type: "assign_idea",
      ideaId: "i1",
      day: "2026-11-01",
      time: null,
      duration: null,
    });
  });

  it("offers a tap assignment to the selected day for touch and keyboard", () => {
    const mutate = setup();
    fireEvent.click(screen.getByRole("button", { name: "assignToDay:2026-11-02" }));
    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({ ideaId: "i1", day: "2026-11-02" })
    );
  });

  it("keeps the time and duration already planned when an idea moves to another day", () => {
    const item = { id: "x", time: "10:30", duration: 90 } as PlanItem;
    expect(
      assignIdeaToDay({ ideas: [{ ...idea, itemId: "x" }], items: [item] }, "i1", "2026-11-05")
    ).toMatchObject({ day: "2026-11-05", time: "10:30", duration: 90 });
  });
});
