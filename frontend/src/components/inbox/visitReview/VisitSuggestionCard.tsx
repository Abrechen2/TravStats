import { useState, type JSX } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import { useDisplayFormat } from "../../../lib/displayFormat";
import type { PhotoJourney } from "../../../types/photoJourney";
import Button from "../../ui/Button";
import PhotoJourneyPreviewStrip from "../PhotoJourneyPreviewStrip";
import { photoJourneySpan } from "../photoJourneySpan";

import { needsName, type VisitCorrection } from "./reviewItems";
import type { ReviewFailure } from "./useVisitReview";
import { visitReasoning } from "./visitReasoning";
import VisitSuggestionCorrection from "./VisitSuggestionCorrection";

/**
 * One visit suggestion in the review (forgejo#211, O5): place, when, and the
 * reasoning together — photographs, how long, the trip, the nearest visit
 * already logged — with the preview strip as the evidence, a checkbox for the
 * batch and the two answers for this one alone.
 *
 * A suggestion a visit logged SINCE the scan already explains (same day,
 * within 200 m) is not hidden: it is flagged, because accepting it would
 * record the stop twice, and the reader decides.
 */
export default function VisitSuggestionCard({
  journey,
  label,
  selected,
  busy,
  correction,
  failure,
  onToggle,
  onCorrect,
  onAccept,
  onDismiss,
}: {
  journey: PhotoJourney;
  label: string;
  selected: boolean;
  busy: boolean;
  correction: VisitCorrection;
  failure: ReviewFailure | undefined;
  onToggle: () => void;
  onCorrect: (next: VisitCorrection) => void;
  onAccept: () => void;
  onDismiss: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["dataQuality"]);
  const format = useDisplayFormat();
  const [correcting, setCorrecting] = useState(false);
  const base = "dataQuality:inbox.photoJourneys";
  const checkboxId = `visit-select-${journey.id}`;
  const headingId = `visit-heading-${journey.id}`;
  const nameMissing = needsName(journey, correction);
  const explained = journey.nearestVisit?.withinReach === true;
  const changed =
    correction.place !== undefined ||
    correction.local !== undefined ||
    correction.name !== undefined ||
    correction.localName !== undefined;

  return (
    <article
      aria-labelledby={headingId}
      className="rounded-[var(--ts-radius-card)] p-4"
      style={{
        background: "var(--ts-surface)",
        border: `1px solid ${selected ? "var(--ts-accent)" : "var(--ts-border)"}`,
      }}
    >
      <div className="flex items-start" style={{ gap: "var(--ts-space-md)" }}>
        <label
          htmlFor={checkboxId}
          className="flex shrink-0 items-center justify-center pointer-coarse:min-h-(--ts-size-touch-min) pointer-coarse:min-w-(--ts-size-touch-min)"
        >
          <input
            id={checkboxId}
            type="checkbox"
            checked={selected}
            onChange={onToggle}
            aria-label={t(`${base}.review.selectOne`, { label })}
            style={{ width: 20, height: 20, accentColor: "var(--ts-accent)" }}
          />
        </label>
        <div className="min-w-0 flex-1">
          <span className="t-caption" style={{ fontFamily: "var(--ts-font-mono)" }}>
            {photoJourneySpan(journey, format)}
          </span>
          <h3
            id={headingId}
            style={{ fontSize: 16, fontWeight: 700, color: "var(--ts-text-bright)" }}
          >
            {label}
          </h3>
          <ul
            className="t-caption mt-1 flex flex-wrap gap-x-3"
            aria-label={t(`${base}.review.reasonLabel`)}
          >
            {visitReasoning(journey, t, i18n.language).map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        </div>
      </div>

      <PhotoJourneyPreviewStrip journey={journey} />

      {explained && (
        <p className="mt-3 text-sm" role="note" style={{ color: "var(--ts-warn)" }}>
          {t(`${base}.review.alreadyVisited`, { name: journey.nearestVisit!.placeName })}
        </p>
      )}
      {nameMissing && !correcting && (
        <p className="t-caption mt-3">{t(`${base}.review.nameNeeded`)}</p>
      )}
      {failure && (
        <p className="mt-3 text-sm" role="alert" style={{ color: "var(--ts-bad)" }}>
          {t(`${base}.review.failure.${failure.code}`)}
        </p>
      )}

      {correcting && (
        <VisitSuggestionCorrection journey={journey} correction={correction} onChange={onCorrect} />
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="primary" onClick={onAccept} disabled={busy || nameMissing}>
          {changed ? t(`${base}.review.acceptCorrected`) : t(`${base}.actions.accept`)}
        </Button>
        <Button onClick={onDismiss} disabled={busy}>
          {t(`${base}.actions.dismiss`)}
        </Button>
        <Button onClick={() => setCorrecting((open) => !open)} aria-expanded={correcting}>
          {correcting ? t(`${base}.review.correctClose`) : t(`${base}.review.correct`)}
        </Button>
      </div>
    </article>
  );
}
