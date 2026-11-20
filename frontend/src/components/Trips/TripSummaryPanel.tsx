import type { JSX } from "react";
import type { useTranslation } from "../../hooks/useTranslation";
import type { Trip } from "../../types";

export { summaryLanguageOf } from "./useTripSummaryAction";

/**
 * The LLM trip summary on the trip overview — only SHOWS one. Creating or
 * re-creating it is an entry of the head's "Mehr" menu (`TripMoreMenu`,
 * `useTripSummaryAction`): it is used once per trip, and a card inviting the
 * action on every trip page was louder than that. A trip without a summary
 * draws nothing here. An existing summary stays visible whatever the gates
 * say — it is content the user created, and hiding it would look like data
 * loss.
 */
export function TripSummaryPanel({
  trip,
  t,
}: {
  trip: Trip;
  t: ReturnType<typeof useTranslation>["t"];
}): JSX.Element | null {
  if (!trip.summary) return null;
  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <div
        className="text-[10px] uppercase tracking-wide flex items-center gap-1.5 mb-2"
        style={{ color: "var(--text-muted)" }}
      >
        <span aria-hidden>✨</span>
        {t("trips:summary.title")}
      </div>
      <div className="text-sm whitespace-pre-wrap leading-relaxed">{trip.summary}</div>
    </div>
  );
}

export default TripSummaryPanel;
