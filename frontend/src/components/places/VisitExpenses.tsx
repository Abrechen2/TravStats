import { useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { expensesApi } from "../../lib/api/expenses";
import { logger } from "../../lib/logger";
import { formatCurrency } from "../../lib/units";
import type { TripExpense } from "../../types/expense";
import { formatAmounts } from "../Roadtrips/RoadtripCostsSection";

/**
 * What was paid at this visit (forgejo#429): each cost in its own currency,
 * and a total per currency — never one number across currencies. Renders
 * nothing when the visit has no cost; a failed load says so instead of
 * passing for "no costs".
 */
export function VisitExpenses({ visitId }: { visitId: string }): JSX.Element | null {
  const { t, i18n } = useTranslation(["places", "roadtrips"]);
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "failed" }
    | { kind: "ok"; expenses: TripExpense[]; totals: Record<string, number> }
  >({ kind: "loading" });

  useEffect(() => {
    let live = true;
    expensesApi
      .forVisit(visitId)
      .then((res) => {
        if (live) setState({ kind: "ok", ...res });
      })
      .catch((err: unknown) => {
        logger.warn("visit expenses not loaded", err);
        if (live) setState({ kind: "failed" });
      });
    return () => {
      live = false;
    };
  }, [visitId]);

  if (state.kind === "loading") return null;
  if (state.kind === "failed") {
    return (
      <p role="alert" className="t-caption">
        {t("places:visitCosts.loadFailed")}
      </p>
    );
  }
  if (state.expenses.length === 0) return null;
  return (
    <section aria-label={t("places:visitCosts.title")} data-testid="visit-expenses">
      <h4 className="t-caption">{t("places:visitCosts.title")}</h4>
      <ul>
        {state.expenses.map((e) => (
          <li key={e.id} className="text-sm">
            {t(`roadtrips:costs.kind.${e.kind}`)}
            {e.note ? ` · ${e.note}` : ""} ·{" "}
            {formatCurrency(e.amount, e.currency, { language: i18n.language })}
          </li>
        ))}
      </ul>
      {state.expenses.length > 1 && (
        <p className="text-sm">
          <strong>{formatAmounts(state.totals, i18n.language)}</strong>
        </p>
      )}
    </section>
  );
}
