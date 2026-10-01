import axios from "axios";

/**
 * A section delete the server refused because the roadtrip or tour carries
 * costs and belongs to no trip (forgejo#140, `SECTION_HAS_EXPENSES`): how many
 * costs would go with it, or null for any other failure. The caller then asks
 * the reader once more and retries with `deleteExpenses`.
 */
export function sectionExpenseCount(err: unknown): number | null {
  if (!axios.isAxiosError(err) || err.response?.status !== 409) return null;
  const body = err.response.data as { code?: unknown; expenseCount?: unknown } | undefined;
  return body?.code === "SECTION_HAS_EXPENSES" && typeof body.expenseCount === "number"
    ? body.expenseCount
    : null;
}
