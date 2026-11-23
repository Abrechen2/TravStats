import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import type { BulkDomain } from "../../shared/bulkEditFields";
import DomainBulkEditModal from "./DomainBulkEditModal";
import SelectMatchingButton, { type SelectMatching } from "./SelectMatchingButton";
import type { BulkRow, RowSelection } from "./useRowSelection";

const BAR_BUTTON =
  "rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm hover:bg-[var(--bg-surface)] disabled:opacity-50 pointer-coarse:min-h-(--ts-size-touch-min)";

/** The list header's entry into selection mode; hidden while selecting. */
export function BulkStartButton({ selection }: { selection: RowSelection }): JSX.Element | null {
  const { t } = useTranslation(["bulkEdit"]);
  if (selection.selecting) return null;
  return (
    <button
      type="button"
      className="btn-secondary whitespace-nowrap pointer-coarse:min-h-(--ts-size-touch-min)"
      onClick={selection.start}
    >
      {t("bulkEdit:start")}
    </button>
  );
}

/**
 * The selection's own bar (forgejo#405 A4): how many are chosen, "alle auf
 * dieser Seite", "Auswahl aufheben" and the one action that acts on them. Shown
 * only while selecting, so the ordinary list stays as it was.
 */
export default function DomainBulkBar({
  domain,
  selection,
  pageRows,
  matching,
  onApplied,
}: {
  domain: BulkDomain;
  selection: RowSelection;
  pageRows: readonly BulkRow[];
  /** "Alle N Treffer auswählen": every match of the current filter, past the page. */
  matching?: SelectMatching<BulkRow>;
  /** After any row changed — the list reloads. */
  onApplied: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["bulkEdit"]);
  // A snapshot: the edit clears the selection when it lands, the modal keeps its rows.
  const [editing, setEditing] = useState<readonly BulkRow[] | null>(null);
  if (!selection.selecting) return null;
  const count = selection.selected.size;
  const noun = t(`bulkEdit:noun.${domain}`, { count });
  return (
    <div
      className="mb-3 flex flex-wrap items-center rounded-md p-2"
      style={{ gap: 8, background: "var(--bg-elevated)", border: "1px solid var(--color-border)" }}
      data-testid="domain-bulk-bar"
    >
      <span role="status" className="mr-auto text-sm font-semibold">
        {t("bulkEdit:selected", { count, noun })}
      </span>
      <button type="button" className={BAR_BUTTON} onClick={() => selection.selectAll(pageRows)}>
        {t("bulkEdit:selectPage")}
      </button>
      <SelectMatchingButton
        matching={matching}
        pageCount={pageRows.length}
        onSelect={selection.selectAll}
      />
      <button type="button" className={BAR_BUTTON} onClick={selection.clear} disabled={count === 0}>
        {t("bulkEdit:clearSelection")}
      </button>
      <button
        type="button"
        className={`${BAR_BUTTON} btn-primary`}
        onClick={() => setEditing([...selection.selected.values()])}
        disabled={count === 0}
      >
        {t("bulkEdit:edit", { count, noun })}
      </button>
      <button type="button" className={BAR_BUTTON} onClick={selection.stop}>
        {t("bulkEdit:stop")}
      </button>
      {editing ? (
        <DomainBulkEditModal
          domain={domain}
          rows={editing}
          onClose={() => setEditing(null)}
          onApplied={() => {
            // The rows' versions moved with the write: a second edit from the
            // old copies would meet its own VERSION_CONFLICT, so start over.
            selection.clear();
            onApplied();
          }}
        />
      ) : null}
    </div>
  );
}
