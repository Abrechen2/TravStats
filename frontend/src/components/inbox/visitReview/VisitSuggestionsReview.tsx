import { useId, type JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import type { PhotoJourney } from "../../../types/photoJourney";
import Button from "../../ui/Button";
import { photoJourneyLabel } from "../photoJourneyLabel";

import { needsName } from "./reviewItems";
import { useVisitReview } from "./useVisitReview";
import VisitSuggestionCard from "./VisitSuggestionCard";

/**
 * The review of the `visit` suggestions — stops inside a recorded trip that
 * no visit explains (forgejo#211, O5). Several can be selected and accepted or
 * rejected in one answer; each can be corrected first. The answer goes to the
 * server as ONE batch, and its per-item result is shown per item: what failed
 * stays selected, names its reason, and is listed at the top so a failure on a
 * row that has since left the list is not lost either.
 *
 * Keyboard: every control is a native checkbox or button in reading order.
 * Touch: the checkbox's label is the touch target on a coarse pointer, and the
 * buttons are the design's own heights.
 */
export default function VisitSuggestionsReview({
  journeys,
  onAnswered,
}: {
  journeys: readonly PhotoJourney[];
  onAnswered: () => Promise<void>;
}): JSX.Element {
  const { t } = useTranslation(["dataQuality"]);
  const review = useVisitReview(journeys, onAnswered);
  const base = "dataQuality:inbox.photoJourneys.review";
  const headingId = useId();
  const selectAllId = useId();

  const ids = journeys.map((row) => row.id);
  // A selection can outlive its rows (answered elsewhere, reloaded away).
  const selectedIds = ids.filter((id) => review.selected.has(id));
  const allSelected = selectedIds.length === ids.length && ids.length > 0;
  const working = review.busy.size > 0;
  const unnamed = journeys.filter(
    (row) => review.selected.has(row.id) && needsName(row, review.corrections[row.id])
  ).length;

  return (
    <section aria-labelledby={headingId} className="mb-6">
      <h2 id={headingId} className="t-label-mono">
        {t(`${base}.title`)}
      </h2>
      <p className="t-caption mb-3">{t(`${base}.description`)}</p>

      {review.requestFailed && (
        <p role="alert" className="mb-3 text-sm" style={{ color: "var(--ts-bad)" }}>
          {t(`${base}.requestFailed`)}
        </p>
      )}
      {review.failures.length > 0 && (
        <div role="alert" className="mb-3 text-sm" style={{ color: "var(--ts-bad)" }}>
          <p style={{ fontWeight: 600 }}>
            {t(`${base}.failedHeading`, { count: review.failures.length })}
          </p>
          <ul className="mt-1 list-disc pl-5">
            {review.failures.map((failure) => (
              <li key={failure.id}>
                {failure.label}: {t(`${base}.failure.${failure.code}`)}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div
        className="mb-3 flex flex-wrap items-center rounded-[var(--ts-radius-card)] p-3"
        style={{
          gap: "var(--ts-space-md)",
          background: "var(--ts-surface)",
          border: "1px solid var(--ts-border)",
        }}
      >
        <label
          htmlFor={selectAllId}
          className="flex items-center pointer-coarse:min-h-(--ts-size-touch-min)"
          style={{ gap: "var(--ts-space-sm)" }}
        >
          <input
            id={selectAllId}
            type="checkbox"
            checked={allSelected}
            onChange={() => review.setAll(ids, !allSelected)}
            style={{ width: 20, height: 20, accentColor: "var(--ts-accent)" }}
          />
          <span>{t(`${base}.selectAll`)}</span>
        </label>
        <span className="t-caption" aria-live="polite">
          {working ? t(`${base}.working`) : t(`${base}.selected`, { count: selectedIds.length })}
        </span>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button
            variant="primary"
            disabled={working || selectedIds.length === 0 || unnamed > 0}
            onClick={() => void review.answer(selectedIds, "accept")}
          >
            {t(`${base}.acceptSelected`, { count: selectedIds.length })}
          </Button>
          <Button
            disabled={working || selectedIds.length === 0}
            onClick={() => void review.answer(selectedIds, "dismiss")}
          >
            {t(`${base}.dismissSelected`, { count: selectedIds.length })}
          </Button>
        </div>
        {unnamed > 0 && (
          <p className="t-caption w-full">{t(`${base}.unnamedSelected`, { count: unnamed })}</p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {journeys.map((journey) => (
          <VisitSuggestionCard
            key={journey.id}
            journey={journey}
            label={photoJourneyLabel(journey)}
            selected={review.selected.has(journey.id)}
            busy={review.busy.has(journey.id)}
            correction={review.corrections[journey.id] ?? {}}
            failure={review.failures.find((failure) => failure.id === journey.id)}
            onToggle={() => review.toggle(journey.id)}
            onCorrect={(next) => review.correct(journey.id, next)}
            onAccept={() => void review.answer([journey.id], "accept")}
            onDismiss={() => void review.answer([journey.id], "dismiss")}
          />
        ))}
      </div>
    </section>
  );
}
