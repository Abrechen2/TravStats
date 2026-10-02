import { useEffect, useRef } from "react";

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
 *
 * It sits at the top of a long form while "Bestätigen" is at the bottom, so
 * on its own it appeared out of sight and the click seemed to do nothing
 * (browser check, 2026-10-02). It scrolls itself into view and takes focus on
 * its first action, which also keeps keyboard users inside the answer.
 */
export default function ReviewDuplicateNotice({
  existing,
  onCancel,
}: ReviewDuplicateNoticeProps): JSX.Element {
  const { t } = useTranslation(["flights"]);
  const route = `${existing.depIata ?? "?"} → ${existing.arrIata ?? "?"}`;
  const noticeRef = useRef<HTMLDivElement>(null);
  const openRef = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    // The whole notice, message first; focusing without scrolling keeps the
    // browser from scrolling again to just the link and cutting the message.
    noticeRef.current?.scrollIntoView?.({ block: "start" });
    openRef.current?.focus({ preventScroll: true });
  }, [existing.id]);
  return (
    <div
      ref={noticeRef}
      role="alert"
      // Clears the review's sticky header when scrolled to.
      className="scroll-mt-24 space-y-3 rounded-lg border p-4"
      style={NOTICE_STYLE}
    >
      <p>{t("flights:review.duplicate.message", { flightNumber: existing.flightNumber, route })}</p>
      <div className="flex flex-wrap gap-2">
        <a ref={openRef} href={`/flights/${existing.id}`} className="btn-primary">
          {t("flights:review.duplicate.openExisting")}
        </a>
        <button type="button" onClick={onCancel} className="btn-secondary">
          {t("flights:review.duplicate.cancelImport")}
        </button>
      </div>
    </div>
  );
}
