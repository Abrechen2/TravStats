import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { formatAmounts } from "../../Roadtrips/RoadtripCostsSection";
import type { ExpenseAccount } from "../../../types/travelAccount";

/** Same reading as the roadtrip cost panel: by currency code, joined with "+", never summed. */
function ByCurrency({ amounts }: { amounts: Record<string, number> }): JSX.Element {
  const { i18n } = useTranslation(["stats"]);
  return <span>{formatAmounts(amounts, i18n.language)}</span>;
}

/**
 * Roadtrip side costs (ferry, toll, pitch, fuel; forgejo#140) per year, one
 * figure per currency. Renders nothing when the server sends none (an older
 * server omits the field; an account without expenses sends count 0).
 */
export default function TravelAccountExpenses({
  expenses,
}: {
  expenses: ExpenseAccount | undefined;
}): JSX.Element | null {
  const { t } = useTranslation(["stats"]);
  if (!expenses || expenses.count === 0) return null;
  const undated = Object.keys(expenses.undatedByCurrency).length > 0;
  return (
    <div className="mt-8" data-testid="travel-account-expenses">
      <h3 className="mb-1 text-lg font-semibold" style={{ color: "var(--text-primary)" }}>
        {t("stats:travelAccount.expenses.title")}
      </h3>
      <p className="mb-3 text-xs" style={{ color: "var(--text-muted)" }}>
        {t("stats:travelAccount.expenses.desc", { count: expenses.count })}
      </p>
      <dl className="grid grid-cols-[4rem_1fr] gap-x-3 gap-y-1 text-sm">
        {expenses.years.map((y) => (
          <div key={y.year} className="contents">
            <dt style={{ color: "var(--text-muted)" }}>{y.year}</dt>
            <dd style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
              <ByCurrency amounts={y.byCurrency} />
            </dd>
          </div>
        ))}
        {undated && (
          <div className="contents">
            <dt style={{ color: "var(--text-muted)" }}>
              {t("stats:travelAccount.expenses.undated")}
            </dt>
            <dd style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
              <ByCurrency amounts={expenses.undatedByCurrency} />
            </dd>
          </div>
        )}
        <div className="contents font-semibold">
          <dt style={{ color: "var(--text-muted)" }}>{t("stats:travelAccount.expenses.total")}</dt>
          <dd style={{ color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}>
            <ByCurrency amounts={expenses.totalByCurrency} />
          </dd>
        </div>
      </dl>
    </div>
  );
}
