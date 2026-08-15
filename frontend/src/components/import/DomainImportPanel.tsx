import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import type { ParseEmailResult, ParsePdfResult } from "../../lib/api/parse";
import type { DomainImportAdapter } from "./types";

const EmailImportTab = lazy(() => import("./EmailImportTab"));
const PdfImportTab = lazy(() => import("./PdfImportTab"));

type TabId = "email" | "pdf" | "manual";

interface DomainImportPanelProps {
  open: boolean;
  onClose: () => void;
  /** Called once an item has been created server-side (parse → review → save). */
  onItemsCreated: () => void | Promise<void>;
  adapter: DomainImportAdapter;
  /** Initial tab when the panel opens. Defaults to "email". */
  initialTab?: TabId;
}

interface ParseState {
  kind: "email" | "pdf";
  result: ParseEmailResult | ParsePdfResult;
  emailMeta?: { subject?: string; text?: string; html?: string };
}

/**
 * Cross-domain import shell. Renders a tabbed modal with Email-Upload, PDF-Upload,
 * and Manual-Entry tabs. Domain-specific bits (review modal, manual modal) are
 * provided by the `adapter`.
 */
export default function DomainImportPanel({
  open,
  onClose,
  onItemsCreated,
  adapter,
  initialTab = "email",
}: DomainImportPanelProps): JSX.Element | null {
  const { t } = useTranslation(["import", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [activeTab, setActiveTab] = useState<TabId>(initialTab);
  const [parseState, setParseState] = useState<ParseState | null>(null);
  const [showManual, setShowManual] = useState(false);

  // Reset internal state every time the panel opens so successive opens start fresh.
  useEffect(() => {
    if (open) {
      setActiveTab(initialTab);
      setParseState(null);
      setShowManual(false);
    }
  }, [open, initialTab]);

  const handleError = useCallback(
    (message: string) => {
      addToast("error", message);
    },
    [addToast]
  );

  const handleEmailResult = useCallback((result: ParseEmailResult) => {
    setParseState({
      kind: "email",
      result,
      emailMeta: { subject: result.subject, text: result.text, html: result.html },
    });
  }, []);

  const handlePdfResult = useCallback((result: ParsePdfResult) => {
    setParseState({ kind: "pdf", result });
  }, []);

  const handleManualClick = useCallback(() => {
    setActiveTab("manual");
    setShowManual(true);
  }, []);

  const handleReviewCommit = useCallback(async (): Promise<void> => {
    setParseState(null);
    await onItemsCreated();
    onClose();
  }, [onItemsCreated, onClose]);

  const handleReviewCancel = useCallback(() => {
    setParseState(null);
  }, []);

  const handleManualSaved = useCallback(async (): Promise<void> => {
    setShowManual(false);
    await onItemsCreated();
    onClose();
  }, [onItemsCreated, onClose]);

  if (!open) return null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="domain-import-title"
      >
        {/* Same height guard as the lodging form: routes, drop zone and a
            parsed preview together outgrow a laptop viewport, and a centred
            child with no limit overflows with nothing to scroll. */}
        <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-(--bg-surface) shadow-2xl">
          <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
            <div>
              <h2
                id="domain-import-title"
                className="text-xl font-semibold text-(--text-primary)"
              >
                {adapter.panelTitle}
              </h2>
              <p className="mt-0.5 text-sm text-(--text-muted)">{adapter.panelHint}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("common:buttons.close")}
              className="rounded-sm p-1 text-(--text-muted) hover:bg-(--bg-elevated) hover:text-(--text-primary)"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-5 w-5"
              >
                <path
                  fillRule="evenodd"
                  d="M4.28 3.22a.75.75 0 00-1.06 1.06L8.94 10l-5.72 5.72a.75.75 0 101.06 1.06L10 11.06l5.72 5.72a.75.75 0 101.06-1.06L11.06 10l5.72-5.72a.75.75 0 10-1.06-1.06L10 8.94 4.28 3.22z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          </header>

          <nav
            className="flex gap-1 border-b border-border px-4"
            role="tablist"
            aria-label={adapter.panelTitle}
          >
            <TabButton
              id="email"
              activeTab={activeTab}
              onClick={() => setActiveTab("email")}
              label={t("import:tabs.email")}
            />
            <TabButton
              id="pdf"
              activeTab={activeTab}
              onClick={() => setActiveTab("pdf")}
              label={t("import:tabs.pdf")}
            />
            <TabButton
              id="manual"
              activeTab={activeTab}
              onClick={handleManualClick}
              label={t("import:tabs.manual")}
            />
          </nav>

          <div className="px-6 py-5">
            {activeTab === "email" && (
              <Suspense fallback={<TabFallback label={t("common:loading.default")} />}>
                <EmailImportTab
                  domain={adapter.domain}
                  acceptedExtensions={adapter.acceptedEmailExtensions}
                  onEmailResult={handleEmailResult}
                  onPdfResult={handlePdfResult}
                  onError={handleError}
                />
              </Suspense>
            )}
            {activeTab === "pdf" && (
              <Suspense fallback={<TabFallback label={t("common:loading.default")} />}>
                <PdfImportTab
                  domain={adapter.domain}
                  onResult={handlePdfResult}
                  onError={handleError}
                />
              </Suspense>
            )}
            {activeTab === "manual" && !showManual && (
              <div className="text-sm text-(--text-muted)">{t("import:tabs.manualHint")}</div>
            )}
          </div>
        </div>
      </div>

      {/* Review modal — adapter renders the domain-specific preview. */}
      {parseState &&
        adapter.renderReviewModal({
          parseResult: parseState.result,
          emailMeta: parseState.emailMeta,
          onCommit: handleReviewCommit,
          onCancel: handleReviewCancel,
        })}

      {/* Manual entry modal — adapter renders the domain-specific create form. */}
      {showManual &&
        adapter.renderManual({
          onClose: () => setShowManual(false),
          onSaved: handleManualSaved,
        })}
    </>
  );
}

interface TabButtonProps {
  id: TabId;
  activeTab: TabId;
  label: string;
  onClick: () => void;
}

function TabButton({ id, activeTab, label, onClick }: TabButtonProps): JSX.Element {
  const isActive = activeTab === id;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={isActive}
      onClick={onClick}
      className={[
        "px-4 py-3 text-sm font-medium transition-colors border-b-2 -mb-px",
        isActive
          ? "border-(--accent) text-(--text-primary)"
          : "border-transparent text-(--text-muted) hover:text-(--text-primary)",
      ].join(" ")}
    >
      {label}
    </button>
  );
}

function TabFallback({ label }: { label: string }): JSX.Element {
  return (
    <div className="flex min-h-[220px] items-center justify-center text-sm text-(--text-muted)">
      {label}
    </div>
  );
}
