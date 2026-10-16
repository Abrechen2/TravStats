import { useId, type JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import type { PhotoJourney } from "../../../types/photoJourney";
import Button from "../../ui/Button";

import { needsName } from "./reviewItems";
import type { VisitReviewState } from "./useVisitReview";

/**
 * Answering several visit suggestions at once (forgejo#211, O5): stops inside
 * a recorded trip come in dozens, and one click per stop is the reason that
 * review existed. The cards carry the checkboxes; this bar selects them all,
 * answers the selection in ONE request, and names every item that failed and
 * why — including one that has since left the list.
 *
 * Keyboard: a native checkbox and two buttons in reading order. Touch: the
 * checkbox's label is the touch target on a coarse pointer.
 */
export default function VisitBatchBar({
  journeys,
  review,
}: {
  /** The visit suggestions currently on screen — "select all" means these. */
  journeys: readonly PhotoJourney[];
  review: VisitReviewState;
}): JSX.Element {
  const { t } = useTranslation(["dataQuality"]);
  const base = "dataQuality:inbox.photoJourneys.review";
  const selectAllId = useId();
  const ids = journeys.map((row) => row.id);
  // A selection can outlive its rows (answered elsewhere, filtered away).
  const selectedIds = ids.filter((id) => review.selected.has(id));
  const allSelected = selectedIds.length === ids.length && ids.length > 0;
  const working = review.busy.size > 0;
  const unnamed = journeys.filter(
    (row) => review.selected.has(row.id) && needsName(row, review.corrections[row.id])
  ).length;

  return (
    <section aria-label={t(`${base}.title`)} className="space-y-3">
      <p className="t-caption">{t(`${base}.description`)}</p>
      {review.requestFailed && (
        <p role="alert" className="text-sm text-(--ts-bad)">
          {t(`${base}.requestFailed`)}
        </p>
      )}
      {review.failures.length > 0 && (
        <div role="alert" className="text-sm text-(--ts-bad)">
          <p className="font-semibold">
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
        className="flex flex-wrap items-center rounded-[var(--ts-radius-card)] border border-(--ts-border) bg-(--ts-surface) p-3"
        style={{ gap: "var(--ts-space-md)" }}
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
    </section>
  );
}
