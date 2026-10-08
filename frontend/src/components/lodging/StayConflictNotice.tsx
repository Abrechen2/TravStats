import { useEffect, useRef } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { formatStayPeriod } from "../../lib/lodgingDateDisplay";
import type { StayConflictNotice as Notice } from "../../hooks/useStayConflicts";

interface StayConflictNoticeProps {
  notice: Notice;
  checking: boolean;
  /** "Absichtlich so" - the user knows, save anyway. */
  onProceed: () => void;
  /** Take the user back to the dates. */
  onChangeDates: () => void;
  /** Look again (after a failed lookup). */
  onRetry: () => void;
}

/**
 * Said when the dates of the stay being saved collide with stored ones
 * (forgejo#229) or repeat a stay of the same house (forgejo#227).
 *
 * A question, not an error: it names each stored stay with its house and
 * period, explains the rule in one line (so a hand-over day and two rooms do
 * not read as accusations), and answers either way - "Absichtlich so
 * speichern" or back to the dates. It takes focus when it appears, so a screen
 * reader hears it and the keyboard lands on the answer.
 */
export function StayConflictNotice({
  notice,
  checking,
  onProceed,
  onChangeDates,
  onRetry,
}: StayConflictNoticeProps): JSX.Element {
  const { t, i18n } = useTranslation(["lodging", "common"]);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.focus();
    if (typeof ref.current?.scrollIntoView === "function") {
      ref.current.scrollIntoView({ block: "center" });
    }
  }, []);

  const duplicate = notice.conflicts.some((c) => c.sameHouse);
  const title = notice.unchecked
    ? t("lodging:conflict.unchecked")
    : duplicate
      ? t("lodging:conflict.titleDuplicate")
      : t("lodging:conflict.title");

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="group"
      aria-labelledby="stay-conflict-title"
      data-testid="stay-conflict-notice"
      className="mt-3 rounded-md border border-[var(--accent)]/60 bg-[var(--accent)]/10 px-3 py-3 text-sm text-[var(--text-primary)]"
    >
      <p id="stay-conflict-title" className="font-medium">
        {title}
      </p>
      {!notice.unchecked && (
        <>
          <ul className="mt-2 list-disc pl-5">
            {notice.conflicts.map(({ stay, sameHouse }) => (
              <li key={stay.id} data-testid={`stay-conflict-${stay.id}`}>
                <span className="font-medium">{stay.lodging.name}</span>
                {sameHouse && (
                  <span className="ml-1 text-xs text-[var(--text-muted)]">
                    ({t("lodging:conflict.sameHouse")})
                  </span>
                )}
                {" · "}
                {formatStayPeriod(stay, i18n.language, t).label}
                {stay.roomNumber
                  ? ` · ${t("lodging:stayView.room", { room: stay.roomNumber })}`
                  : ""}
              </li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-[var(--text-muted)]">{t("lodging:conflict.rule")}</p>
        </>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          data-testid="stay-conflict-proceed"
          onClick={onProceed}
          className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-(--ts-accent-text) hover:bg-[var(--accent-dim)] pointer-coarse:min-h-(--ts-size-touch-min)"
        >
          {notice.unchecked ? t("lodging:conflict.saveAnyway") : t("lodging:conflict.proceed")}
        </button>
        {notice.unchecked ? (
          <button
            type="button"
            onClick={onRetry}
            disabled={checking}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm disabled:opacity-50 pointer-coarse:min-h-(--ts-size-touch-min)"
          >
            {t("lodging:conflict.retry")}
          </button>
        ) : (
          <button
            type="button"
            onClick={onChangeDates}
            className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm pointer-coarse:min-h-(--ts-size-touch-min)"
          >
            {t("lodging:conflict.changeDates")}
          </button>
        )}
      </div>
    </div>
  );
}
