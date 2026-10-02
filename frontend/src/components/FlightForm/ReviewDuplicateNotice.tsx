import type { DuplicateFlight } from "./flightFormModel";
import { useTranslation } from "../../hooks/useTranslation";

/** A notice, not an error: the warning tone, from the token layer. */
const NOTICE_STYLE = {
  color: "var(--ts-text)",
  borderColor: "color-mix(in srgb, var(--warning) 45%, transparent)",
  background: "color-mix(in srgb, var(--warning) 12%, transparent)",
} as const;

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
    <div role="alert" className="space-y-3 rounded-lg border p-4" style={NOTICE_STYLE}>
      <p>{t("flights:review.duplicate.message", { flightNumber: existing.flightNumber, route })}</p>
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
