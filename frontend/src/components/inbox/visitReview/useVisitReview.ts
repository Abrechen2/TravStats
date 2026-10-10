import { useCallback, useState } from "react";

import { useTranslation } from "../../../hooks/useTranslation";
import {
  photoJourneysApi,
  type PhotoJourneyBatchFailureCode,
  type PhotoJourneyBatchItem,
} from "../../../lib/api/photoJourneys";
import { logger } from "../../../lib/logger";
import { useToastStore } from "../../../store/toastStore";
import type { PhotoJourney } from "../../../types/photoJourney";
import { photoJourneyLabel } from "../photoJourneyLabel";

import { buildReviewItems, type VisitCorrection } from "./reviewItems";

/** One item the last answer could not carry out, named so the reader can find it. */
export interface ReviewFailure {
  id: string;
  label: string;
  action: PhotoJourneyBatchItem["action"];
  code: PhotoJourneyBatchFailureCode;
}

export interface VisitReviewState {
  selected: ReadonlySet<string>;
  corrections: Readonly<Record<string, VisitCorrection>>;
  failures: readonly ReviewFailure[];
  /** Set while an answer is in flight — the ids it carries. */
  busy: ReadonlySet<string>;
  /** The whole request failed: the outcome of every item is unknown. */
  requestFailed: boolean;
  toggle: (id: string) => void;
  setAll: (ids: readonly string[], on: boolean) => void;
  correct: (id: string, next: VisitCorrection) => void;
  answer: (ids: readonly string[], action: PhotoJourneyBatchItem["action"]) => Promise<void>;
}

/**
 * The state of the visit-suggestion review (forgejo#211, O5): what is
 * selected, what the reader corrected, and what the last answer could not do.
 *
 * One request per answer, however many suggestions it carries, and the server
 * reports each item's outcome — so a partial failure is never ambiguous. What
 * failed stays selected and is named with its reason in the reader's language;
 * what succeeded leaves the list when it reloads. When the REQUEST fails (no
 * answer at all), nobody can know which items landed: the list is reloaded so
 * it shows the truth, and the reader is told to look rather than told "failed".
 */
export function useVisitReview(
  journeys: readonly PhotoJourney[],
  onAnswered: () => Promise<void>
): VisitReviewState {
  const { t } = useTranslation(["dataQuality"]);
  const addToast = useToastStore((state) => state.addToast);
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [corrections, setCorrections] = useState<Record<string, VisitCorrection>>({});
  const [failures, setFailures] = useState<readonly ReviewFailure[]>([]);
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const [requestFailed, setRequestFailed] = useState(false);

  const toggle = useCallback((id: string) => {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const setAll = useCallback((ids: readonly string[], on: boolean) => {
    setSelected(on ? new Set(ids) : new Set());
  }, []);

  const correct = useCallback((id: string, next: VisitCorrection) => {
    setCorrections((current) => ({ ...current, [id]: next }));
  }, []);

  const answer = useCallback(
    async (ids: readonly string[], action: PhotoJourneyBatchItem["action"]): Promise<void> => {
      if (ids.length === 0) return;
      const labels = new Map(journeys.map((row) => [row.id, photoJourneyLabel(row)]));
      setBusy(new Set(ids));
      setRequestFailed(false);
      try {
        const response = await photoJourneysApi.review(
          buildReviewItems(ids, action, journeys, corrections)
        );
        const failed: ReviewFailure[] = response.results.flatMap((result) =>
          result.outcome === "failed"
            ? [
                {
                  id: result.id,
                  label: labels.get(result.id) ?? result.id,
                  action: result.action,
                  code: result.code,
                },
              ]
            : []
        );
        setFailures(failed);
        const answered = new Set(
          response.results.filter((r) => r.outcome !== "failed").map((r) => r.id)
        );
        // What failed stays selected, so a corrected retry is one click away.
        setSelected((current) => new Set([...current].filter((id) => !answered.has(id))));
        setCorrections((current) =>
          Object.fromEntries(Object.entries(current).filter(([id]) => !answered.has(id)))
        );
        const { summary } = response;
        addToast(
          summary.failed > 0 ? "warning" : "success",
          t("dataQuality:inbox.photoJourneys.review.summary", {
            accepted: summary.accepted,
            dismissed: summary.dismissed,
            failed: summary.failed,
          })
        );
        const photosDown = response.results.some(
          (r) => r.outcome === "accepted" && r.photos?.kind === "failed"
        );
        if (photosDown) {
          addToast("warning", t("dataQuality:inbox.photoJourneys.messages.photosNotLinked"));
        }
      } catch (error) {
        logger.error("Answering photo suggestions failed:", error);
        setFailures([]);
        setRequestFailed(true);
      } finally {
        setBusy(new Set());
        await onAnswered();
      }
    },
    [journeys, corrections, addToast, t, onAnswered]
  );

  return { selected, corrections, failures, busy, requestFailed, toggle, setAll, correct, answer };
}
