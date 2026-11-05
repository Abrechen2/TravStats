import type { JSX } from "react";

import { STAT_CARD_CLASS, STAT_CARD_STYLE } from "../StatCard";
import { InsightHeading } from "./InsightHeading";
import { CruiseLinks } from "./cruiseLinks";
import { useInsightFormat } from "./insightFormat";
import { useTranslation } from "../../../hooks/useTranslation";
import type { CruiseInsights } from "../../../types/cruiseInsights";

/**
 * The biggest ship sailed and the average age of the ships when they were
 * sailed, from the ship catalogue. Each figure says how many cruises it could
 * be read on; the block is hidden while the catalogue holds neither figure.
 */
export default function CruiseShipsBlock({
  ships,
}: {
  ships: CruiseInsights["ships"];
}): JSX.Element | null {
  const { t } = useTranslation(["stats"]);
  const fmt = useInsightFormat();
  if (ships.biggest === null && ships.averageAge === null) return null;
  const muted = { color: "var(--text-muted)" };
  const { biggest, averageAge } = ships;

  return (
    <div className={STAT_CARD_CLASS} style={STAT_CARD_STYLE} data-testid="cruise-ships-block">
      <InsightHeading
        id="cruise-insights-ships"
        title={t("stats:insights.cruise.ships.title")}
        topic="cruiseShips"
      />
      <dl className="space-y-2 text-sm">
        {biggest && (
          <div>
            <dt className="font-medium">{t("stats:insights.cruise.ships.biggest")}</dt>
            <dd style={muted}>
              {biggest.shipName} ·{" "}
              {t("stats:insights.cruise.ships.biggestDetail", {
                tonnage: fmt.num(biggest.grossTonnage),
              })}
              {biggest.capacity !== null &&
                ` · ${t("stats:insights.cruise.ships.capacity", { capacity: fmt.num(biggest.capacity) })}`}
              {biggest.yearBuilt !== null &&
                ` · ${t("stats:insights.cruise.ships.built", { year: biggest.yearBuilt })}`}
              : <CruiseLinks cruises={biggest.cruises} />
            </dd>
          </div>
        )}
        {averageAge && (
          <div>
            <dt className="font-medium">
              {t("stats:insights.cruise.ships.averageAge", {
                years: fmt.num(Math.round(averageAge.years * 10) / 10),
              })}
            </dt>
            <dd style={muted}>
              <CruiseLinks cruises={averageAge.cruises} />
            </dd>
          </div>
        )}
      </dl>
      <p className="mt-3 text-xs" style={muted}>
        {[
          t("stats:insights.cruise.ships.coverageTonnage", {
            known: fmt.num(ships.tonnageKnown),
            cruises: fmt.num(ships.cruises),
          }),
          t("stats:insights.cruise.ships.coverageAge", {
            known: fmt.num(ships.ageKnown),
            cruises: fmt.num(ships.cruises),
          }),
        ].join(" · ")}
      </p>
    </div>
  );
}
