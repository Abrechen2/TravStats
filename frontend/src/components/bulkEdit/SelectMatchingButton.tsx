import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import { BULK_SELECT_MAX } from "../../lib/collectPages";

const BAR_BUTTON =
  "rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--bg-surface)] disabled:opacity-50 pointer-coarse:min-h-(--ts-size-touch-min)";

/**
 * What a list offers its bulk bar to select beyond the page in view: the
 * number the server counted for the CURRENT filter, and the way to read
 * exactly those rows through that same filter.
 */
export interface SelectMatching<Row> {
  /** The server's count of matches — the preview the button names. */
  total: number;
  /** Entries the page shows, when a row of it is not one entry (a rail ride's legs). */
  shown?: number;
  resolve: () => Promise<readonly Row[]>;
}

/**
 * "Alle N Treffer auswählen": shown only while there are matches the page
 * does not hold. It reads the full set through the list's own filter, hands it
 * to `onSelect`, and says a failure instead of leaving the selection as it was
 * without a word.
 */
export default function SelectMatchingButton<Row>({
  matching,
  pageCount,
  onSelect,
}: {
  matching: SelectMatching<Row> | undefined;
  /** How many matches the page in view already holds. */
  pageCount: number;
  onSelect: (rows: readonly Row[]) => void;
}): JSX.Element | null {
  const { t } = useTranslation(["bulkEdit"]);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (!matching || matching.total <= (matching.shown ?? pageCount)) return null;
  if (matching.total > BULK_SELECT_MAX) {
    return (
      <span role="note" className="text-xs text-[var(--text-muted)]">
        {t("bulkEdit:selectMatchingTooMany", { count: matching.total, max: BULK_SELECT_MAX })}
      </span>
    );
  }
  const run = async (): Promise<void> => {
    setBusy(true);
    setFailed(false);
    try {
      onSelect(await matching.resolve());
    } catch (err: unknown) {
      logger.error("SelectMatchingButton: could not read all matches", err);
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className={BAR_BUTTON}
        onClick={() => void run()}
        disabled={busy}
        data-testid="bulk-select-matching"
      >
        {t("bulkEdit:selectMatching", { count: matching.total })}
      </button>
      {failed && (
        <span role="alert" className="text-xs text-[var(--danger)]">
          {t("bulkEdit:selectMatchingFailed")}
        </span>
      )}
    </>
  );
}
