import { useEffect, useState } from "react";
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
import { parseApi } from "../../../lib/api/parse";
import { logger } from "../../../lib/logger";
import Modal from "../../Modal";
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

type PackageBodyResult = ParsePdfPackageResult | ParseEmailPackageResult;

const MODEL_FAILURE_KEYS = ["modelRefused", "modelFailed", "modelInvalid"] as const;

/**
 * "No template" is a dead end only until the user says otherwise: a kept PDF
 * can be read by the language model on request (spec 2026-08-21). Never
 * automatic — a model's itinerary is a guess the user must choose to review.
 */
function ModelOffer({
  documentId,
  onRead,
  onCancel,
}: {
  documentId: string;
  onRead: (body: PackageBodyResult) => void;
  onCancel: () => void;
}): JSX.Element {
  const { t } = useTranslation(["import", "common"]);
  const [busy, setBusy] = useState(false);
  const [requestFailed, setRequestFailed] = useState(false);
  const [last, setLast] = useState<PackageBodyResult | null>(null);

  const ask = async (): Promise<void> => {
    setBusy(true);
    setRequestFailed(false);
    try {
      const body = await parseApi.readPackageWithModel(documentId);
      if (body.package) {
        onRead(body);
        return;
      }
      setLast(body);
    } catch (err) {
      logger.error("packageAdapter: model reading request failed", err);
      setRequestFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const code = last?.fallbackCode;
  const failureKey = MODEL_FAILURE_KEYS.find((k) => k === code);
  return (
    <Modal
      open
      onClose={onCancel}
      busy={busy}
      title={t("import:package.model.title")}
      maxWidth={520}
      closeLabel={t("common:buttons.close")}
      footer={
        <>
          <button type="button" className="btn-secondary" onClick={onCancel} disabled={busy}>
            {t("common:buttons.cancel")}
          </button>
          <button type="button" className="btn-primary" onClick={() => void ask()} disabled={busy}>
            {busy ? t("import:package.model.reading") : t("import:package.model.read")}
          </button>
        </>
      }
    >
      <p className="text-sm">{t("import:package.model.offer")}</p>
      {(failureKey || requestFailed) && (
        <div role="alert" className="mt-3 text-sm font-medium text-(--danger)">
          <p>
            {requestFailed
              ? t("import:package.model.failed.request")
              : failureKey === "modelRefused" || failureKey === "modelFailed"
                ? t(`import:package.model.reason.${last?.modelReason ?? "PARSE_FAILED"}`, {
                    defaultValue: t(`import:package.model.failed.${failureKey}`),
                  })
                : t(`import:package.model.failed.${failureKey}`)}
          </p>
          {!requestFailed && last?.issues && last.issues.length > 0 && (
            <p className="mt-1 font-normal text-(--text-muted)">{last.issues.join("; ")}</p>
          )}
        </div>
      )}
    </Modal>
  );
}

export function PackageReviewSlot({
  parseResult,
  onCommit,
  onCancel,
  onEmpty,
  onSaved,
}: PackageReviewSlotProps): JSX.Element | null {
  const { t } = useTranslation(["import"]);
  const [modelRead, setModelRead] = useState<PackageBodyResult | null>(null);
  const result = parseResult as ParseEmailResult | ParsePdfResult;
  const original: PackageBodyResult | null =
    isPackagePdfResult(result as ParsePdfResult) || isPackageEmailResult(result as ParseEmailResult)
      ? (result as PackageBodyResult)
      : null;
  const body = modelRead ?? original;

  // Only a kept PDF can be handed to the model route; a mail goes unread.
  const offerModel =
    !body?.package &&
    original !== null &&
    "pdfTextLength" in original &&
    typeof original.documentId === "string" &&
    (original.fallbackCode === "noTemplate" || original.fallbackCode === "invalidReading");

  const emptyMessage =
    body?.package || offerModel
      ? null
      : body?.fallbackCode === "invalidReading"
        ? t("import:package.empty.invalidReading", { issuer: body.template?.issuer ?? "?" })
        : t("import:package.empty.noTemplate");
  useEffect(() => {
    if (emptyMessage === null) return;
    onEmpty(emptyMessage);
    onCancel();
  }, [emptyMessage, onEmpty, onCancel]);

  if (offerModel && original?.documentId) {
    return (
      <ModelOffer documentId={original.documentId} onRead={setModelRead} onCancel={onCancel} />
    );
  }
  if (!body?.package) return null;

  return (
    <PackageImportPreviewModal
      reading={body.package}
      documentId={body.documentId ?? original?.documentId ?? null}
      issuer={body.template?.issuer ?? null}
      {...(modelRead ? { readByModel: { dropped: modelRead.modelDropped ?? [] } } : {})}
      onCancel={onCancel}
      onSaved={async () => {
        onSaved();
        await onCommit();
      }}
    />
  );
}
