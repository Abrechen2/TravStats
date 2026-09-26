import Modal from "../Modal";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { useToastStore } from "../../store/toastStore";
import type { ParseDomain, ParseEmailResult, ParsePdfResult } from "../../lib/api/parse";
import { detectedOtherDomain, type ImportDocument } from "./documentHandoff";
import { WrongDialogNotice } from "./WrongDialogNotice";
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
  /** A document handed over from another dialog — read on open (D1). */
  initialDocument?: ImportDocument | null;
  /**
   * Opens the import the document really belongs to, with the same document.
   * Without it the notice still says what the document is, but offers no jump.
   */
  onOpenOtherImport?: (domain: ParseDomain, document: ImportDocument) => void;
  /** The imports the host can open right now (enabled and visible). */
  openableDomains?: readonly ParseDomain[];
}

interface Mismatch {
  detected: ParseDomain;
  document: ImportDocument | null;
}

interface ParseState {
  kind: "email" | "pdf";
  result: ParseEmailResult | ParsePdfResult;
  emailMeta?: { subject?: string; text?: string; html?: string };
  /** What the file was called, so the import log can name it (Forgejo #19). */
  sourceFileName?: string | null;
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
  initialDocument = null,
  onOpenOtherImport,
  openableDomains = [],
}: DomainImportPanelProps): JSX.Element | null {
  const { t } = useTranslation(["import", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [parseState, setParseState] = useState<ParseState | null>(null);
  const [showManual, setShowManual] = useState(false);
  const [mismatch, setMismatch] = useState<Mismatch | null>(null);

  // Reset internal state every time the panel opens so successive opens start fresh.
  useEffect(() => {
    if (open) {
      setParseState(null);
      setShowManual(false);
      setMismatch(null);
    }
  }, [open]);

  const handleError = useCallback(
    (message: string) => {
      addToast("error", message);
    },
    [addToast]
  );

  const handleEmailResult = useCallback(
    (result: ParseEmailResult, fileName?: string | null, document?: ImportDocument) => {
      // A document that clearly is something else is not reviewed here: the
      // server read nothing, and says what it is instead (D1).
      const other = detectedOtherDomain(result);
      if (other) {
        setMismatch({ detected: other, document: document ?? null });
        return;
      }
      setParseState({
        kind: "email",
        result,
        emailMeta: { subject: result.subject, text: result.text, html: result.html },
        sourceFileName: fileName ?? null,
      });
    },
    []
  );

  const handlePdfResult = useCallback(
    (result: ParsePdfResult, fileName?: string | null, document?: ImportDocument) => {
      const other = detectedOtherDomain(result);
      if (other) {
        setMismatch({ detected: other, document: document ?? null });
        return;
      }
      setParseState({ kind: "pdf", result, sourceFileName: fileName ?? null });
    },
    []
  );

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
      <Modal
        open
        onClose={onClose}
        title={adapter.panelTitle}
        maxWidth={672}
        closeLabel={t("common:buttons.close")}
      >
        <p className="mb-4 text-sm text-(--text-muted)">{adapter.panelHint}</p>
        <div className="flex flex-col gap-2">
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
                    initialDocument={initialDocument}
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
      </Modal>

      {mismatch && (
        <WrongDialogNotice
          detected={mismatch.detected}
          onDismiss={() => setMismatch(null)}
          onOpen={
            onOpenOtherImport && mismatch.document && openableDomains.includes(mismatch.detected)
              ? () => {
                  const target = mismatch;
                  setMismatch(null);
                  onClose();
                  if (target.document) onOpenOtherImport(target.detected, target.document);
                }
              : undefined
          }
        />
      )}

      {/* Review modal — adapter renders the domain-specific preview. */}
      {parseState &&
        adapter.renderReviewModal({
          parseResult: parseState.result,
          emailMeta: parseState.emailMeta,
          sourceFileName: parseState.sourceFileName ?? null,
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
