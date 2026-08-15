import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import type { ParseEmailResult, ParsePdfResult } from "../../lib/api/parse";
import { ImportManualFooter, ImportRouteList, ImportRouteRow } from "./ImportRouteList";
import { isParseableDomain } from "./types";
import type { DomainImportAdapter } from "./types";

const EmailImportTab = lazy(() => import("./EmailImportTab"));

interface DomainImportPanelProps {
  open: boolean;
  onClose: () => void;
  /** Called once an item has been created server-side (parse → review → save). */
  onItemsCreated: () => void | Promise<void>;
  adapter: DomainImportAdapter;
}

interface ParseState {
  kind: "email" | "pdf";
  result: ParseEmailResult | ParsePdfResult;
  emailMeta?: { subject?: string; text?: string; html?: string };
}

/**
 * Cross-domain "what do you have?" chooser.
 *
 * It used to be a tabbed modal — E-Mail | PDF | Manuell — which asked the user
 * to classify their own file before showing them anything. Now the first route
 * IS the drop zone: drag a file in, paste the mail text, or pick a file, and
 * the same control takes a `.msg`, an `.eml` and a `.pdf` alike. The separate
 * PDF tab is gone because it was the same drop zone with a narrower filter.
 *
 * Everything domain-specific comes from the `adapter`: the extra routes, the
 * manual form, and the review step that shows what was found BEFORE anything
 * is created.
 */
export default function DomainImportPanel({
  open,
  onClose,
  onItemsCreated,
  adapter,
}: DomainImportPanelProps): JSX.Element | null {
  const { t } = useTranslation(["import", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [parseState, setParseState] = useState<ParseState | null>(null);
  const [showManual, setShowManual] = useState(false);

  // Reset internal state every time the panel opens so successive opens start fresh.
  useEffect(() => {
    if (open) {
      setParseState(null);
      setShowManual(false);
    }
  }, [open]);

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

  // One drop zone for every document a booking arrives as. `.pdf` is added
  // here rather than in each adapter so no domain can forget it and quietly
  // reject the attachment half of its own mails.
  const acceptedExtensions = useMemo(
    () => Array.from(new Set([...adapter.acceptedEmailExtensions, ".pdf"])),
    [adapter.acceptedEmailExtensions]
  );

  if (!open) return null;

  // Two conditions, and both are real: the adapter may switch the route off
  // while its parser is being built, and a domain the backend cannot parse at
  // all must never show a drop zone — the type guard is what stops that from
  // becoming a runtime 400 nobody sees until a user drops a file.
  const parseDomain = isParseableDomain(adapter.domain) ? adapter.domain : null;
  const showDocumentRoute = adapter.supportsDocumentImport !== false && parseDomain !== null;

  return (
    <>
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby="domain-import-title"
      >
        <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-(--bg-surface) shadow-2xl">
          <header className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
            <div>
              <h2 id="domain-import-title" className="text-xl font-semibold text-(--text-primary)">
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

          <div className="flex flex-col gap-2 px-6 py-5">
            {showDocumentRoute && parseDomain && (
              <ImportRouteRow
                primary
                icon="✉️"
                title={adapter.documentRoute?.title ?? t("import:route.document.title")}
                description={
                  adapter.documentRoute?.description ?? t("import:route.document.description")
                }
              >
                <div className="mt-3">
                  <Suspense fallback={<RouteFallback label={t("common:loading.default")} />}>
                    <EmailImportTab
                      domain={parseDomain}
                      acceptedExtensions={acceptedExtensions}
                      onEmailResult={handleEmailResult}
                      onPdfResult={handlePdfResult}
                      onError={handleError}
                    />
                  </Suspense>
                </div>
              </ImportRouteRow>
            )}

            <ImportRouteList routes={adapter.routes ?? []} />

            <ImportManualFooter
              label={adapter.manualLabel ?? t("import:route.manual")}
              onSelect={() => setShowManual(true)}
            />
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

function RouteFallback({ label }: { label: string }): JSX.Element {
  return <div className="py-6 text-center text-sm text-(--text-muted)">{label}</div>;
}
