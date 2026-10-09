import { useState } from "react";
import type { JSX } from "react";

import Button from "../ui/Button";
import Dialog from "../ui/Dialog";
import { Field, Input, Select, TextArea } from "../ui/Field";
import CurrencySelect from "../common/CurrencySelect";
import ConfirmModal from "../Training/ConfirmModal";
import {
  FormErrorBanner,
  RequiredLegend,
  RequiredMark,
  SaveBlockedHint,
  useDirtyGuard,
  useFormFailure,
  useSaveOnce,
} from "../form";
import type { MissingStep } from "../form";
import { useTranslation } from "../../hooks/useTranslation";
import { useRecentCurrencies } from "../../hooks/useRecentCurrencies";
import { expensesApi } from "../../lib/api/expenses";
import { DELETE_BUTTON_CLASS } from "../../lib/deleteConfirm";
import { useDisplayFormat } from "../../lib/displayFormat";
import { logger } from "../../lib/logger";
import { formatCurrency } from "../../lib/units";
import { EXPENSE_KINDS, type ExpenseKind } from "../../shared/expenses";
import type { TripExpense } from "../../types/expense";
import type { RoadtripStation } from "../../types/roadtrip";
import {
  createBody,
  editPatch,
  expenseDraft,
  expenseFailureKey,
  isTransientExpenseFailure,
  parseAmount,
  type ExpenseDraft,
} from "./expenseDraft";

const AMOUNT_ID = "expense-amount";
const HINT_ID = "expense-save-blocked";

/**
 * Record or change one roadtrip expense (forgejo#140): what for, how much, in
 * which currency, on which day, at which station. The web pins to a station or
 * to nothing; an expense the server holds on a leg (a toll the old leg field
 * carried) keeps its leg unless the reader picks a station instead.
 *
 * Pattern (forgejo#245): "disabled save + `SaveBlockedHint`" — the amount is
 * the one field that can be missing; kind and currency always hold a value.
 * A refused save keeps the dialog open with a banner that stays until the
 * next edit (closing on a failed write would read as "saved"); one press
 * creates one expense (`useSaveOnce`); a changed form asks before it is
 * dismissed, and nothing can dismiss it while it saves. An edit sends only
 * what changed, with the version it read — see `editPatch`.
 *
 * Deleting asks first and names the cost that goes (forgejo#250): it was one
 * unconfirmed tap away before.
 */
