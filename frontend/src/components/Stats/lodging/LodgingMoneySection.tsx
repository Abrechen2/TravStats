import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useSettingsStore } from "../../../store/settingsStore";
import { formatCurrency } from "../../../lib/units";
import { countryName } from "../../../lib/countryFlag";
import type { LodgingPriceGroup, LodgingStats } from "../../../types/lodging";
import StatCard from "../StatCard";
import RankedBarList, { type RankedRow } from "./RankedBarList";

const LODGING_ACCENT = "var(--domain-lodging, #d4778f)";
const LIST_LIMIT = 6;

interface Props {
  stats: LodgingStats;
}

/**
 * What a night costs — the block the lodging domain was carrying the data for
 * all along without ever showing it. Every figure is in the user's base
 * currency and comes from `GET /stats/lodging`; nothing is recomputed here, so
 * it cannot drift from the rollup the achievements read.
 *
 * The honesty line matters more than the averages: `pricedStays` /
 * `unpricedStays` say how much of the collection the averages actually
 * describe. An average over four of ninety stays looks exactly like an average
 * over ninety unless the screen says otherwise.
 */
export default function LodgingMoneySection({ stats }: Props): JSX.Element {
  const { t, i18n } = useTranslation(["lodging", "stats"]);
  const baseCurrency = useSettingsStore((s) => s.baseCurrency);
  const { price } = stats;
  const locale = i18n.language.startsWith("en") ? "en" : "de";

  const money = (value: number): string => formatCurrency(value, baseCurrency);
  const priceRows = (
    groups: LodgingPriceGroup[],
    label: (key: string) => string,
  ): RankedRow[] =>
    groups.map((g) => ({
      key: g.key,
      label: label(g.key),
      weight: g.avgPerNight,
      value: money(g.avgPerNight),
      hint: t("lodging:stats.money.nightsAndTotal", {
        count: g.nights,
        total: money(g.totalBase),
      }),
    }));

  const noPrices = price.pricedStays === 0;

  return (
    <section className="mt-8">
      <h2 className="mb-2 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
        {t("lodging:stats.money.title")}
      </h2>
      <p className="mb-6 text-sm" style={{ color: "var(--text-muted)" }}>
        {noPrices
          ? t("lodging:stats.money.noPrices")
          : t("lodging:stats.money.basis", {
              stays: price.pricedStays,
              nights: price.pricedNights,
              currency: baseCurrency,
            })}
        {price.unpricedStays > 0 && ` · ${t("lodging:stats.money.omitted", { count: price.unpricedStays })}`}
      </p>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          accent={LODGING_ACCENT}
          valueSize="md"
          title={t("lodging:stats.money.avgPerNight")}
          value={price.avgPricePerNight !== null ? money(price.avgPricePerNight) : "—"}
          description={t("lodging:stats.money.avgPerNightDesc")}
        />
        <StatCard
          accent={LODGING_ACCENT}
          valueSize="md"
          title={t("lodging:stats.money.medianPerNight")}
          value={price.medianPricePerNight !== null ? money(price.medianPricePerNight) : "—"}
          description={t("lodging:stats.money.medianPerNightDesc")}
        />
        <StatCard
          accent={LODGING_ACCENT}
          valueSize="md"
          title={t("lodging:stats.money.cheapest")}
          value={price.cheapestNight ? money(price.cheapestNight.pricePerNight) : "—"}
          description={
            price.cheapestNight
              ? `${price.cheapestNight.lodgingName}${
                  price.cheapestNight.city ? ` · ${price.cheapestNight.city}` : ""
                }`
              : t("lodging:stats.money.noPrices")
          }
        />
        <StatCard
          accent={LODGING_ACCENT}
          valueSize="md"
          title={t("lodging:stats.money.dearest")}
          value={price.dearestNight ? money(price.dearestNight.pricePerNight) : "—"}
          description={
            price.dearestNight
              ? `${price.dearestNight.lodgingName}${
                  price.dearestNight.city ? ` · ${price.dearestNight.city}` : ""
                }`
              : t("lodging:stats.money.noPrices")
          }
        />
      </div>

      {stats.awardNights > 0 && (
        <div className="mt-6">
          <StatCard
            accent={LODGING_ACCENT}
            valueSize="md"
            title={t("lodging:stats.money.awardValue")}
            value={price.awardNightsValue !== null ? money(price.awardNightsValue) : "—"}
            description={t("lodging:stats.money.awardValueDesc", { count: stats.awardNights })}
            footnote={t("lodging:stats.money.awardValueFootnote")}
          />
        </div>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RankedBarList
          title={t("lodging:stats.money.byYear")}
          accent={LODGING_ACCENT}
          rows={priceRows(price.byYear, (k) => k)}
          emptyLabel={t("lodging:stats.money.noPrices")}
        />
        <RankedBarList
          title={t("lodging:stats.money.byCountry")}
          accent={LODGING_ACCENT}
          rows={priceRows(price.byCountry, (k) => countryName(k, locale) || k)}
          emptyLabel={t("lodging:stats.money.noPrices")}
          limit={LIST_LIMIT}
          moreLabel={(hidden) => t("lodging:stats.more", { count: hidden })}
        />
        <RankedBarList
          title={t("lodging:stats.money.byChain")}
          accent={LODGING_ACCENT}
          rows={priceRows(price.byChain, (k) => k)}
          emptyLabel={t("lodging:stats.money.noChainPrices")}
          limit={LIST_LIMIT}
          moreLabel={(hidden) => t("lodging:stats.more", { count: hidden })}
        />
        <RankedBarList
          title={t("lodging:stats.money.byBoard")}
          accent={LODGING_ACCENT}
          rows={priceRows(price.byBoard, (k) => t(`lodging:board.${k}`, { defaultValue: k }))}
          emptyLabel={t("lodging:stats.money.noBoardPrices")}
        />
      </div>
    </section>
  );
}
