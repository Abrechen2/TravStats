import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import type { DashboardTab } from "../../../types/dashboard";

const TAB_ICON: Record<Exclude<DashboardTab, "all">, string> = {
  flight: "✈",
  cruise: "⚓",
  poi: "📍",
  lodging: "🏨",
};

/**
 * Full-tab placeholder shown when the user opens a dashboard tab whose
 * domain is disabled. Domain-gating rule: a disabled domain must not
 * render any of its content — this card is the only thing the tab shows
 * (same pattern as PoiTab's coming-soon stub).
 */
export function DomainDisabledNotice({
  domain,
}: {
  domain: Exclude<DashboardTab, "all">;
}): JSX.Element {
  const { t } = useTranslation(["dashboard"]);

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        height: "100%",
      }}
    >
      <div
        style={{
          maxWidth: 420,
          padding: 32,
          textAlign: "center",
          background: "rgba(15, 23, 42, 0.85)",
          border: "1px solid var(--color-border)",
          borderRadius: 16,
        }}
      >
        <div style={{ fontSize: 48, marginBottom: 16 }}>{TAB_ICON[domain]}</div>
        <h2 style={{ margin: "0 0 8px", color: "var(--text-primary)" }}>
          {t("dashboard:tabDisabled.title")}
        </h2>
        <p style={{ color: "var(--text-muted)", margin: "0 0 24px" }}>
          {t("dashboard:tabDisabled.body", {
            domain: t(`dashboard:tabStrip.tabs.${domain}`),
          })}
        </p>
        <Link
          to="/settings#modules"
          style={{
            display: "inline-block",
            padding: "10px 20px",
            background: "var(--accent)",
            color: "#0d1117",
            borderRadius: 10,
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          {t("dashboard:tabDisabled.goToSettings")}
        </Link>
      </div>
    </div>
  );
}
