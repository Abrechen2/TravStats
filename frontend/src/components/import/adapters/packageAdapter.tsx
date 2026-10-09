import { useEffect } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useToastStore } from "../../../store/toastStore";
import {
  isPackageEmailResult,
  isPackagePdfResult,
  type ParseEmailPackageResult,
  type ParseEmailResult,
  type ParsePdfPackageResult,
  type ParsePdfResult,
} from "../../../lib/api/parse";
import { PackageImportPreviewModal } from "../../Trips/PackageImportPreviewModal";
import type { ReviewModalProps } from "../types";

/**
 * The review step of a tour operator's documents (plan 2026-10-09 P3), used
 * by the trip import (`tripAdapter.tsx`, which parses its drop zone as
 * `package`). A reading becomes a trip proposal the server builds and
 * writes; an empty reading is said as what it is — no template for this
 * operator, or a template that read it incompletely — never as "no trip".
 */
export function usePackageReviewRenderer(): (props: ReviewModalProps) => JSX.Element | null {
  const { t } = useTranslation(["import"]);
  const addToast = useToastStore((s) => s.addToast);
  return function renderPackageReview(props: ReviewModalProps): JSX.Element {
    return (
      <PackageReviewSlot
        {...props}
        onEmpty={(message) => addToast("error", message)}
        onSaved={() => addToast("success", t("import:package.saved"))}
      />
    );
  };
}

interface PackageReviewSlotProps extends ReviewModalProps {
  onEmpty: (message: string) => void;
  onSaved: () => void;
}

export function PackageReviewSlot({
  parseResult,
  onCommit,
  onCancel,
  onEmpty,
  onSaved,
}: PackageReviewSlotProps): JSX.Element | null {
  const { t } = useTranslation(["import"]);
  const result = parseResult as ParseEmailResult | ParsePdfResult;
  const body: ParsePdfPackageResult | ParseEmailPackageResult | null =
    isPackagePdfResult(result as ParsePdfResult) || isPackageEmailResult(result as ParseEmailResult)
      ? (result as ParsePdfPackageResult | ParseEmailPackageResult)
      : null;

  const emptyMessage = body?.package
    ? null
    : body?.fallbackCode === "invalidReading"
      ? t("import:package.empty.invalidReading", { issuer: body.template?.issuer ?? "?" })
      : t("import:package.empty.noTemplate");
  useEffect(() => {
    if (emptyMessage === null) return;
    onEmpty(emptyMessage);
    onCancel();
  }, [emptyMessage, onEmpty, onCancel]);

  if (!body?.package) return null;

  return (
    <PackageImportPreviewModal
      reading={body.package}
      documentId={body.documentId ?? null}
      issuer={body.template?.issuer ?? null}
      onCancel={onCancel}
      onSaved={async () => {
        onSaved();
        await onCommit();
      }}
    />
  );
}
