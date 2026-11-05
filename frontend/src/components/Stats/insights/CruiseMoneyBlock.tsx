import type { JSX } from "react";

import { STAT_CARD_CLASS, STAT_CARD_STYLE } from "../StatCard";
import { InsightHeading } from "./InsightHeading";
import { CruiseLink, CruiseLinks } from "./cruiseLinks";
import { useInsightFormat } from "./insightFormat";
import { useTranslation } from "../../../hooks/useTranslation";
import { formatCurrency } from "../../../lib/units";
import type { CruiseInsights } from "../../../types/cruiseInsights";

/**
 * Cost per sea day, the most expensive cruise and spend per cruise line, all in
 * the account's base currency — a price that cannot reach it is named in the
 * footer, never added. Hidden while no cruise reached the base currency.
 */
export default function CruiseMoneyBlock({
  money,
}: {
  money: CruiseInsights["money"];
}): JSX.Element | null {
  const { t } = useTranslation(["stats"]);
  const fmt = useInsightFormat();
  if (money.counted === 0) return null;
  const muted = { color: "var(--text-muted)" };
  const cur = (n: number): string => formatCurrency(n, money.currency);

  return (
    <div className={STAT_CARD_CLASS} style={STAT_CARD_STYLE} data-testid="cruise-money-block">
      <InsightHeading
        id="cruise-insights-money"
        title={t("stats:insights.cruise.money.title")}
        topic="cruiseMoney"
      />
      <dl className="space-y-2 text-sm">
        {money.perSeaDay && (
          <div>
            <dt className="font-medium">
              {t("stats:insights.cruise.money.perSeaDay", {
                amount: cur(money.perSeaDay.amount),
              })}
            </dt>
            <dd style={muted}>
              {t("stats:insights.cruise.money.perSeaDayDetail", {
                days: fmt.num(money.perSeaDay.seaDays),
                cruises: fmt.num(money.perSeaDay.cruises.length),
              })}
              : <CruiseLinks cruises={money.perSeaDay.cruises} />
            </dd>
          </div>
        )}
        {money.mostExpensive && (
          <div>
            <dt className="font-medium">{t("stats:insights.cruise.money.mostExpensive")}</dt>
            <dd style={muted}>
              {cur(money.mostExpensive.amount)} · <CruiseLink cruise={money.mostExpensive.cruise} />
            </dd>
          </div>
        )}
        {money.perLine.length > 0 && (
          <div>
            <dt className="font-medium">{t("stats:insights.cruise.money.perLine")}</dt>
            {money.perLine.map((l) => (
              <dd key={l.line} style={muted}>
                {l.line}: {cur(l.total)} (
                {t("stats:insights.cruise.money.lineCruises", { count: l.cruises.length })}) ·{" "}
                <CruiseLinks cruises={l.cruises} />
              </dd>
            ))}
          </div>
        )}
      </dl>
      <p className="mt-3 text-xs" style={muted}>
        {t("stats:insights.cruise.money.coverage", {
          counted: fmt.num(money.counted),
          cruises: fmt.num(money.cruises),
          currency: money.currency,
          unknown: fmt.num(money.unknownPrice),
          excluded: fmt.num(money.excluded),
        })}
      </p>
    </div>
  );
}
