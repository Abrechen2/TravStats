import { api } from "./client";
import type { ExpenseInput, ExpenseWriteResult } from "../../types/expense";

/**
 * A roadtrip's expenses (forgejo#140). The trip-wide family
 * (`/trips/:id/expenses`) exists on the server too; the web books costs on the
 * roadtrip page only, so this client covers that one.
 */
export const expensesApi = {
  /**
   * The stored expense AND `fxSnapshot` — what became of its exchange rate.
   * A `lookupFailed` is a saved expense that counts in its own currency only,
   * which the caller must say (forgejo#150).
   */
  createForRoadtrip: async (
    roadtripId: string,
    input: ExpenseInput
  ): Promise<ExpenseWriteResult> => {
    const { data } = await api.post<ExpenseWriteResult>(`/roadtrips/${roadtripId}/expenses`, input);
    return data;
  },

  /**
   * Partial: an omitted field is left alone, `null` clears it. `baseVersion`
   * (the expense's `updatedAt` as read) makes the server answer 409
   * `VERSION_CONFLICT` instead of overwriting a newer record (forgejo#141).
   */
  updateForRoadtrip: async (
    roadtripId: string,
    expenseId: string,
    input: Partial<ExpenseInput> & { baseVersion?: string }
  ): Promise<ExpenseWriteResult> => {
    const { data } = await api.patch<ExpenseWriteResult>(
      `/roadtrips/${roadtripId}/expenses/${expenseId}`,
      input
    );
    return data;
  },

  /**
   * `version` (the expense's `updatedAt` as read) goes as `If-Match`: a cost
   * the phone changed meanwhile is answered 409 `VERSION_CONFLICT` instead of
   * being deleted unseen (review M8).
   */
  removeForRoadtrip: async (
    roadtripId: string,
    expenseId: string,
    version?: string
  ): Promise<void> => {
    await api.delete(`/roadtrips/${roadtripId}/expenses/${expenseId}`, {
      headers: version ? { "If-Match": `"${version}"` } : undefined,
    });
  },
};
