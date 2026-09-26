import type { JSX } from "react";
import { useEffect } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useToastStore } from "../../../store/toastStore";
import { logger } from "../../../lib/logger";
import type { ParseEmailRailResult, ParsePdfRailResult } from "../../../lib/api/parse";
import { RailFormModal } from "../../rail/RailFormModal";
import { RailImportPreviewModal } from "../../rail/RailImportPreviewModal";
import { emptyParseMessageKey } from "../../rail/railImportModel";
import type { DomainImportAdapter, ReviewModalProps } from "../types";

type RailParse = ParseEmailRailResult | ParsePdfRailResult;

function extractRailParse(result: unknown): RailParse | null {
  if (typeof result !== "object" || result === null) return null;
  const r = result as Partial<RailParse>;
  return r.domain === "rail" && Array.isArray(r.bookings) ? (r as RailParse) : null;
}

/**
 * Plugs rail into `<DomainImportPanel>`: a DB (or any) ticket mail, .eml/.msg
 * with its attachments, or a PDF → the parsed legs → the review, where each
 * leg is confirmed before anything is written. Behind the `railDomain` beta
 * gate like the rest of rail — only a rail surface mounts it.
 */
export function useRailImportAdapter(): DomainImportAdapter {
  const { t } = useTranslation(["rail", "import"]);
  const addToast = useToastStore((s) => s.addToast);

  return {
    domain: "rail",
    panelTitle: t("rail:import.panelTitle"),
    panelHint: t("rail:import.panelHint"),
    acceptedEmailExtensions: [".eml", ".msg", ".txt"],
    renderManual: ({ onClose, onSaved }) => (
      <RailFormModal
        journey={null}
        onClose={onClose}
        onSaved={async () => {
          await onSaved();
        }}
      />
    ),
    renderReviewModal: (props) => (
      <RailReviewSlot
        {...props}
        onEmpty={(message) => addToast("error", message)}
        onDone={(count) => addToast("success", t("rail:import.saved", { count }))}
      />
    ),
  };
}

interface RailReviewSlotProps extends ReviewModalProps {
  onEmpty: (message: string) => void;
  onDone: (count: number) => void;
}

function RailReviewSlot({
  parseResult,
  onCommit,
  onCancel,
  onEmpty,
  onDone,
}: RailReviewSlotProps): JSX.Element | null {
  const { t } = useTranslation(["rail"]);
  const parsed = extractRailParse(parseResult);
  const booking = parsed?.bookings[0] ?? null;

  // Nothing read: say WHY in the reader's words (the server sends a code),
  // and hand the user back to the chooser, where "enter by hand" waits.
  useEffect(() => {
    if (booking && booking.legs.length > 0) return;
    if (parsed?.fallbackReason) logger.warn("RailReviewSlot: nothing read", parsed.fallbackReason);
    onEmpty(
      t(emptyParseMessageKey(parsed?.fallbackCode), { reference: parsed?.orderReference ?? "" })
    );
    onCancel();
    // One parse, one slot: re-running on a new callback identity would toast twice.
  }, [parseResult]);

  if (!booking || booking.legs.length === 0) return null;
  return (
    <RailImportPreviewModal
      booking={booking}
      onCancel={onCancel}
      onSaved={async (count) => {
        onDone(count);
        await onCommit();
      }}
    />
  );
}
