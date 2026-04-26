import { useCallback, useRef, useState } from "react";
import type { JSX } from "react";
import { parseApi } from "../../lib/api";
import type { ParsedCruiseEntry } from "../../lib/api/parse";
import { cruiseApi } from "../../lib/api/cruise";
import { logger } from "../../lib/logger";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";
import { GlobeLoader } from "../GlobeLoader";

interface CruisePdfImportProps {
  /** Called once a parsed cruise has been saved successfully. */
  onCreated: () => void | Promise<void>;
}

/** Read a File as a base64 string suitable for the parse-pdf endpoint. */
async function fileToBase64(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const bytes = new Uint8Array(arrayBuffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export function CruisePdfImport({ onCreated }: CruisePdfImportProps): JSX.Element {
  const { t } = useTranslation(["cruise", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [previewEntries, setPreviewEntries] = useState<ParsedCruiseEntry[] | null>(null);
  const [saving, setSaving] = useState(false);

  const handleFile = useCallback(
    async (file: File): Promise<void> => {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        addToast("error", t("cruise:import.notPdf"));
        return;
      }
      setBusy(true);
      try {
        const pdfBase64 = await fileToBase64(file);
        const result = await parseApi.parsePdf(pdfBase64, "cruise");
        if (result.cruises.length === 0) {
          addToast("error", t("cruise:import.noCruises"));
          return;
        }
        setPreviewEntries(result.cruises);
      } catch (err: unknown) {
        logger.error("CruisePdfImport: parse failed", err);
        addToast("error", t("cruise:import.parseError"));
      } finally {
        setBusy(false);
      }
    },
    [addToast, t]
  );

  const handleSave = useCallback(async (): Promise<void> => {
    if (!previewEntries) return;
    setSaving(true);
    try {
      for (const entry of previewEntries) {
        await cruiseApi.create(entry.input);
      }
      addToast("success", t("cruise:import.saved", { count: previewEntries.length }));
      setPreviewEntries(null);
      await onCreated();
    } catch (err: unknown) {
      logger.error("CruisePdfImport: save failed", err);
      addToast("error", t("cruise:import.saveError"));
    } finally {
      setSaving(false);
    }
  }, [previewEntries, onCreated, addToast, t]);

  return (
    <>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={busy}
        className="flex items-center gap-2 whitespace-nowrap rounded-md border border-[var(--color-border)] bg-[var(--bg-surface)] px-3 py-2 text-sm text-[var(--text-primary)] hover:border-[var(--accent)] disabled:opacity-50"
      >
        {busy ? "…" : "📄"}
        <span>{t("cruise:import.button")}</span>
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept=".pdf"
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.[0]) {
            void handleFile(e.target.files[0]);
            // Reset so re-uploading the same file fires onChange again.
            e.target.value = "";
          }
        }}
      />

      {busy && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
          <div className="flex flex-col items-center gap-3 rounded-xl bg-[var(--bg-surface)] p-6">
            <GlobeLoader size={120} label={t("cruise:import.parsing")} />
          </div>
        </div>
      )}

      {previewEntries && (
        <CruiseImportPreviewModal
          entries={previewEntries}
          saving={saving}
          onCancel={() => setPreviewEntries(null)}
          onSave={() => void handleSave()}
        />
      )}
    </>
  );
}

interface PreviewModalProps {
  entries: ParsedCruiseEntry[];
  saving: boolean;
  onCancel: () => void;
  onSave: () => void;
}

function CruiseImportPreviewModal({
  entries,
  saving,
  onCancel,
  onSave,
}: PreviewModalProps): JSX.Element {
  const { t } = useTranslation(["cruise", "common"]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
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
            onClick={onSave}
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
