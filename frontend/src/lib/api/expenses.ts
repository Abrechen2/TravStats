import { api } from "./client";
import type { ExpenseInput, TripExpense } from "../../types/expense";

/**
 * A roadtrip's expenses (forgejo#140). The trip-wide family
 * (`/trips/:id/expenses`) exists on the server too; the web books costs on the
 * roadtrip page only, so this client covers that one.
 */
export const expensesApi = {
  createForRoadtrip: async (roadtripId: string, input: ExpenseInput): Promise<TripExpense> => {
    const { data } = await api.post<{ expense: TripExpense }>(
      `/roadtrips/${roadtripId}/expenses`,
      input
    );
    return data.expense;
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
  ): Promise<TripExpense> => {
    const { data } = await api.patch<{ expense: TripExpense }>(
      `/roadtrips/${roadtripId}/expenses/${expenseId}`,
      input
    );
    return data.expense;
  },

  removeForRoadtrip: async (roadtripId: string, expenseId: string): Promise<void> => {
    await api.delete(`/roadtrips/${roadtripId}/expenses/${expenseId}`);
  },
};
