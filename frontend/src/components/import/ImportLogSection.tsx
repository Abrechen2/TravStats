import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import { logger } from "../../lib/logger";
import { listLodgingImportBatches, revertLodgingImportBatch } from "../../lib/api/lodgingImport";
import { describeLodgingRevertResult } from "../../lib/lodgingImportResult";
import { DOMAINS } from "../../shared/domains";
import type { LodgingImportBatchSummary } from "../../types/lodgingImport";

interface Props {
  /** Runs after a successful revert so a surrounding page (list + stats) can refresh too. */
  onReverted?: () => void | Promise<void>;
  /** Bump this whenever a new import lands elsewhere on the page — triggers a re-fetch here. */
  reloadKey?: unknown;
}

/**
 * The import log — every bulk import run, newest first, each revertible as a
 * unit. It lives in the CENTRAL import hub (Settings → Import) rather than on
 * a domain page, which is the same rule 2.5.0 established for the importers
 * themselves: one place to import, one place to see what was imported.
 *
 * DELIBERATELY HONEST ABOUT ITS SCOPE: only lodging writes import batches
 * today, so every entry carries a domain label and the empty state says which
 * imports can be undone. The flight tiles (FR24, generic CSV) create no batch
 * rows and are not revertible — a log that silently showed nothing for them
 * would read as "no flight imports happened". When a domain gains batches, it
 * adds its source here and its entries appear with their own label.
 *
 * A revert deletes only what that batch created — a batch-created lodging that
 * still has foreign stays (hand-added, or attached by a later batch) survives,
 * detached (`detachedLodgings`). The confirm dialog and the result toast both
 * exist to make that distinction visible, never to hide it.
 */
export function ImportLogSection({ onReverted, reloadKey }: Props): JSX.Element {
  const { t } = useTranslation(["lodging", "settings", "common"]);
  const addToast = useToastStore((s) => s.addToast);

  const [batches, setBatches] = useState<LodgingImportBatchSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<boolean>(false);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [reverting, setReverting] = useState<boolean>(false);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(false);
    try {
      const data = await listLodgingImportBatches();
      setBatches(data);
    } catch (err: unknown) {
      logger.error("ImportLogSection: failed to load import batches", err);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // `reloadKey` is an opaque re-fetch trigger driven by the parent page's
    // own reload cycle (a new import landing elsewhere on the page) — it is
    // intentionally not otherwise read here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load, reloadKey]);

  const handleRevert = useCallback(
    async (batchId: string): Promise<void> => {
      setReverting(true);
      try {
        const result = await revertLodgingImportBatch(batchId);
        const toast = describeLodgingRevertResult(result, t);
        addToast(toast.type, toast.message);
        setConfirmingId(null);
        await load();
        await onReverted?.();
      } catch (err: unknown) {
        logger.error("ImportLogSection: revert failed", err);
        addToast("error", t("lodging:import.batches.revertError"));
      } finally {
        setReverting(false);
      }
    },
    [addToast, load, onReverted, t]
  );

  const confirmingBatch = batches.find((b) => b.id === confirmingId) ?? null;

  return (
    <div
      className="mt-6 rounded-lg p-4"
      style={{ background: "var(--bg-elevated)", border: "1px solid var(--color-border)" }}
    >
      <h3 className="text-base font-semibold" style={{ color: "var(--text-primary)" }}>
        {t("settings:import.log.title")}
      </h3>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        {t("settings:import.log.scopeHint")}
      </p>

      {loading ? (
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          {t("lodging:import.batches.loading")}
        </p>
      ) : loadError ? (
        <div
          role="alert"
          className="mt-2 rounded-md border border-[var(--danger)]/50 bg-[var(--danger)]/10 px-3 py-2 text-sm text-[var(--danger)]"
        >
          {t("lodging:import.batches.loadError")}
        </div>
      ) : batches.length === 0 ? (
        <p className="mt-2 text-sm" style={{ color: "var(--text-muted)" }}>
          {t("lodging:import.batches.empty")}
        </p>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {batches.map((batch) => (
            <li
              key={batch.id}
              className="flex items-center justify-between gap-3 rounded-md border border-[var(--color-border)] px-3 py-2 text-sm"
            >
              <div>
                <div
                  className="flex items-center gap-2 font-medium"
                  style={{ color: "var(--text-primary)" }}
                >
                  {/* Which domain this run belongs to — today always lodging,
                      but never left implicit: an unlabelled log would claim to
                      cover imports it cannot see. */}
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-border)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                    <span
                      aria-hidden="true"
                      className="h-1.5 w-1.5 rounded-full"
                      style={{ background: DOMAINS.lodging.color }}
                    />
                    {t(`common:${DOMAINS.lodging.i18nKey}`)}
                  </span>
                  <span>{t(`lodging:import.batches.source.${batch.source}`)}</span>
                  {batch.fileName && <span> · {batch.fileName}</span>}
                </div>
                <div className="text-xs" style={{ color: "var(--text-muted)" }}>
                  <span>{new Date(batch.createdAt).toLocaleDateString()}</span>
                  {" · "}
                  <span>
                    {t("lodging:import.batches.created", {
                      lodgingCount: batch.lodgingCount,
                      stayCount: batch.stayCount,
                    })}
                  </span>
                </div>
              </div>
              <button
                type="button"
                data-testid={`batch-revert-${batch.id}`}
                onClick={() => setConfirmingId(batch.id)}
                className="whitespace-nowrap rounded-md border border-[var(--danger)]/50 px-2 py-1 text-xs font-medium text-[var(--danger)] hover:bg-[var(--danger)]/10"
              >
                {t("lodging:import.batches.revert")}
              </button>
            </li>
          ))}
        </ul>
      )}

      {confirmingBatch && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="w-full max-w-md rounded-lg border border-[var(--color-border)] bg-[var(--bg-elevated)] p-6 shadow-xl">
            <h3 className="text-lg font-semibold text-[var(--text-primary)]">
              {t("lodging:import.batches.confirmTitle")}
            </h3>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              {t("lodging:import.batches.confirmMessage")}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                data-testid="batch-revert-cancel"
                onClick={() => setConfirmingId(null)}
                disabled={reverting}
                className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface)] disabled:opacity-50"
              >
                {t("common:buttons.cancel")}
              </button>
              <button
                type="button"
                data-testid="batch-revert-confirm"
                onClick={() => void handleRevert(confirmingBatch.id)}
                disabled={reverting}
                className="rounded-md bg-[var(--danger)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
              >
                {t("lodging:import.batches.revert")}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
