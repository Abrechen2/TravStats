import type { CSSProperties, JSX } from "react";
import { useTranslation } from "../../../../hooks/useTranslation";
import { useSettingsStore } from "../../../../store/settingsStore";
import { formatCurrency } from "../../../../lib/units";
import type { LodgingStats } from "../../../../types/lodging";

interface LodgingCurrencyBreakdownProps {
  stats: LodgingStats;
}

const CARD_STYLE: CSSProperties = {
  position: "absolute",
  top: 70,
  right: 12,
  zIndex: 25,
  maxWidth: 280,
  padding: "10px 16px",
  borderRadius: 12,
  background: "rgba(22,27,34,0.9)",
  border: "1px solid var(--color-border)",
  color: "var(--text-primary)",
  fontSize: 12,
};

/**
 * Spend-by-currency breakdown, mockup screen ⑥. `stats.spendByCurrency` holds
 * the ORIGINAL amounts the user actually paid, grouped by the currency each
 * stay was billed in — it is NOT a conversion and must never be summed
 * across currencies (summing EUR + CHF is meaningless). `spendBaseTotal` is
 * shown separately as the backend's own converted headline figure.
 *
 * A stay whose ECB lookup failed on save contributes to `spendByCurrency`
 * but not to `spendBaseTotal` — so these numbers legitimately don't
 * reconcile. That's surfaced via a hint rather than hidden.
 */
export function LodgingCurrencyBreakdown({ stats }: LodgingCurrencyBreakdownProps): JSX.Element {
  const { t } = useTranslation(["dashboard"]);
  const baseCurrency = useSettingsStore((s) => s.baseCurrency);
  const entries = Object.entries(stats.spendByCurrency).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div style={CARD_STYLE} data-testid="lodging-currency-breakdown">
      <div
        style={{
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.04em",
          color: "var(--text-muted)",
          marginBottom: 6,
        }}
      >
        {t("dashboard:lodgingTab.currencyBreakdown.title")}
      </div>

      <div style={{ marginBottom: 6 }}>
        <span style={{ color: "var(--text-muted)" }}>
          {t("dashboard:lodgingTab.currencyBreakdown.baseLabel")}:{" "}
        </span>
        <strong>{formatCurrency(stats.spendBaseTotal, baseCurrency)}</strong>
      </div>

      {entries.length === 0 ? (
        <p style={{ margin: 0, color: "var(--text-muted)" }}>
          {t("dashboard:lodgingTab.currencyBreakdown.empty")}
        </p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none" }}>
          {entries.map(([currency, amount]) => (
            <li key={currency} style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "var(--text-muted)" }}>{currency}</span>
              <span>{formatCurrency(amount, currency)}</span>
            </li>
          ))}
        </ul>
      )}

      <p style={{ marginTop: 6, marginBottom: 0, fontSize: 10, color: "var(--text-muted)" }}>
        {t("dashboard:lodgingTab.currencyBreakdown.hint")}
      </p>
    </div>
  );
}
