import { useState } from "react";
import type { JSX } from "react";
import type { ParsedCruiseEntry } from "../../lib/api/parse";
import { cruiseApi } from "../../lib/api/cruise";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";

interface CruiseImportPreviewModalProps {
  entries: ParsedCruiseEntry[];
  onCancel: () => void;
  onSaved: () => void | Promise<void>;
}

export function CruiseImportPreviewModal({
  entries,
  onCancel,
  onSaved,
}: CruiseImportPreviewModalProps): JSX.Element {
  const { t } = useTranslation(["cruise", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [saving, setSaving] = useState(false);

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      for (const entry of entries) {
        await cruiseApi.create(entry.input);
      }
      addToast("success", t("cruise:import.saved", { count: entries.length }));
      await onSaved();
    } catch (err: unknown) {
      logger.error("CruiseImportPreviewModal: save failed", err);
      addToast("error", t("cruise:import.saveError"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-[var(--bg-surface)] p-6">
        <h2 className="mb-4 text-xl font-semibold text-[var(--text-primary)]">
          {t("cruise:import.previewTitle", { count: entries.length })}
        </h2>
        <p className="mb-4 text-sm text-[var(--text-muted)]">{t("cruise:import.previewHint")}</p>

        <div className="space-y-4">
          {entries.map((entry, idx) => (
            <CruiseImportEntryCard key={idx} entry={entry} />
          ))}
        </div>

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={saving}
            className="rounded-md border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] disabled:opacity-50"
          >
            {t("common:buttons.cancel")}
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={saving}
            className="btn-primary px-4 py-2 text-sm"
          >
            {saving ? t("common:loading.default") : t("cruise:import.save")}
          </button>
        </div>
      </div>
    </div>
  );
}

function CruiseImportEntryCard({ entry }: { entry: ParsedCruiseEntry }): JSX.Element {
  const { t } = useTranslation(["cruise"]);
  const { input, shipMatched, unmatchedPorts } = entry;
  const stopCount = input.stops?.length ?? 0;
  const portStops = input.stops?.filter((s) => !s.isAtSea).length ?? 0;
  const seaDays = stopCount - portStops;

  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--bg-base)] p-4">
      <div className="mb-2 flex items-baseline justify-between gap-3">
        <h3 className="text-base font-medium text-[var(--text-primary)]">
          {input.shipNameOverride ?? t("cruise:import.shipFromDb")}
          {!shipMatched && input.shipNameOverride && (
            <span
              className="ml-2 rounded bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300"
              title={t("cruise:import.shipUnmatchedHint")}
            >
              {t("cruise:import.shipUnmatched")}
            </span>
          )}
        </h3>
        {input.cruiseLine && (
          <span className="text-xs text-[var(--text-muted)]">{input.cruiseLine}</span>
        )}
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm text-[var(--text-muted)]">
        <dt>{t("cruise:field.depart")}</dt>
        <dd className="text-[var(--text-primary)]">{input.startDate ?? "—"}</dd>
        <dt>{t("cruise:field.arrive")}</dt>
        <dd className="text-[var(--text-primary)]">{input.endDate ?? "—"}</dd>
        <dt>{t("cruise:field.cabin")}</dt>
        <dd className="text-[var(--text-primary)]">
          {[input.cabinNumber, input.cabinType, input.deck && `Deck ${input.deck}`]
            .filter(Boolean)
            .join(" · ") || "—"}
        </dd>
        <dt>{t("cruise:import.stopsLabel")}</dt>
        <dd className="text-[var(--text-primary)]">
          {t("cruise:import.stopsValue", { ports: portStops, seaDays })}
        </dd>
        {input.price !== undefined && (
          <>
            <dt>{t("cruise:field.price")}</dt>
            <dd className="text-[var(--text-primary)]">
              {input.price} {input.currency ?? ""}
            </dd>
          </>
        )}
        {input.bookingReference && (
          <>
            <dt>{t("cruise:field.bookingReference")}</dt>
            <dd className="text-[var(--text-primary)]">{input.bookingReference}</dd>
          </>
        )}
      </dl>

      {unmatchedPorts.length > 0 && (
        <div className="mt-3 rounded border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-300">
          <strong>{t("cruise:import.unmatchedTitle")}:</strong>{" "}
          {unmatchedPorts.map((p) => `Tag ${p.dayNumber}: ${p.portName}`).join(", ")}
          <div className="mt-1 text-[11px] text-amber-300/80">
            {t("cruise:import.unmatchedHint")}
          </div>
        </div>
      )}
    </div>
  );
}
