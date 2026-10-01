import type { JSX } from "react";
import { useEffect } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useToastStore } from "../../../store/toastStore";
import { logger } from "../../../lib/logger";
import type { ParseEmailRentalResult, ParsePdfRentalResult } from "../../../lib/api/parse";
import { RentalFormModal } from "../../rental/RentalFormModal";
import { RentalImportPreviewModal } from "../../rental/RentalImportPreviewModal";
import type { DomainImportAdapter, ReviewModalProps } from "../types";

type RentalParse = ParseEmailRentalResult | ParsePdfRentalResult;

function extractRentalParse(result: unknown): RentalParse | null {
  if (typeof result !== "object" || result === null) return null;
  const r = result as Partial<RentalParse>;
  return r.domain === "rental" && Array.isArray(r.candidates) ? (r as RentalParse) : null;
}

/** The sentence for "nothing read", by the server's stable code. */
export function rentalEmptyParseKey(code: string | undefined): string {
  switch (code) {
    case "parking":
    case "noItinerary":
    case "noTemplate":
    case "notConfirmed":
    case "otherDomain":
      return `rental:import.empty.${code}`;
    default:
      return "rental:import.empty.generic";
  }
}

/**
 * Plugs rentals into `<DomainImportPanel>` (spec 2026-10-01-rental-domain-design
 * §4): a booking mail (.eml/.msg, its PDF attachments included) or a PDF →
 * one candidate → the review, where it is confirmed before anything is
 * written. A confirmation creates or updates; a cancellation or an invoice
 * only ever acts on a booking the account holds.
 */
export function useRentalImportAdapter(): DomainImportAdapter {
  const { t } = useTranslation(["rental", "import"]);
  const addToast = useToastStore((s) => s.addToast);

  return {
    domain: "rental",
    panelTitle: t("rental:import.panelTitle"),
    panelHint: t("rental:import.panelHint"),
    acceptedEmailExtensions: [".eml", ".msg", ".txt"],
    renderManual: ({ onClose, onSaved }) => (
      <RentalFormModal
        rental={null}
        onClose={onClose}
        onSaved={async () => {
          await onSaved();
        }}
      />
    ),
    renderReviewModal: (props) => (
      <RentalReviewSlot
        {...props}
        onEmpty={(message) => addToast("error", message)}
        onDone={() => addToast("success", t("rental:import.saved"))}
      />
    ),
  };
}

interface RentalReviewSlotProps extends ReviewModalProps {
  onEmpty: (message: string) => void;
  onDone: () => void;
}

function RentalReviewSlot({
  parseResult,
  onCommit,
  onCancel,
  onEmpty,
  onDone,
}: RentalReviewSlotProps): JSX.Element | null {
  const { t } = useTranslation(["rental"]);
  const parsed = extractRentalParse(parseResult);
  const candidate = parsed?.candidates[0] ?? null;

  // Nothing read: say WHY in the reader's words, and hand back to the chooser.
  useEffect(() => {
    if (candidate) return;
    if (parsed?.fallbackReason)
      logger.warn("RentalReviewSlot: nothing read", parsed.fallbackReason);
    onEmpty(t(rentalEmptyParseKey(parsed?.fallbackCode)));
    onCancel();
    // One parse, one slot: re-running on a new callback identity would toast twice.
  }, [parseResult]);

  if (!candidate) return null;
  return (
    <RentalImportPreviewModal
      candidate={candidate}
      onCancel={onCancel}
      onSaved={async () => {
        onDone();
        await onCommit();
      }}
    />
  );
}
