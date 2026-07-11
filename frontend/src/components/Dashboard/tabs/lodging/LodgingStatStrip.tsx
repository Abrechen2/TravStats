import type { CSSProperties, JSX } from "react";
import { useTranslation } from "../../../../hooks/useTranslation";
import { useSettingsStore } from "../../../../store/settingsStore";
import { formatCurrency } from "../../../../lib/units";
import type { LodgingStats } from "../../../../types/lodging";

interface LodgingStatStripProps {
  stats: LodgingStats;
}

const CELL_STYLE: CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 2,
  minWidth: 56,
};

/**
 * Floating stat strip (hotels / stays / nights / chains / spend / rating),
 * mirroring the mockup's screen-①/⑥ stat-strip row. Every number comes
 * straight from `GET /stats/lodging` — nothing here is recomputed from the
 * raw lodging/stay list, so it can't drift from the backend's own rollup.
 */
export function LodgingStatStrip({ stats }: LodgingStatStripProps): JSX.Element {
  const { t } = useTranslation(["dashboard"]);
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

  const cells: { key: string; value: string; label: string }[] = [
    {
      key: "hotels",
      value: String(stats.lodgingsCount),
      label: t("dashboard:lodgingTab.stats.hotels"),
    },
    {
      key: "stays",
      value: String(stats.staysCount),
      label: t("dashboard:lodgingTab.stats.stays"),
    },
    {
      key: "nights",
      value: String(stats.totalNights),
      label: t("dashboard:lodgingTab.stats.nights"),
    },
    {
      key: "chains",
      value: String(stats.chainsUnique),
      label: t("dashboard:lodgingTab.stats.chains"),
    },
    {
      key: "spend",
      value: formatCurrency(stats.spendBaseTotal, baseCurrency),
      label: t("dashboard:lodgingTab.stats.spend"),
    },
    { key: "rating", value: ratingLabel, label: t("dashboard:lodgingTab.stats.rating") },
  ];

  return (
    <div
      style={{
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
      }}
    >
      {cells.map((cell) => (
        <div key={cell.key} style={CELL_STYLE}>
          <strong style={{ fontSize: 16, color: "var(--text-primary)" }}>{cell.value}</strong>
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
        </div>
      ))}
    </div>
  );
}
