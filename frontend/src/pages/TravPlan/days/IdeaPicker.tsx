import { Select } from "../../../components/ui";
import { useTranslation } from "../../../hooks/useTranslation";
import type { PlanIdea, PlanState } from "../../../lib/api/travplan";

const PRIORITY = { must: 0, optional: 1, maybe: 2 } as const;

/** Ideas that are on no day yet, must-dos first. */
export function unplannedIdeas(state: Pick<PlanState, "ideas" | "items">): PlanIdea[] {
  const dated = new Set(state.items.filter((i) => i.day !== null).map((i) => i.id));
  return state.ideas
    .filter((idea) => idea.itemId === null || !dated.has(idea.itemId))
    .sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority]);
}

/** "Put an idea on this day" right where the day is read; the card chooses the day. */
export function IdeaPicker({
  day,
  ideas,
  busy,
  onAssign,
}: {
  day: string;
  ideas: PlanIdea[];
  busy: boolean;
  onAssign: (ideaId: string, day: string) => void;
}) {
  const { t } = useTranslation("travplan");
  if (!ideas.length) return null;
  return (
    <Select
      aria-label={t("days.pickIdea")}
      value=""
      disabled={busy}
      onChange={(e) => e.target.value && onAssign(e.target.value, day)}
      style={{ width: "16rem", flex: "none" }}
    >
      <option value="">{t("days.pickIdeaPrompt", { count: ideas.length })}</option>
      {ideas.map((idea) => (
        <option key={idea.id} value={idea.id}>
          {idea.title}
          {idea.priority === "must" ? " · " + t("options.must") : ""}
        </option>
      ))}
    </Select>
  );
}
