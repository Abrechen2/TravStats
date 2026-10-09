import { AsyncLocalStorage } from "async_hooks";

/**
 * Time budget for reading ONE document across every template tried on it.
 *
 * Each template run is bounded (`EXTRACT_TIMEOUT_MS`), but a document may be
 * tried against many templates. The budget caps the sum per document, and it
 * lives in the request's async context — never in module state — so a crafted
 * document can only spend its own budget. An earlier version quarantined a
 * slow template process-wide, which let one user's upload switch a template
 * off for every user of the instance.
 */
export const PARSE_TEMPLATE_BUDGET_MS = 3000;

interface Budget {
  deadline: number;
}

const store = new AsyncLocalStorage<Budget>();

export function withParseBudget<T>(
  fn: () => Promise<T>,
  ms = PARSE_TEMPLATE_BUDGET_MS
): Promise<T> {
  return store.run({ deadline: Date.now() + ms }, fn);
}

/** Milliseconds left in the current document's budget; null outside a budget. */
export function remainingBudgetMs(): number | null {
  const budget = store.getStore();
  return budget === undefined ? null : Math.max(0, budget.deadline - Date.now());
}
