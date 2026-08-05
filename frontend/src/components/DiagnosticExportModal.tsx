import { useEffect, useState } from "react";
import { useTranslation } from "../hooks/useTranslation";
import { diagnosticExportApi, type DiagnosticBundle } from "../lib/api/diagnosticExport";
import { useToastStore } from "../store/toastStore";
import { logger } from "../lib/logger";

interface DiagnosticExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export default function DiagnosticExportModal({
  isOpen,
  onClose,
}: DiagnosticExportModalProps): JSX.Element | null {
  const { t } = useTranslation(["common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [bundle, setBundle] = useState<DiagnosticBundle | null>(null);
  const [loading, setLoading] = useState(false);

  // Only re-fetch when the modal opens. addToast and t are intentionally
  // omitted from deps — they are unstable across renders and would cause the
  // bundle to be re-fetched on every parent re-render, instantly tripping the
  // 10/hour rate limit. Same issue pattern as the settings-page auto-save.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setLoading(true);
    setBundle(null);
    diagnosticExportApi
      .fetch()
      .then((b) => {
        if (!cancelled) setBundle(b);
      })
      .catch((err: unknown) => {
        logger.error("Failed to generate diagnostic bundle:", err);
        if (!cancelled) {
          addToast("error", t("common:diagnostic.error"));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const bundleText = bundle ? JSON.stringify(bundle, null, 2) : "";

  // navigator.clipboard requires a secure context (HTTPS or localhost).
  // The TravStats prod box currently serves over plain HTTP, so we fall
  // back to the legacy execCommand approach when the API is missing.
  // This helper THROWS on failure so callers can decide how to react.
  const handleCopyInternal = async (): Promise<void> => {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(bundleText);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = bundleText;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    if (!ok) throw new Error("execCommand copy returned false");
  };

  const handleCopy = async (): Promise<void> => {
    try {
      await handleCopyInternal();
      addToast("success", t("common:diagnostic.copied"));
    } catch (err: unknown) {
      logger.error("Clipboard write failed:", err);
      addToast("error", t("common:diagnostic.copyFailed"));
    }
  };

  const handleReportBug = (): void => {
    if (!bundle) return;

    // The bundle carries log tails (24h app + 7d error), so it is usually too
    // large to paste into GitHub's form field ("more characters than allowed").
    // Download it instead so the user can drag the .json file into the report —
    // the bug template supports attaching it. (#157)
    handleDownload();

    const url =
      "https://github.com/Abrechen2/TravStats/issues/new" +
      "?template=bug.yml" +
      `&version=${encodeURIComponent(bundle.version)}` +
      "&labels=bug";
    window.open(url, "_blank", "noopener,noreferrer");

    addToast("info", t("common:diagnostic.reportBugOpened"));
  };

  const handleDownload = (): void => {
    const blob = new Blob([bundleText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `travstats-diagnostic-${Date.now()}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-100 bg-black/60 flex items-center justify-center p-4">
      <div
        className="rounded-lg shadow-xl max-w-3xl w-full max-h-[90vh] flex flex-col"
        style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
      >
        <div
          className="px-6 py-4 border-b flex items-center justify-between"
          style={{ borderColor: "var(--color-border)" }}
        >
          <h2 className="text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
            {t("common:diagnostic.title")}
          </h2>
          <button
            onClick={onClose}
            className="text-xl leading-none"
            style={{ color: "var(--text-muted)" }}
            aria-label={t("common:buttons.close")}
          >
            ×
          </button>
        </div>

        <div className="px-6 py-4 overflow-y-auto flex-1">
          <p className="text-sm mb-3" style={{ color: "var(--text-muted)" }}>
            {t("common:diagnostic.description")}
          </p>
          <ul
            className="text-xs list-disc list-inside mb-4 space-y-1"
            style={{ color: "var(--text-muted)" }}
          >
            <li>{t("common:diagnostic.scrubList.ip")}</li>
            <li>{t("common:diagnostic.scrubList.email")}</li>
            <li>{t("common:diagnostic.scrubList.tokens")}</li>
            <li>{t("common:diagnostic.scrubList.uuids")}</li>
          </ul>

          {loading && (
            <div className="text-sm" style={{ color: "var(--text-muted)" }}>
              {t("common:diagnostic.generating")}
            </div>
          )}

          {bundle && (
            <textarea
              readOnly
              value={bundleText}
              className="w-full font-mono text-xs p-3 rounded-sm resize-none"
              style={{
                background: "var(--bg-elevated)",
                color: "var(--text-primary)",
                border: "1px solid var(--color-border)",
                minHeight: 300,
                maxHeight: 400,
              }}
            />
          )}
        </div>

        <div
          className="px-6 py-4 border-t flex flex-wrap items-center gap-2 justify-end"
          style={{ borderColor: "var(--color-border)" }}
        >
          <button
            onClick={onClose}
            className="btn-secondary px-3 py-1.5 text-sm"
            style={{ background: "var(--bg-elevated)" }}
          >
            {t("common:buttons.close")}
          </button>
          {bundle && (
            <>
              <button
                onClick={handleDownload}
                className="px-3 py-1.5 text-sm rounded-sm"
                style={{
                  background: "var(--bg-elevated)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {t("common:diagnostic.download")}
              </button>
              <button
                onClick={handleCopy}
                className="px-3 py-1.5 text-sm rounded-sm"
                style={{
                  background: "var(--bg-elevated)",
                  color: "var(--text-primary)",
                  border: "1px solid var(--color-border)",
                }}
              >
                {t("common:diagnostic.copy")}
              </button>
            </>
          )}
          <button
            onClick={handleReportBug}
            disabled={!bundle}
            title={t("common:diagnostic.reportBugHint")}
            className="btn-primary px-3 py-1.5 text-sm"
          >
            {t("common:diagnostic.reportBug")}
          </button>
        </div>
      </div>
    </div>
  );
}
