import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useConfirmDialog } from "../../../hooks/useConfirmDialog";
import { logger } from "../../../lib/logger";
import type { SmartSuggestion } from "../../../lib/api/smartLists";
import Toggletip from "../../ui/Toggletip";
import { SuggestionRow, acceptSuggestion, answerErrorKey } from "./SuggestionRow";

/**
 * "Ausstehende Bestätigungen" of one smart list (owner 2026-11-26): the visits its rule found at
 * places the owner already has, answered inline or all at once after a confirmation. A refused
 * answer is named with the place it belonged to; the rest still go through.
 */
export default function PendingConfirmations({
  rows,
  total,
  onAnswered,
}: {
  rows: SmartSuggestion[];
  /** Every pending confirmation; `rows` holds the newest of them. */
  total: number;
  onAnswered: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["places", "common"]);
  const { confirm, confirmDialog } = useConfirmDialog();
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<{ name: string; key: string }[]>([]);

  const acceptAll = async (): Promise<void> => {
    const ok = await confirm({
      title: t("places:smartList.pending.allTitle"),
      message: t("places:smartList.pending.allMessage", { count: rows.length }),
      // "Alle" confirms the rows shown; with more pending, the rest come with the next read.
      confirmText: t("places:smartList.pending.all"),
    });
    if (!ok) return;
    setBusy(true);
    const failed: { name: string; key: string }[] = [];
    for (const row of rows) {
      try {
        await acceptSuggestion(row);
      } catch (err: unknown) {
        logger.error({ err }, "PendingConfirmations: one confirmation was refused");
        failed.push({ name: row.name ?? "–", key: answerErrorKey(err) });
      }
    }
    setFailures(failed);
    setBusy(false);
    onAnswered();
  };

  if (rows.length === 0 && failures.length === 0) return null;
  return (
    <div className="mt-4" data-testid="smart-list-pending">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {t("places:smartList.pending.title", { count: Math.max(total, rows.length) })}
        </h2>
        <Toggletip content={t("places:smartList.pending.info")} />
        {rows.length > 1 && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void acceptAll()}
            className="ml-auto rounded-lg px-3 py-1 text-sm disabled:opacity-50"
            style={{ border: "1px solid var(--color-border)", color: "var(--text-secondary)" }}
          >
            {t("places:smartList.pending.all")}
          </button>
        )}
      </div>
      {failures.length > 0 && (
        <ul role="alert" className="mb-2 text-sm" style={{ color: "var(--danger)" }}>
          {failures.map((f, i) => (
            <li key={i}>
              {f.name}: {t(f.key)}
            </li>
          ))}
        </ul>
      )}
      <ul className="grid gap-2" style={{ listStyle: "none", padding: 0 }}>
        {rows.map((row) => (
          <SuggestionRow
            key={row.id}
            suggestion={row}
            title={row.name ?? undefined}
            onAnswered={onAnswered}
          />
        ))}
      </ul>
      {confirmDialog}
    </div>
  );
}
