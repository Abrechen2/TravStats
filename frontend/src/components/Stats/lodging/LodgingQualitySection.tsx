import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { useSettingsStore } from "../../../store/settingsStore";
import { formatCurrency } from "../../../lib/units";
import { countryName } from "../../../lib/countryFlag";
import type { LodgingRatingGroup, LodgingStats } from "../../../types/lodging";
import StatCard from "../StatCard";
import RankedBarList, { type RankedRow } from "./RankedBarList";

const LODGING_ACCENT = "var(--domain-lodging, #d4778f)";
const LIST_LIMIT = 6;

interface Props {
  stats: LodgingStats;
}

/**
 * The user's own verdicts, which until now produced exactly one number (an
 * overall average) out of four stored columns.
 *
 * Breakfast gets its own card on purpose: it is the one thing a chain is
 * reliably good or bad at across countries, and averaging it into "overall"
 * threw that signal away.
 *
 * `byStars` is the star-vs-verdict comparison — what a category actually
 * delivered. It is rendered in scale order (1..5), never ranked, because it is
 * read along an axis.
 */
export default function LodgingQualitySection({ stats }: Props): JSX.Element {
  const { t, i18n } = useTranslation(["lodging", "stats"]);
  const baseCurrency = useSettingsStore((s) => s.baseCurrency);
  const { ratings } = stats;
  const locale = i18n.language.startsWith("en") ? "en" : "de";

  const score = (value: number | null): string => (value !== null ? `★ ${value.toFixed(1)}` : "—");
  const ratingRows = (
    groups: LodgingRatingGroup[],
    label: (key: string) => string,
  ): RankedRow[] =>
    groups.map((g) => ({
      key: g.key,
      label: label(g.key),
      weight: g.avgOverall,
      value: `★ ${g.avgOverall.toFixed(1)}`,
      hint: t("lodging:stats.quality.fromStays", { count: g.stays }),
    }));

  const nothingRated = ratings.ratedStays === 0;

  return (
    <section className="mt-8">
      <h2 className="mb-2 text-2xl font-bold" style={{ color: "var(--text-primary)" }}>
        {t("lodging:stats.quality.title")}
      </h2>
      <p className="mb-6 text-sm" style={{ color: "var(--text-muted)" }}>
        {nothingRated
          ? t("lodging:stats.quality.nothingRated")
          : t("lodging:stats.quality.basis", {
              rated: ratings.ratedStays,
              unrated: ratings.unratedStays,
            })}
      </p>

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          accent={LODGING_ACCENT}
          valueSize="md"
          title={t("lodging:stats.quality.overall")}
          value={score(ratings.avgOverall)}
          description={t("lodging:stats.quality.overallDesc", { count: ratings.ratedStays })}
        />
        <StatCard
          accent={LODGING_ACCENT}
          valueSize="md"
          title={t("lodging:stats.quality.room")}
          value={score(ratings.avgRoom)}
          description={t("lodging:stats.quality.roomDesc")}
        />
        <StatCard
          accent={LODGING_ACCENT}
          valueSize="md"
          title={t("lodging:stats.quality.breakfast")}
          value={score(ratings.avgBreakfast)}
          description={t("lodging:stats.quality.breakfastDesc")}
        />
        <StatCard
          accent={LODGING_ACCENT}
          valueSize="md"
          title={t("lodging:stats.quality.service")}
          value={score(ratings.avgService)}
          description={t("lodging:stats.quality.serviceDesc")}
        />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <RankedBarList
          title={t("lodging:stats.quality.byChain")}
          accent={LODGING_ACCENT}
          rows={ratingRows(ratings.byChain, (k) => k)}
          emptyLabel={t("lodging:stats.quality.nothingRated")}
          limit={LIST_LIMIT}
          moreLabel={(hidden) => t("lodging:stats.more", { count: hidden })}
        />
        <RankedBarList
          title={t("lodging:stats.quality.byCountry")}
          accent={LODGING_ACCENT}
          rows={ratingRows(ratings.byCountry, (k) => countryName(k, locale) || k)}
          emptyLabel={t("lodging:stats.quality.nothingRated")}
          limit={LIST_LIMIT}
          moreLabel={(hidden) => t("lodging:stats.more", { count: hidden })}
        />
        <RankedBarList
          title={t("lodging:stats.quality.byStars")}
          accent={LODGING_ACCENT}
          rows={ratingRows(ratings.byStars, (k) =>
            t("lodging:stats.quality.starLabel", { count: Number(k) })
          )}
          emptyLabel={t("lodging:stats.quality.noStars")}
        />
        <RankedBarList
          title={t("lodging:stats.quality.byType")}
          accent={LODGING_ACCENT}
          rows={ratingRows(ratings.byType, (k) => t(`lodging:type.${k}`, { defaultValue: k }))}
          emptyLabel={t("lodging:stats.quality.nothingRated")}
        />
      </div>

      {ratings.bestValue.length > 0 && (
        <div className="mt-6">
          <RankedBarList
            title={t("lodging:stats.quality.bestValue")}
            accent={LODGING_ACCENT}
            rows={ratings.bestValue.map((s) => ({
              key: s.lodgingId + s.pricePerNight,
              label: `${s.lodgingName}${s.city ? ` · ${s.city}` : ""}`,
              weight: s.valueScore,
              value: `★ ${s.ratingOverall.toFixed(1)} · ${formatCurrency(
                s.pricePerNight,
                baseCurrency
              )}`,
              hint: null,
            }))}
            emptyLabel={t("lodging:stats.quality.nothingRated")}
          />
        </div>
      )}
    </section>
  );
}
