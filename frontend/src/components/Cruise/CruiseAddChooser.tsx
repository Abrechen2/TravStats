/**
 * Cruise Add Chooser
 *
 * Single entry point for adding a cruise, mirroring the flight "Add" modal
 * (SimplifiedFlightFormV2 / FlightLookupStep): the user first picks a method
 * via option cards — import a booking (email OR PDF, auto-detected) or enter
 * manually. Reuses the shared EmailImportTab for parsing, the cruise import
 * preview for review, and CruiseEditModal for manual entry.
 */

import { lazy, Suspense, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import {
  isCruiseEmailResult,
  isCruisePdfResult,
  type ParseEmailResult,
  type ParsePdfResult,
  type ParsedCruiseEntry,
} from "../../lib/api/parse";
import { CruiseEditModal } from "./CruiseEditModal";
import { CruiseImportPreviewModal } from "./CruiseImportPreviewModal";

const EmailImportTab = lazy(() => import("../import/EmailImportTab"));

interface CruiseAddChooserProps {
  onClose: () => void;
  /** Fired after a cruise is created (import or manual). Caller should reload. */
  onSaved: () => void | Promise<void>;
}

type View = "chooser" | "import" | "manual";

export function CruiseAddChooser({ onClose, onSaved }: CruiseAddChooserProps): JSX.Element {
  const { t } = useTranslation(["cruise", "import", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [view, setView] = useState<View>("chooser");
  const [entries, setEntries] = useState<ParsedCruiseEntry[] | null>(null);

  const handleEmailResult = (result: ParseEmailResult): void => {
    if (!isCruiseEmailResult(result) || result.cruises.length === 0) {
      addToast("error", t("cruise:import.noCruises"));
      return;
    }
    setEntries(result.cruises);
  };

  const handlePdfResult = (result: ParsePdfResult): void => {
    if (!isCruisePdfResult(result) || result.cruises.length === 0) {
      addToast("error", t("cruise:import.noCruises"));
      return;
    }
    setEntries(result.cruises);
  };

  const handleSaved = async (): Promise<void> => {
    await onSaved();
    onClose();
  };

  // Review modal takes over once a booking has been parsed.
  if (entries) {
    return (
      <CruiseImportPreviewModal
        entries={entries}
        onCancel={() => setEntries(null)}
        onSaved={handleSaved}
      />
    );
  }

  // Manual entry takes over the surface entirely.
  if (view === "manual") {
    return <CruiseEditModal mode="create" onClose={onClose} onSaved={handleSaved} />;
  }

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-lg bg-(--bg-surface)">
        {/* Header */}
        <div className="sticky top-0 flex items-start justify-between gap-4 border-b border-border bg-(--bg-surface) px-6 py-4">
          <h2 className="text-2xl font-bold text-(--text-primary)">{t("cruise:add.title")}</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common:buttons.close")}
            className="rounded-sm p-1 text-(--text-muted) hover:bg-(--bg-elevated) hover:text-(--text-primary)"
          >
            ✕
          </button>
        </div>

        <div className="space-y-4 p-6">
          {view === "chooser" && (
            <>
              {/* Import booking — highlighted "best option" card (BRAND.md §2:
                  preferred callouts use brand amber). Email + PDF in one. */}
              <div
                className="rounded-xl p-6 transition-all duration-300 hover:scale-[1.02]"
                style={{
                  background:
                    "linear-gradient(to right, var(--accent-soft), rgba(240, 169, 71, 0.04))",
                  border: "2px solid var(--accent)",
                  boxShadow: "0 8px 24px rgba(240, 169, 71, 0.18)",
                }}
              >
                <div className="flex items-start gap-4">
                  <div className="flex shrink-0 flex-col items-start gap-2">
                    <span
                      className="inline-flex items-center rounded-full px-3 py-1 text-xs font-bold shadow-md"
                      style={{ background: "var(--accent)", color: "#0d1117" }}
                    >
                      ⭐ {t("cruise:add.import.best")}
                    </span>
                    <div className="text-4xl" style={{ color: "var(--accent)" }}>
                      📧
                    </div>
                  </div>
                  <div className="min-w-0 flex-1">
                    <h3 className="mb-2 text-2xl font-bold text-(--text-primary)">
                      {t("cruise:add.import.title")}
                    </h3>
                    <p className="mb-4 text-base font-medium text-(--text-muted)">
                      {t("cruise:add.import.hint")}
                    </p>
                  </div>
                  <div className="shrink-0">
                    <button
                      type="button"
                      onClick={() => setView("import")}
                      className="btn-primary whitespace-nowrap px-6 py-3 text-base font-semibold"
                    >
                      {t("cruise:add.import.cta")}
                    </button>
                  </div>
                </div>
              </div>

              {/* Manual entry card */}
              <div
                className="rounded-lg p-4"
                style={{
                  background: "linear-gradient(to right, var(--bg-elevated), var(--bg-muted))",
                  border: "1px solid var(--color-border)",
                }}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <span aria-hidden className="text-2xl">
                      ✍️
                    </span>
                    <div>
                      <h3 className="text-lg font-semibold text-(--text-primary)">
                        {t("cruise:add.manual.title")}
                      </h3>
                      <p className="text-sm text-(--text-muted)">
                        {t("cruise:add.manual.hint")}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setView("manual")}
                    className="btn-primary whitespace-nowrap"
                  >
                    {t("cruise:add.manual.cta")}
                  </button>
                </div>
              </div>
            </>
          )}

          {view === "import" && (
            <>
              <button
                type="button"
                onClick={() => setView("chooser")}
                className="text-sm text-(--text-muted) hover:text-(--text-primary)"
              >
                ← {t("cruise:add.back")}
              </button>
              <Suspense
                fallback={
                  <div className="p-6 text-center text-(--text-muted)">
                    {t("common:loading.default")}
                  </div>
                }
              >
                <EmailImportTab
                  domain="cruise"
                  acceptedExtensions={[".eml", ".msg", ".txt", ".pdf"]}
                  onEmailResult={handleEmailResult}
                  onPdfResult={handlePdfResult}
                  onError={(message) => addToast("error", message)}
                />
              </Suspense>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
