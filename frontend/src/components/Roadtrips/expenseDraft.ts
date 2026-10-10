import axios from "axios";

import { apiErrorMachineCode } from "../../lib/apiError";
import {
  isOutcomeUnknownSaveError,
  saveErrorKey,
  type SaveErrorOptions,
} from "../../lib/saveErrorMessage";
import type { ExpenseKind } from "../../shared/expenses";
import type { ExpenseFxInput, ExpenseInput, TripExpense } from "../../types/expense";
import { parseRate, rateText } from "./expenseFx";

/** Who paid, as the picker holds it: nobody recorded, a companion, or a typed name. */
export type PayerMode = "none" | "companion" | "name";

/**
 * What to do with the exchange rate: `keep` sends nothing (the server keeps
 * the stored rate, or looks one up when amount, currency or day changed);
 * `manual` sends the typed rate; `remove` clears it.
 */
export type FxMode = "keep" | "manual" | "remove";

/** What the expense dialog edits, as the inputs hold it. */
export interface ExpenseDraft {
  kind: ExpenseKind;
  amount: string;
  currency: string;
  date: string;
  stopId: string;
  note: string;
  payerMode: PayerMode;
  payerCompanionId: string;
  /** The typed name in `name` mode; the companion's name in `companion` mode. */
  payerName: string;
  fxMode: FxMode;
  fxRate: string;
}

/**
 * What a body needs beyond the draft: the reader's base currency (a typed
 * rate converts INTO it) and today's day in the reader's zone (the day a
 * typed rate is for when the expense itself is undated).
 */
export interface ExpenseWriteContext {
  baseCurrency: string;
  today: string;
}

/**
 * The draft one opening starts from — the inputs' first values AND the dirty
 * baseline, from one function so the two cannot drift apart (an `amount` of
 * `"10"` here and `10` there would open every edit already "changed").
 */
export function expenseDraft(expense: TripExpense | null, defaultCurrency: string): ExpenseDraft {
  return {
    kind: expense?.kind ?? "fuel",
    amount: expense ? String(expense.amount) : "",
    currency: expense?.currency ?? defaultCurrency,
    date: expense?.date ?? "",
    stopId: expense?.stopId ?? "",
    note: expense?.note ?? "",
    payerMode: !expense?.payer ? "none" : expense.payer.companionId ? "companion" : "name",
    payerCompanionId: expense?.payer?.companionId ?? "",
    payerName: expense?.payer?.name ?? "",
    fxMode: "keep",
    fxRate: rateText(expense?.fx ?? null),
  };
}

/** The payer as the server takes it; null when none is recorded. */
export function payerBody(draft: ExpenseDraft): { companionId: string } | { name: string } | null {
  if (draft.payerMode === "companion" && draft.payerCompanionId !== "") {
    return { companionId: draft.payerCompanionId };
  }
  if (draft.payerMode === "name" && draft.payerName.trim() !== "") {
    return { name: draft.payerName.trim() };
  }
  return null;
}

/**
 * The rate to send: `undefined` — send nothing; `null` — remove the stored
 * one; else the typed rate, for the expense's day (or today, when it has
 * none) into the reader's base currency. A cost already IN the base currency
 * needs no rate, so a typed one is not sent for it.
 */
export function fxBody(
  draft: ExpenseDraft,
  context: ExpenseWriteContext
): ExpenseFxInput | null | undefined {
  if (draft.fxMode === "remove") return null;
  if (draft.fxMode !== "manual" || draft.currency === context.baseCurrency) return undefined;
  const rate = parseRate(draft.fxRate);
  if (rate === null) return undefined;
  return {
    rate,
    rateDate: draft.date === "" ? context.today : draft.date,
    baseCurrency: context.baseCurrency,
    source: "manual",
  };
}

/** A typed rate that cannot be sent: manual mode, a foreign currency, no usable number. */
export function rateInvalid(draft: ExpenseDraft, baseCurrency: string): boolean {
  return (
    draft.fxMode === "manual" && draft.currency !== baseCurrency && parseRate(draft.fxRate) === null
  );
}

