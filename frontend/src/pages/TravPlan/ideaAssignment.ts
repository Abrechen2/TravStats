import type { PlanOperation, PlanState } from "../../lib/api/travplan";

/** The drag payload type; a drop from anywhere else is ignored. */
export const IDEA_DRAG_TYPE = "application/x-travplan-idea";

/**
 * Puts an idea on a day (ideas tray, spec §5.8). An idea that already has an entry keeps that
 * entry's time and duration, so moving it to another day does not wipe what was planned.
 */
export function assignIdeaToDay(
  state: Pick<PlanState, "ideas" | "items">,
  ideaId: string,
  day: string
): Extract<PlanOperation, { type: "assign_idea" }> | null {
  const idea = state.ideas.find((i) => i.id === ideaId);
  if (!idea) return null;
  const item = state.items.find((i) => i.id === idea.itemId);
  return {
    type: "assign_idea",
    ideaId,
    day,
    time: item?.time ?? null,
    duration: item?.duration ?? null,
  };
}
