import type { DuplicateFlight } from "./flightFormModel";
import { useTranslation } from "../../hooks/useTranslation";

interface ReviewDuplicateNoticeProps {
  existing: DuplicateFlight;
  onCancel: () => void;
}

/**
 * The parser review's answer to a 409 DUPLICATE_FLIGHT: the flight is already
 * in the logbook (forgejo#159).
 *
 * Not an error. The inputs were right — reading the same confirmation twice is
 * ordinary — so the review names the existing flight and offers the two ways
 * forward: look at it, or drop this import.
 */
export default function ReviewDuplicateNotice({
  existing,
  onCancel,
}: ReviewDuplicateNoticeProps): JSX.Element {
  const { t } = useTranslation(["flights"]);
  const route = `${existing.depIata ?? "?"} → ${existing.arrIata ?? "?"}`;
  return (
    <div role="alert" className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg space-y-3">
      <p className="text-yellow-900">
        {t("flights:review.duplicate.message", { flightNumber: existing.flightNumber, route })}
      </p>
      <div className="flex flex-wrap gap-2">
        <a href={`/flights/${existing.id}`} className="btn-primary">
          {t("flights:review.duplicate.openExisting")}
        </a>
        <button type="button" onClick={onCancel} className="btn-secondary">
          {t("flights:review.duplicate.cancelImport")}
        </button>
      </div>
    </div>
  );
}
