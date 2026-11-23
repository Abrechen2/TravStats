import { useCallback, useEffect, useRef } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";

/** Marks a row of an import review that still waits for the user. */
export const OPEN_ITEM_ATTR = "data-open-item";

const BUTTON =
  "rounded-md border border-[var(--color-border)] px-3 py-1.5 text-xs text-[var(--text-primary)] hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50 pointer-coarse:min-h-(--ts-size-touch-min)";

const FOCUSABLE =
  "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled])";

/**
 * Moves the cursor to the next row marked as open, after the one the cursor is
 * in (or the first, from outside the list), wrapping round at the end. Returns
 * whether a row was found. Reads the DOM on purpose: the three review dialogs
 * keep different row models, but all of them can mark an open row.
 */
export function focusNextOpenItem(scope: ParentNode): boolean {
  const open = [...scope.querySelectorAll<HTMLElement>(`[${OPEN_ITEM_ATTR}="true"]`)];
  if (open.length === 0) return false;
  const active = document.activeElement;
  let target = open[0];
  if (active instanceof HTMLElement) {
    // A row counts as "before" the cursor when it precedes the active element.
    const after = open.find(
      (row) =>
        !row.contains(active) &&
        (active.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    );
    if (after) target = after;
  }
  target.scrollIntoView?.({ block: "center" });
  const control = target.querySelector<HTMLElement>(FOCUSABLE);
  (control ?? target).focus();
  return true;
}

function typingInto(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target.isContentEditable ||
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/**
 * The review's shortcuts for a long list: take every OBVIOUS row as the
 * server recommended it, skip every obvious duplicate, and jump to the next
 * row that still needs an answer ("N" on the keyboard, outside a field).
 * Obvious means the dialog's own model found nothing to ask — a flagged,
 * guessed or half-placed row is never in either count.
 */
export default function ImportReviewBar({
  obviousNew,
  obviousDuplicates,
  openCount,
  onTakeNew,
  onSkipDuplicates,
  disabled = false,
}: {
  /** Obvious new rows not yet set to be written. */
  obviousNew: number;
  /** Obvious duplicates not yet set to be skipped. */
  obviousDuplicates: number;
  /** Rows that still wait for the user. */
  openCount: number;
  onTakeNew: () => void;
  onSkipDuplicates: () => void;
  disabled?: boolean;
}): JSX.Element {
  const { t } = useTranslation(["common"]);
  const barRef = useRef<HTMLDivElement>(null);
  const next = useCallback((): void => {
    focusNextOpenItem(barRef.current?.parentElement ?? document);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key.toLowerCase() !== "n" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (typingInto(e.target)) return;
      e.preventDefault();
      next();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [next]);

  return (
    <div
      ref={barRef}
      className="mb-3 flex flex-wrap items-center gap-2"
      data-testid="import-review-bar"
    >
      <button
        type="button"
        className={BUTTON}
        disabled={disabled || obviousNew === 0}
        onClick={onTakeNew}
        data-testid="import-take-obvious"
      >
        {t("common:importReview.takeObvious", { count: obviousNew })}
      </button>
      <button
        type="button"
        className={BUTTON}
        disabled={disabled || obviousDuplicates === 0}
        onClick={onSkipDuplicates}
        data-testid="import-skip-obvious"
      >
        {t("common:importReview.skipObvious", { count: obviousDuplicates })}
      </button>
      <button
        type="button"
        className={BUTTON}
        disabled={openCount === 0}
        onClick={next}
        aria-keyshortcuts="N"
        data-testid="import-next-open"
      >
        {t("common:importReview.nextOpen", { count: openCount })}
      </button>
    </div>
  );
}
