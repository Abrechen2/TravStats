import Modal from "./Modal";
import { useEffect, useState } from "react";
import axios from "axios";
import { useTranslation } from "../hooks/useTranslation";
import { diagnosticExportApi } from "../lib/api/diagnosticExport";
import { versionApi } from "../lib/api/version";
import { apiErrorMachineCode } from "../lib/apiError";
import { BETA_FEATURE_KEYS } from "../config/betaFeatures";
import type { DiagnosticBundle } from "../shared/logContract";
import { useToastStore } from "../store/toastStore";
import { logger } from "../lib/logger";

/**
 * "Fehler melden": the diagnostic bundle for a PUBLIC GitHub issue.
 *
 * The bundle is an allowlist of structured fields (server side:
 * `services/diagnosticExport.ts`), and this modal shows the exact JSON that
 * will be downloaded before anything leaves the machine. The text above it
 * says what is included and what is not — it used to promise "all personal
 * data removed" over a negative-list scrubber that leaked names and PNRs.
 *
 * When the export fails the issue can still be reported: the button opens the
 * prefilled issue anyway and the modal says why there is no attachment.
 */

const ISSUE_URL = "https://github.com/Abrechen2/TravStats/issues/new";

/** What is downloaded: the server's bundle plus the client's own beta keys. */
type DiagnosticDownload = DiagnosticBundle & { client: { betaFeatureKeys: string[] } };

type ExportState =
  | { status: "loading" }
  | { status: "ready"; download: DiagnosticDownload }
  | { status: "failed"; reasonKey: string; httpStatus: number | null };

const SECTIONS = ["domains", "settings", "counts", "database", "logs"] as const;

function failureOf(err: unknown): { reasonKey: string; httpStatus: number | null } {
  const status = axios.isAxiosError(err) ? (err.response?.status ?? null) : null;
  if (apiErrorMachineCode(err) === "DIAGNOSTIC_EXPORT_REJECTED") {
    return { reasonKey: "rejected", httpStatus: status };
  }
  if (status === 429) return { reasonKey: "rateLimited", httpStatus: status };
  if (status === 403) return { reasonKey: "forbidden", httpStatus: status };
  if (status === null) return { reasonKey: "network", httpStatus: null };
  return { reasonKey: "server", httpStatus: status };
}

function issueUrl(version: string | null): string {
  const params = new URLSearchParams({ template: "bug.yml", labels: "bug" });
  if (version) params.set("version", version);
  return `${ISSUE_URL}?${params.toString()}`;
}

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
  const [state, setState] = useState<ExportState>({ status: "loading" });

  // Only re-fetch when the modal opens. addToast and t are intentionally
  // omitted from deps — they are unstable across renders and would re-fetch
  // on every parent re-render, instantly tripping the 10/hour rate limit.
  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    setState({ status: "loading" });
    const load = async (): Promise<void> => {
      try {
        const bundle = await diagnosticExportApi.fetch();
        if (cancelled) return;
        setState({
          status: "ready",
          download: { ...bundle, client: { betaFeatureKeys: [...BETA_FEATURE_KEYS] } },
        });
      } catch (err: unknown) {
        logger.error("Failed to generate diagnostic bundle:", err);
        if (!cancelled) setState({ status: "failed", ...failureOf(err) });
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const bundleText = state.status === "ready" ? JSON.stringify(state.download, null, 2) : "";
  const reasonText =
    state.status === "failed"
      ? t(`common:diagnostic.reasons.${state.reasonKey}`, { status: state.httpStatus ?? "" })
      : "";

  // navigator.clipboard requires a secure context (HTTPS or localhost); plain
  // HTTP LAN instances fall back to execCommand. Throws on failure.
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

  const handleReportBug = async (): Promise<void> => {
    if (state.status === "ready") {
      // Usually too large for GitHub's form field, so it is downloaded to be
      // dragged into the report (#157).
      handleDownload();
      window.open(issueUrl(state.download.app.version), "_blank", "noopener,noreferrer");
      addToast("info", t("common:diagnostic.reportBugOpened"));
      return;
    }
    // The export failed: the issue still gets reported, without an attachment.
    let version: string | null = null;
    try {
      version = (await versionApi.get()).version;
    } catch (err: unknown) {
      logger.error("Version lookup for the bug report failed:", err);
    }
    window.open(issueUrl(version), "_blank", "noopener,noreferrer");
    addToast("warning", t("common:diagnostic.exportFailedToast"));
  };

  const failedSections =
    state.status === "ready"
      ? SECTIONS.flatMap((name) => {
          const section = state.download[name];
          return section.status === "failed" ? [{ name, code: section.errorCode }] : [];
        })
      : [];

  return (
    <Modal
      open
      onClose={onClose}
      title={t("common:diagnostic.title")}
      maxWidth={768}
      closeLabel={t("common:buttons.close")}
      footer={
        <>
          <button
            onClick={onClose}
            className="btn-secondary px-3 py-1.5 text-sm"
            style={{ background: "var(--bg-elevated)" }}
          >
            {t("common:buttons.close")}
          </button>
          {state.status === "ready" && (
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
            onClick={() => void handleReportBug()}
            disabled={state.status === "loading"}
            title={t("common:diagnostic.reportBugHint")}
            className="btn-primary px-3 py-1.5 text-sm"
          >
            {t("common:diagnostic.reportBug")}
          </button>
        </>
      }
    >
      <div>
        <p className="text-sm mb-2" style={{ color: "var(--text-muted)" }}>
          {t("common:diagnostic.description")}
        </p>
        <ul
          className="text-xs list-disc list-inside mb-2 space-y-1"
          style={{ color: "var(--text-muted)" }}
        >
          <li>{t("common:diagnostic.includes.versions")}</li>
          <li>{t("common:diagnostic.includes.settings")}</li>
          <li>{t("common:diagnostic.includes.counts")}</li>
          <li>{t("common:diagnostic.includes.events")}</li>
        </ul>
        <p className="text-xs mb-4" style={{ color: "var(--text-muted)" }}>
          {t("common:diagnostic.excludes")}
        </p>

        {state.status === "loading" && (
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("common:diagnostic.generating")}
          </div>
        )}

        {state.status === "failed" && (
          <p role="alert" className="text-sm" style={{ color: "var(--danger)" }}>
            {t("common:diagnostic.exportFailed", { reason: reasonText })}
          </p>
        )}

        {failedSections.map(({ name, code }) => (
          <p key={name} role="status" className="text-xs mb-2" style={{ color: "var(--warning)" }}>
            {t("common:diagnostic.failedSection", { section: name, code })}
          </p>
        ))}

        {state.status === "ready" && (
          <>
            <p className="text-xs mb-1" style={{ color: "var(--text-muted)" }}>
              {t("common:diagnostic.previewLabel")}
            </p>
            <textarea
              readOnly
              aria-label={t("common:diagnostic.previewLabel")}
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
          </>
        )}
      </div>
    </Modal>
  );
}
