import { useState } from "react";
import { Select } from "../../../components/ui";
import { useTranslation } from "../../../hooks/useTranslation";
import type { PlanIdea, PlanState } from "../../../lib/api/travplan";
import { planDay } from "../format";

const PRIORITY = { must: 0, optional: 1, maybe: 2 } as const;

/** Ideas that are on no day yet, must-dos first. */
export function unplannedIdeas(state: Pick<PlanState, "ideas" | "items">): PlanIdea[] {
  const dated = new Set(state.items.filter((i) => i.day !== null).map((i) => i.id));
  return state.ideas
    .filter((idea) => idea.itemId === null || !dated.has(idea.itemId))
    .sort((a, b) => PRIORITY[a.priority] - PRIORITY[b.priority]);
}

/**
 * "Put an idea on this day" right where the day is read. A folded span of quiet days first
 * asks which of its days; a single day does not.
 */
export function IdeaPicker({
  days,
  ideas,
  busy,
  onAssign,
}: {
  days: string[];
  ideas: PlanIdea[];
  busy: boolean;
  onAssign: (ideaId: string, day: string) => void;
}) {
  const { t } = useTranslation("travplan"),
    [day, setDay] = useState(days[0]);
  if (!ideas.length || !days.length) return null;
  return (
    <div className="flex flex-wrap items-center" style={{ gap: "var(--ts-space-sm)" }}>
      {days.length > 1 && (
        <Select
          aria-label={t("days.pickDay")}
          value={day}
          disabled={busy}
          onChange={(e) => setDay(e.target.value)}
          style={{ width: "12rem", flex: "none" }}
        >
          {days.map((d) => (
            <option key={d} value={d}>
              {planDay(d)}
            </option>
          ))}
        </Select>
      )}
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
    </div>
  );
}
