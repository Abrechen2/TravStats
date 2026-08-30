import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useToastStore } from "../../../store/toastStore";
import { logger } from "../../../lib/logger";
import { LodgingFormModal } from "../../lodging/LodgingFormModal";
import { LodgingImportPreviewModal } from "../../lodging/LodgingImportPreviewModal";
import { commitLodgingImport, previewLodgingImport } from "../../../lib/api/lodgingImport";
import { describeLodgingCommitResult } from "../../../lib/lodgingImportResult";
import type {
  LodgingImportCandidate,
  LodgingImportCommitResult,
  LodgingImportCommitRow,
  LodgingImportPreviewRow,
  LodgingImportSource,
  LodgingImportSummary,
} from "../../../types/lodgingImport";
import type { DomainImportAdapter, ReviewModalProps } from "../types";

/**
 * The lodging shape of `ParseEmailResult` / `ParsePdfResult`
 * (`lib/api/parse.ts`), narrowed by hand rather than via the exported
 * `isLodgingEmailResult`/`isLodgingPdfResult` guards — those guards each
 * expect one half of that union, and `ReviewModalProps.parseResult` is
 * `unknown` (the panel is domain-agnostic), so there is nothing narrower to
 * hand them here. `pdfTextLength` is only present on the PDF variant — its
 * presence is how the commit call below tells "email" and "pdf" apart, since
 * `ReviewModalProps` itself carries no explicit source tag.
 */
interface LodgingParseResult {
  domain: "lodging";
  candidates: LodgingImportCandidate[];
  fallbackReason?: string;
  pdfTextLength?: number;
}

function extractLodgingParse(result: unknown): LodgingParseResult | null {
  if (typeof result !== "object" || result === null) return null;
  const r = result as Partial<LodgingParseResult> & { domain?: unknown };
  if (r.domain !== "lodging" || !Array.isArray(r.candidates)) return null;
  return r as LodgingParseResult;
}

/**
 * Plugs the Lodging domain into `<DomainImportPanel>` — the one adapter file the
 * shell's contract asks for. Email/PDF parse → candidates → the SAME preview and
 * the SAME batch commit the CSV path uses.
 */
export function useLodgingImportAdapter(): DomainImportAdapter {
  const { t } = useTranslation(["lodging", "import"]);
  const addToast = useToastStore((s) => s.addToast);

  // The preview modal never sees the commit result (its `onCommit` prop is
  // `Promise<void>`) — this is the one place that can tell the user a
  // commit only PARTIALLY succeeded instead of letting a 201 read as "all
  // good" (Task 15 review carry-in).
  const presentCommitResult = useCallback(
    (result: LodgingImportCommitResult): void => {
      const toast = describeLodgingCommitResult(result, t);
      addToast(toast.type, toast.message);
    },
    [t, addToast]
  );

  return {
    domain: "lodging",
    panelTitle: t("import:lodging.panelTitle"),
    panelHint: t("import:lodging.panelHint"),
    acceptedEmailExtensions: [".eml", ".msg", ".txt"],
    renderManual: ({ onClose, onSaved }) => (
      <LodgingFormModal
        mode="create"
        onClose={onClose}
        onSaved={async () => {
          await onSaved();
        }}
      />
    ),
    renderReviewModal: (props) => (
      <LodgingReviewSlot
        {...props}
        onEmpty={(message) => addToast("error", message ?? t("lodging:import.noBookings"))}
        onCommitResult={presentCommitResult}
      />
    ),
  };
}

interface LodgingReviewSlotProps extends ReviewModalProps {
  onEmpty: (message?: string) => void;
  onCommitResult: (result: LodgingImportCommitResult) => void;
}

function LodgingReviewSlot({
  parseResult,
  sourceFileName,
  onCommit,
  onCancel,
  onEmpty,
  onCommitResult,
}: LodgingReviewSlotProps): JSX.Element | null {
  const { t } = useTranslation("lodging");
  const [rows, setRows] = useState<LodgingImportPreviewRow[] | null>(null);
  const [summary, setSummary] = useState<LodgingImportSummary | null>(null);

  // Recomputed on every render (cheap, pure) so the JSX below can read
  // `pdfTextLength` for the commit `source` without duplicating state; the
  // effect below intentionally reads its OWN local copy instead of this one
  // (see the dependency-array comment).
  const parsed = extractLodgingParse(parseResult);

  useEffect(() => {
    const localParsed = extractLodgingParse(parseResult);
    // The parser never dead-ends (spec §3.2): nothing extracted means we
    // release the review slot and tell the user, so they can use the
    // Manual tab with whatever they have. `fallbackReason` is a backend
    // diagnostic string (may itself wrap a raw caught exception message on
    // the backend) — logged for diagnostics only, never shown to the user.
    if (!localParsed || localParsed.candidates.length === 0) {
      if (localParsed?.fallbackReason) {
        logger.warn("LodgingReviewSlot: parser found nothing", localParsed.fallbackReason);
      }
      onEmpty();
      onCancel();
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const result = await previewLodgingImport(localParsed.candidates);
        if (cancelled) return;
        setRows(result.rows);
        setSummary(result.summary);
      } catch (err) {
        if (cancelled) return;
        logger.error("LodgingReviewSlot: preview failed", err);
        onEmpty(t("lodging:import.errors.previewFailed"));
        onCancel();
      }
    })();
    return () => {
      cancelled = true;
    };
    // Deliberately NOT depending on `onCancel`/`onEmpty`/`t`: this slot is a
    // fresh component instance per parse (the panel unmounts it on
    // cancel/commit), so the fetch-once-on-mount behaviour this effect
    // implements must not re-run just because the parent handed down a new
    // function identity on some unrelated re-render.
  }, [parseResult]);

  if (!rows || !summary || !parsed) return null;

  // `ReviewModalProps` carries no explicit "email" vs "pdf" source tag —
  // `pdfTextLength` (only present on `ParsePdfLodgingResult`) is what tells
  // them apart, so a PDF-sourced batch isn't mislabelled "email" in
  // `LodgingImportBatchSummary.source` (revert/history list).
  const source: LodgingImportSource = typeof parsed.pdfTextLength === "number" ? "pdf" : "email";

  return (
    <LodgingImportPreviewModal
      rows={rows}
      summary={summary}
      onCancel={onCancel}
      onCommit={async (commitRows: LodgingImportCommitRow[]) => {
        // Forgejo #19: the log row can name its file instead of reading
        // like every other email import made that day.
        const result = await commitLodgingImport(source, sourceFileName ?? null, commitRows);
        onCommitResult(result);
        await onCommit();
      }}
    />
  );
}
