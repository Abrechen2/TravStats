import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";
import { useEnabledDomains } from "../../../hooks/useEnabledDomains";

export function PoiTab(): JSX.Element {
  const { t } = useTranslation(["dashboard"]);
  const { isEnabled } = useEnabledDomains();
  const enabled = isEnabled("poi");

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
        <div style={{ fontSize: 48, marginBottom: 16 }}>📍</div>
        <h2 style={{ margin: "0 0 8px", color: "var(--text-primary)" }}>
          {t("dashboard:poi.title")}
        </h2>
        <p style={{ color: "var(--text-muted)", margin: "0 0 24px" }}>
          {enabled ? t("dashboard:poi.enabledEmpty") : t("dashboard:poi.disabled")}
        </p>
        {!enabled && (
          <Link
            to="/settings#domains"
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
            {t("dashboard:poi.goToSettings")}
          </Link>
        )}
      </div>
    </div>
  );
}