/** The amount as a number, or null when it is empty or cannot be one. */
export function parseAmount(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** The full body of a NEW expense. Payer and rate only when the reader gave one. */
export function createBody(draft: ExpenseDraft, context: ExpenseWriteContext): ExpenseInput {
  const payer = payerBody(draft);
  const fx = fxBody(draft, context);
  return {
    kind: draft.kind,
    amount: parseAmount(draft.amount) ?? 0,
    currency: draft.currency,
    date: draft.date === "" ? null : draft.date,
    note: draft.note.trim() === "" ? null : draft.note.trim(),
    // A station replaces a leg; no station keeps whatever leg it had.
    ...(draft.stopId !== ""
      ? { stopId: draft.stopId, legFromStopId: null, legToStopId: null }
      : { stopId: null }),
    ...(payer !== null ? { payer } : {}),
    ...(fx !== undefined ? { fx } : {}),
  };
}

/**
 * The edit as a PATCH of only what changed, with the version it was read at.
 *
 * The phone edits expenses too (forgejo#271), and the server's PATCH is
 * partial: sending every field back would write the values this dialog was
 * opened with over whatever the phone changed meanwhile. A field the reader
 * did not touch is therefore not in the body at all, and `baseVersion` makes
 * the server answer 409 rather than overwrite a newer record.
 */
export function editPatch(
  initial: ExpenseDraft,
  draft: ExpenseDraft,
  version: string,
  context: ExpenseWriteContext
): (Partial<ExpenseInput> & { baseVersion: string }) | null {
  const full = createBody(draft, context);
  const patch: Partial<ExpenseInput> = {};
  if (draft.kind !== initial.kind) patch.kind = full.kind;
  if (parseAmount(draft.amount) !== parseAmount(initial.amount)) patch.amount = full.amount;
  if (draft.currency !== initial.currency) patch.currency = full.currency;
  if (draft.date !== initial.date) patch.date = full.date;
  if (draft.note.trim() !== initial.note.trim()) patch.note = full.note;
  if (draft.stopId !== initial.stopId) {
    patch.stopId = full.stopId;
    if (draft.stopId !== "") {
      patch.legFromStopId = null;
      patch.legToStopId = null;
    }
  }
  const payer = payerBody(draft);
  if (JSON.stringify(payer) !== JSON.stringify(payerBody(initial))) patch.payer = payer;
  // Only a rate the reader touched: an untouched one is left to the server,
  // which keeps it, or looks a new one up when amount, currency or day moved.
  const fx = fxBody(draft, context);
  if (fx !== undefined) patch.fx = fx;
  return Object.keys(patch).length === 0 ? null : { ...patch, baseVersion: version };
}

/** The roadtrip copy for each refusal the dialog can meet. */
const EXPENSE_FAILURE_KEYS = {
  invalid: "roadtrips:costs.dialog.error.invalid",
  gone: "roadtrips:costs.dialog.error.gone",
  unreachable: "roadtrips:costs.dialog.error.unreachable",
  conflict: "roadtrips:costs.dialog.error.conflict",
} as const;

/**
 * Which sentence a failed save or delete gets — each says what to do next.
 * A newer record on the server (409 `VERSION_CONFLICT`) is its own case: the
 * reader's input is fine, the page is out of date.
 */
export function expenseFailureKey(err: unknown, options: SaveErrorOptions = {}): string {
  if (apiErrorMachineCode(err) === "VERSION_CONFLICT") return EXPENSE_FAILURE_KEYS.conflict;
  const status = axios.isAxiosError(err) ? err.response?.status : undefined;
  if (status === 400) return EXPENSE_FAILURE_KEYS.invalid;
  if (status === 404) return EXPENSE_FAILURE_KEYS.gone;
  // A new expense whose answer was lost may be stored already: "unreachable"
  // would invite the second press that books it twice.
  if (options.create === true) {
    const key = saveErrorKey(err, EXPENSE_FAILURE_KEYS.unreachable, {}, options);
    if (isOutcomeUnknownSaveError(key)) return key;
  }
  if (axios.isAxiosError(err) && !err.response) return EXPENSE_FAILURE_KEYS.unreachable;
  return saveErrorKey(err, EXPENSE_FAILURE_KEYS.unreachable);
}

/** Failures a second press can cure: no answer, a database restarting, a rate limit. */
export function isTransientExpenseFailure(key: string): boolean {
  return (
    key === EXPENSE_FAILURE_KEYS.unreachable ||
    key === "common:saveErrors.network" ||
    key === "common:saveErrors.dbUnavailable" ||
    key === "common:saveErrors.rateLimited"
  );
}
