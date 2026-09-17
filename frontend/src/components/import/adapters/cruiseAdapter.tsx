import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useToastStore } from "../../../store/toastStore";
import type {
  ParseEmailCruiseResult,
  ParseEmailResult,
  ParsePdfCruiseResult,
  ParsePdfResult,
  ParsedCruiseEntry,
} from "../../../lib/api/parse";
import { CruiseEditModal } from "../../Cruise/CruiseEditModal";
import { CruiseImportPreviewModal } from "../../Cruise/CruiseImportPreviewModal";
import type { DomainImportAdapter, ReviewModalProps } from "../types";

function extractCruises(r: ParseEmailResult | ParsePdfResult): ParsedCruiseEntry[] | null {
  if ("domain" in r && r.domain === "cruise") {
    return (r as ParseEmailCruiseResult | ParsePdfCruiseResult).cruises;
  }
  return null;
}

/**
 * Adapter that plugs the Cruise domain into `<DomainImportPanel>`. Static
 * factory: call with i18n + toast helpers from the parent so the adapter stays
 * a pure object (no hook calls inside the shell).
 */
export function useCruiseImportAdapter(): DomainImportAdapter {
  const { t } = useTranslation(["cruise", "import"]);
  const addToast = useToastStore((s) => s.addToast);

  return {
    domain: "cruise",
    panelTitle: t("import:cruise.panelTitle"),
    panelHint: t("import:cruise.panelHint"),
    acceptedEmailExtensions: [".eml", ".msg", ".txt"],
    renderManual: ({ onClose, onSaved }) => (
      <CruiseEditModal
        mode="create"
        onClose={onClose}
        onSaved={async () => {
          await onSaved();
        }}
      />
    ),
    renderReviewModal: (props) => (
      <CruiseReviewSlot
        {...props}
        onEmpty={(reason) => addToast("error", reason ?? t("cruise:import.noCruises"))}
      />
    ),
  };
}

interface CruiseReviewSlotProps extends ReviewModalProps {
  /** Called with the server's own reason when it has one. */
  onEmpty: (reason?: string) => void;
}

function CruiseReviewSlot({
  parseResult,
  sourceFileName,
  onCommit,
  onCancel,
  onEmpty,
}: CruiseReviewSlotProps): JSX.Element | null {
  const result = parseResult as ParseEmailResult | ParsePdfResult;
  const cruises = extractCruises(result);

  if (!cruises) {
    // Wrong-domain fallback (shouldn't happen with domain-locked tabs).
    onEmpty();
    onCancel();
    return null;
  }

  if (cruises.length === 0) {
    // The server says WHY when it can — since 2026-09-17 a cruise the parser
    // could not read is an ordinary empty result with a reason, not a 503.
    // Repeating "no cruise found" over an unreachable model would send the
    // user looking at their mail instead of at their parser settings.
    const reason = (result as { fallbackReason?: string }).fallbackReason;
    onEmpty(reason);
    onCancel();
    return null;
  }

  return (
    <CruiseImportPreviewModal
      entries={cruises}
      sourceFileName={sourceFileName ?? null}
      onCancel={onCancel}
      onSaved={async () => {
        await onCommit();
      }}
    />
  );
}