export default function ExpenseDialog({
  roadtripId,
  stations,
  expense,
  defaultCurrency,
  onClose,
  onSaved,
}: {
  roadtripId: string;
  /** The roadtrip's stations in travel order; route corrections are left out here. */
  stations: readonly RoadtripStation[];
  /** The expense to change, or null for a new one. */
  expense: TripExpense | null;
  defaultCurrency: string;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const { t, i18n } = useTranslation(["roadtrips", "common"]);
  const display = useDisplayFormat();
  const recent = useRecentCurrencies();
  const pinnable = stations.filter((s) => s.state !== "via");
  const titleOf = (id: string | null) => stations.find((s) => s.id === id)?.title ?? "?";

  const [initial] = useState<ExpenseDraft>(() => expenseDraft(expense, defaultCurrency));
  const [draft, setDraft] = useState<ExpenseDraft>(initial);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [removing, setRemoving] = useState(false);
  const { dirty, markSaved } = useDirtyGuard(initial, draft);
  const saving = useSaveOnce<unknown>();
  const failure = useFormFailure(JSON.stringify(draft));

  const set = <K extends keyof ExpenseDraft>(key: K, value: ExpenseDraft[K]): void =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  const onLeg = expense !== null && expense.legFromStopId !== null && draft.stopId === "";
  const amount = parseAmount(draft.amount);
  const amountInvalid = draft.amount.trim() !== "" && amount === null;
  const missing: MissingStep[] =
    amount === null
      ? [
          {
            field: AMOUNT_ID,
            label: amountInvalid
              ? t("roadtrips:costs.dialog.amountMissingValid")
              : t("roadtrips:costs.dialog.amount"),
          },
        ]
      : [];
  const busy = saving.saving || removing;

  const save = async (): Promise<void> => {
    if (missing.length > 0) return;
    const patch = expense ? editPatch(initial, draft, expense.updatedAt) : null;
    // Nothing changed: there is nothing to send, and nothing to lose by closing.
    if (expense && patch === null) {
      onClose();
      return;
    }
    failure.clear();
    const outcome = await saving.save(
      () =>
        expense && patch
          ? expensesApi.updateForRoadtrip(roadtripId, expense.id, patch)
          : expensesApi.createForRoadtrip(roadtripId, createBody(draft)),
      () => {
        markSaved();
        onSaved();
      }
    );
    if (outcome.status === "failed") {
      logger.warn("Saving a roadtrip expense failed", outcome.error);
      failure.fail(expenseFailureKey(outcome.error));
    }
  };

  const remove = async (): Promise<void> => {
    if (!expense) return;
    setRemoving(true);
    failure.clear();
    try {
      await expensesApi.removeForRoadtrip(roadtripId, expense.id, expense.updatedAt);
      setConfirmDelete(false);
      markSaved();
      onSaved();
    } catch (err) {
      logger.warn("Deleting a roadtrip expense failed", err);
      setConfirmDelete(false);
      failure.fail(expenseFailureKey(err));
    } finally {
      setRemoving(false);
    }
  };

  /** "Tanken · 45,00 € · 14.07.2026" — the STORED cost, not the edited draft. */
  const storedLabel = expense
    ? [
        t(`roadtrips:costs.kind.${expense.kind}`),
        formatCurrency(expense.amount, expense.currency, { language: i18n.language }),
        expense.date ? display.date(`${expense.date}T00:00:00Z`, { timeZone: "UTC" }) : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "";

  const failureKey = failure.failureKey;

  return (
    <Dialog
      open
      onClose={onClose}
      busy={busy}
      dirty={dirty}
      maxWidth={480}
      title={t(expense ? "roadtrips:costs.dialog.titleEdit" : "roadtrips:costs.dialog.titleNew")}
      closeLabel={t("common:buttons.close")}
      dismissLabel={t("common:buttons.cancel")}
      action={
        <div className="flex flex-col items-end" style={{ gap: "var(--ts-space-xs)" }}>
          <Button
            variant="primary"
            disabled={busy || saving.saved !== null || missing.length > 0}
            aria-describedby={HINT_ID}
            onClick={() => void save()}
          >
            {saving.saving ? t("common:buttons.saving") : t("roadtrips:costs.dialog.save")}
          </Button>
          <SaveBlockedHint id={HINT_ID} missing={missing} />
        </div>
      }
    >
      <div ref={failure.rootRef} className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
        <Field
          label={
            <>
              {t("roadtrips:costs.dialog.kind")} <RequiredMark />
            </>
          }
          htmlFor="expense-kind"
        >
          <Select
            id="expense-kind"
            aria-required="true"
            value={draft.kind}
            onChange={(e) => set("kind", e.target.value as ExpenseKind)}
          >
            {EXPENSE_KINDS.map((k) => (
              <option key={k} value={k}>
                {t(`roadtrips:costs.kind.${k}`)}
              </option>
            ))}
          </Select>
        </Field>
        <div className="grid grid-cols-2" style={{ gap: 12 }}>
          <Field
            label={
              <>
                {t("roadtrips:costs.dialog.amount")} <RequiredMark />
              </>
            }
            htmlFor={AMOUNT_ID}
            error={amountInvalid ? t("roadtrips:costs.dialog.amountInvalid") : undefined}
          >
            <Input
              id={AMOUNT_ID}
              inputMode="decimal"
              aria-required="true"
              value={draft.amount}
              invalid={amountInvalid}
              onChange={(e) => set("amount", e.target.value)}
            />
          </Field>
          <Field
            label={
              <>
                {t("roadtrips:costs.dialog.currency")} <RequiredMark />
              </>
            }
            htmlFor="expense-currency"
          >
            <CurrencySelect
              id="expense-currency"
              value={draft.currency}
              onChange={(value) => set("currency", value)}
              recent={recent}
            />
          </Field>
        </div>
        <Field
          label={t("roadtrips:costs.dialog.date")}
          htmlFor="expense-date"
          hint={t("roadtrips:costs.dialog.dateHint")}
        >
          <Input
            id="expense-date"
            type="date"
            value={draft.date}
            onChange={(e) => set("date", e.target.value)}
          />
        </Field>
        <Field label={t("roadtrips:costs.dialog.station")} htmlFor="expense-station">
          <Select
            id="expense-station"
            value={draft.stopId}
            onChange={(e) => set("stopId", e.target.value)}
          >
            <option value="">
              {onLeg
                ? t("roadtrips:costs.dialog.keepLeg", {
                    from: titleOf(expense?.legFromStopId ?? null),
                    to: titleOf(expense?.legToStopId ?? null),
                  })
                : t("roadtrips:costs.dialog.stationNone")}
            </option>
            {pinnable.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label={t("roadtrips:costs.dialog.note")} htmlFor="expense-note">
          <TextArea
            id="expense-note"
            rows={2}
            value={draft.note}
            onChange={(e) => set("note", e.target.value)}
          />
        </Field>
        <RequiredLegend />
        <FormErrorBanner
          message={failureKey ? t(failureKey) : null}
          onRetry={
            failureKey && isTransientExpenseFailure(failureKey) ? () => void save() : undefined
          }
          retryDisabled={busy}
        />
        {expense && (
          <button
            type="button"
            className="self-start underline pointer-coarse:min-h-(--ts-size-touch-min)"
            style={{ fontSize: 13, color: "var(--ts-bad)" }}
            disabled={busy}
            onClick={() => setConfirmDelete(true)}
          >
            {t("roadtrips:costs.dialog.delete")}
          </button>
        )}
      </div>
      {confirmDelete && expense && (
        <ConfirmModal
          isOpen
          isLoading={removing}
          onClose={() => setConfirmDelete(false)}
          onConfirm={() => void remove()}
          title={t("roadtrips:costs.deleteConfirm.title")}
          message={t("roadtrips:costs.deleteConfirm.message", {
            name: storedLabel,
            place: expense.stopId
              ? titleOf(expense.stopId)
              : expense.legFromStopId
                ? `${titleOf(expense.legFromStopId)} → ${titleOf(expense.legToStopId)}`
                : t("roadtrips:costs.wholeTrip"),
          })}
          confirmText={t("roadtrips:costs.deleteConfirm.confirm")}
          confirmButtonClass={DELETE_BUTTON_CLASS}
        />
      )}
    </Dialog>
  );
}
