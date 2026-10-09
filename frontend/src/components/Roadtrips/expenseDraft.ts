import axios from "axios";

import { apiErrorMachineCode } from "../../lib/apiError";
import {
  isOutcomeUnknownSaveError,
  saveErrorKey,
  type SaveErrorOptions,
} from "../../lib/saveErrorMessage";
import type { ExpenseKind } from "../../shared/expenses";
import type { ExpenseInput, TripExpense } from "../../types/expense";

/** What the expense dialog edits, as the inputs hold it. */
export interface ExpenseDraft {
  kind: ExpenseKind;
  amount: string;
  currency: string;
  date: string;
  stopId: string;
  note: string;
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
  };
}

/** The amount as a number, or null when it is empty or cannot be one. */
export function parseAmount(text: string): number | null {
  if (text.trim() === "") return null;
  const value = Number(text.replace(",", "."));
  return Number.isFinite(value) && value >= 0 ? value : null;
}

/** The full body of a NEW expense. */
export function createBody(draft: ExpenseDraft): ExpenseInput {
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
  version: string
): (Partial<ExpenseInput> & { baseVersion: string }) | null {
  const full = createBody(draft);
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
