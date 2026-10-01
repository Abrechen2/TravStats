import { useState } from "react";
import type { JSX } from "react";
import axios from "axios";

import Button from "../ui/Button";
import Dialog from "../ui/Dialog";
import { Field, Input, Select, TextArea } from "../ui/Field";
import CurrencySelect from "../common/CurrencySelect";
import { useTranslation } from "../../hooks/useTranslation";
import { useRecentCurrencies } from "../../hooks/useRecentCurrencies";
import { expensesApi } from "../../lib/api/expenses";
import { logger } from "../../lib/logger";
import { EXPENSE_KINDS, type ExpenseKind } from "../../shared/expenses";
import type { ExpenseInput, TripExpense } from "../../types/expense";
import type { RoadtripStation } from "../../types/roadtrip";

type Failure = "invalid" | "gone" | "unreachable";

/** Which failure the reader is told about — each says what to do next. */
function failureOf(err: unknown): Failure {
  const status = axios.isAxiosError(err) ? err.response?.status : undefined;
  if (status === 400) return "invalid";
  if (status === 404) return "gone";
  return "unreachable";
}

/**
 * Record or change one roadtrip expense (forgejo#140): what for, how much, in
 * which currency, on which day, at which station. The web pins to a station or
 * to nothing; an expense the server holds on a leg (a toll the old leg field
 * carried) keeps its leg unless the reader picks a station instead.
 *
 * A refused save keeps the dialog open and says why — closing on a failed
 * write would read as "saved".
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
  const { t } = useTranslation(["roadtrips", "common"]);
  const recent = useRecentCurrencies();
  const pinnable = stations.filter((s) => s.state !== "via");
  const titleOf = (id: string | null) => stations.find((s) => s.id === id)?.title ?? "?";

  const [kind, setKind] = useState<ExpenseKind>(expense?.kind ?? "fuel");
  const [amount, setAmount] = useState(expense ? String(expense.amount) : "");
  const [currency, setCurrency] = useState(expense?.currency ?? defaultCurrency);
  const [date, setDate] = useState(expense?.date ?? "");
  const [stopId, setStopId] = useState(expense?.stopId ?? "");
  const [note, setNote] = useState(expense?.note ?? "");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<Failure | null>(null);

  const onLeg = expense !== null && expense.legFromStopId !== null && stopId === "";
  const parsed = Number(amount.replace(",", "."));
  const amountValid = amount.trim() !== "" && Number.isFinite(parsed) && parsed >= 0;

  const save = async (): Promise<void> => {
    if (!amountValid) return;
    setSaving(true);
    setFailure(null);
    const body: ExpenseInput = {
      kind,
      amount: parsed,
      currency,
      date: date === "" ? null : date,
      note: note.trim() === "" ? null : note.trim(),
      // A station replaces a leg; no station keeps whatever leg it had.
      ...(stopId !== "" ? { stopId, legFromStopId: null, legToStopId: null } : { stopId: null }),
    };
    try {
      if (expense) await expensesApi.updateForRoadtrip(roadtripId, expense.id, body);
      else await expensesApi.createForRoadtrip(roadtripId, body);
      onSaved();
    } catch (err) {
      logger.warn("Saving a roadtrip expense failed", err);
      setFailure(failureOf(err));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (): Promise<void> => {
    if (!expense) return;
    setSaving(true);
    setFailure(null);
    try {
      await expensesApi.removeForRoadtrip(roadtripId, expense.id);
      onSaved();
    } catch (err) {
      logger.warn("Deleting a roadtrip expense failed", err);
      setFailure(failureOf(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth={480}
      title={t(expense ? "roadtrips:costs.dialog.titleEdit" : "roadtrips:costs.dialog.titleNew")}
      closeLabel={t("common:buttons.close")}
      dismissLabel={t("common:buttons.cancel")}
      action={
        <Button variant="primary" disabled={saving || !amountValid} onClick={() => void save()}>
          {t("roadtrips:costs.dialog.save")}
        </Button>
      }
    >
      <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
        <Field label={t("roadtrips:costs.dialog.kind")} htmlFor="expense-kind">
          <Select
            id="expense-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as ExpenseKind)}
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
            label={t("roadtrips:costs.dialog.amount")}
            htmlFor="expense-amount"
            error={
              amount !== "" && !amountValid ? t("roadtrips:costs.dialog.amountInvalid") : undefined
            }
          >
            <Input
              id="expense-amount"
              inputMode="decimal"
              value={amount}
              invalid={amount !== "" && !amountValid}
              onChange={(e) => setAmount(e.target.value)}
            />
          </Field>
          <Field label={t("roadtrips:costs.dialog.currency")} htmlFor="expense-currency">
            <CurrencySelect
              id="expense-currency"
              value={currency}
              onChange={setCurrency}
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
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <Field label={t("roadtrips:costs.dialog.station")} htmlFor="expense-station">
          <Select id="expense-station" value={stopId} onChange={(e) => setStopId(e.target.value)}>
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
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
        </Field>
        {failure && (
          <p role="alert" style={{ color: "var(--ts-bad)", fontSize: 13 }}>
            {t(`roadtrips:costs.dialog.error.${failure}`)}
          </p>
        )}
        {expense && (
          <button
            type="button"
            className="self-start underline"
            style={{ fontSize: 13, color: "var(--ts-bad)" }}
            disabled={saving}
            onClick={() => void remove()}
          >
            {t("roadtrips:costs.dialog.delete")}
          </button>
        )}
      </div>
    </Dialog>
  );
}
