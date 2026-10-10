import type { JSX } from "react";
import Button from "../ui/Button";
import { Field, Input } from "../ui/Field";
import { useTranslation } from "../../hooks/useTranslation";
import { documentsApi } from "../../lib/api/documents";
import { logger } from "../../lib/logger";

export const RECEIPT_PICK_ID = "expense-receipt";

/**
 * Files a receipt picked in the create dialog against the expense the save
 * just made (forgejo#150). Two requests, so two outcomes: the cost can be
 * stored while its receipt is not — that is reported as itself, never as a
 * failed save (the next press would book the cost twice).
 */
export async function attachPendingReceipt(expenseId: string, file: File): Promise<boolean> {
  try {
    await documentsApi.upload({ entry: { type: "tripExpense", id: expenseId }, file });
    return true;
  } catch (err) {
    logger.warn("Attaching a receipt to a new expense failed", err);
    return false;
  }
}

/** The file picker of a NEW expense: the receipt goes up once the cost is saved. */
export function PendingReceiptPicker({
  file,
  onChange,
  disabled,
}: {
  file: File | null;
  onChange: (file: File | null) => void;
  disabled: boolean;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips"]);
  return (
    <Field
      label={t("roadtrips:costs.receipt.pick")}
      htmlFor={RECEIPT_PICK_ID}
      hint={file ? file.name : t("roadtrips:costs.receipt.pickHint")}
    >
      <Input
        id={RECEIPT_PICK_ID}
        type="file"
        accept="image/*,application/pdf"
        disabled={disabled}
        onChange={(e) => onChange(e.target.files?.[0] ?? null)}
      />
    </Field>
  );
}

/**
 * The cost is saved, its receipt is not: say exactly that, offer the upload
 * again, or let the reader go on without it.
 */
export function ReceiptAttachFailed({
  retrying,
  onRetry,
  onSkip,
}: {
  retrying: boolean;
  onRetry: () => void;
  onSkip: () => void;
}): JSX.Element {
  const { t } = useTranslation(["roadtrips"]);
  return (
    <div
      role="alert"
      className="flex flex-col"
      style={{ gap: "var(--ts-space-sm)", color: "var(--ts-bad)" }}
      data-testid="expense-receipt-failed"
    >
      <span className="t-caption" style={{ color: "var(--ts-bad)" }}>
        {t("roadtrips:costs.receipt.attachFailed")}
      </span>
      <div className="flex flex-wrap" style={{ gap: "var(--ts-space-sm)" }}>
        <Button variant="primary" disabled={retrying} onClick={onRetry}>
          {t("roadtrips:costs.receipt.retry")}
        </Button>
        <Button variant="secondary" disabled={retrying} onClick={onSkip}>
          {t("roadtrips:costs.receipt.closeWithout")}
        </Button>
      </div>
    </div>
  );
}
