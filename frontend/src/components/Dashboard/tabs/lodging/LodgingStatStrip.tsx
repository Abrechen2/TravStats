import type { CSSProperties, JSX } from "react";
import { useTranslation } from "../../../../hooks/useTranslation";
import { useSettingsStore } from "../../../../store/settingsStore";
import { formatCurrency } from "../../../../lib/units";
import { otherCurrencySpend } from "../../../../lib/lodgingFormat";
import type { LodgingStats } from "../../../../types/lodging";

export type LodgingStatStripVariant = "overlay" | "inline";

interface LodgingStatStripProps {
  stats: LodgingStats;
  /**
   * "overlay" (default) is the floating card used on the Dashboard map tab.
   * "inline" is a plain row above the list-page table, matching the
   * mockup's screen-① stat strip (no absolute positioning, a bottom
   * hairline instead of a card border).
   */
  variant?: LodgingStatStripVariant;
}

const OVERLAY_CELL_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  minWidth: 56,
};

const INLINE_CELL_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  minWidth: 64,
};

/**
 * Stat strip (hotels / stays / nights / chains / spend / rating), mirroring
 * the mockup's screen-①/⑥ stat-strip row. Every number comes straight from
 * `GET /stats/lodging` — nothing here is recomputed from the raw
 * lodging/stay list, so it can't drift from the backend's own rollup.
 * Shared between the Dashboard map tab (`variant="overlay"`) and the
 * `/lodging` list page (`variant="inline"`).
 */
export function LodgingStatStrip({ stats, variant = "overlay" }: LodgingStatStripProps): JSX.Element {
  const { t } = useTranslation(["dashboard", "lodging"]);
  // `spendBaseTotal` is computed by the backend in the user's actual base
  // currency (`UserSettings.baseCurrency`, ECB rate applied per stay's
  // check-in day) — NOT `units.currency`, which is an independent display
  // preference used elsewhere for flight-cost figures. Labeling this figure
  // with `units.currency` would show the correctly-computed number under the
  // wrong currency symbol whenever a user has changed that preference.
  const baseCurrency = useSettingsStore((s) => s.baseCurrency);
  const ratingLabel =
    stats.avgRatingOverall !== null
      ? `★ ${stats.avgRatingOverall.toFixed(1)}`
      : t("dashboard:lodgingTab.stats.noRating");
  const otherSpend = otherCurrencySpend(stats.spendByCurrency, stats.spendBaseTotal, baseCurrency);
  // Two different things can sit under this total, and they are not the same
  // sentence: money recorded in another currency and CONVERTED into this one,
  // versus money nothing could convert and that the total therefore omits. The
  // second used to go unsaid here while the lodging detail page said it — the
  // same figure, honest on one screen and silent on the other.
  const spendSubParts = [
    otherSpend
      ? t("dashboard:lodgingTab.stats.spendOtherCurrency", {
          orig: otherSpend.currencies.map(({ currency, amount }) => formatCurrency(amount, currency)).join(" + "),
          converted: formatCurrency(otherSpend.convertedTotal, baseCurrency),
        })
      : null,
    stats.spendUnconvertedStays > 0
      ? t("lodging:fx.omittedFromTotal", { count: stats.spendUnconvertedStays })
      : null,
  ].filter((part): part is string => part !== null);
  const spendSub = spendSubParts.length > 0 ? spendSubParts.join(" · ") : null;

  const cells: { key: string; value: string; label: string; sub?: string | null }[] = [
    {
      key: "hotels",
      value: String(stats.lodgingsCount),
      label: t("dashboard:lodgingTab.stats.hotels", { count: stats.lodgingsCount }),
    },
    {
      key: "stays",
      value: String(stats.staysCount),
      label: t("dashboard:lodgingTab.stats.stays", { count: stats.staysCount }),
    },
    {
      key: "nights",
      value: String(stats.totalNights),
      label: t("dashboard:lodgingTab.stats.nights", { count: stats.totalNights }),
    },
    {
      key: "chains",
      value: String(stats.chainsUnique),
      label: t("dashboard:lodgingTab.stats.chains", { count: stats.chainsUnique }),
    },
    {
      key: "spend",
      value: formatCurrency(stats.spendBaseTotal, baseCurrency),
      label: t("dashboard:lodgingTab.stats.spend"),
      sub: spendSub,
    },
    { key: "rating", value: ratingLabel, label: t("dashboard:lodgingTab.stats.rating") },
  ];

  const containerStyle: CSSProperties =
    variant === "overlay"
      ? {
          position: "absolute",
          top: 12,
          right: 12,
          zIndex: 25,
          display: "flex",
          gap: 18,
          flexWrap: "wrap",
          maxWidth: 560,
          padding: "10px 18px",
          borderRadius: 12,
          background: "rgba(22,27,34,0.9)",
          border: "1px solid var(--color-border)",
        }
      : {
          display: "flex",
          gap: 22,
          flexWrap: "wrap",
          padding: "12px 2px 16px",
          borderBottom: "1px solid var(--color-border)",
          marginBottom: 10,
        };
  const cellStyle = variant === "overlay" ? OVERLAY_CELL_STYLE : INLINE_CELL_STYLE;
  const valueFontSize = variant === "overlay" ? 16 : 20;

  return (
    <div style={containerStyle} data-testid="lodging-stat-strip" data-variant={variant}>
      {cells.map((cell) => (
        <div key={cell.key} style={cellStyle}>
          <strong
            style={{ fontSize: valueFontSize, color: "var(--text-primary)", fontVariantNumeric: "tabular-nums" }}
          >
            {cell.value}
          </strong>
          <span
            style={{
              fontSize: 10,
              textTransform: "uppercase",
              letterSpacing: "0.04em",
              color: "var(--text-muted)",
            }}
          >
            {cell.label}
          </span>
          {cell.sub && (
            <span
              data-testid="lodging-stat-strip-spend-sub"
              style={{ fontSize: 10, color: "var(--fx,#6ab7d8)", marginTop: 1 }}
            >
              {cell.sub}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
