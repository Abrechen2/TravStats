import type { JSX } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "../../../hooks/useTranslation";

/** "Einstellungen › Profil & Anmeldung" above the page title. */
export function SettingsBreadcrumb({ page }: { page: string }): JSX.Element {
  const { t } = useTranslation(["settings"]);
  return (
    <nav aria-label={t("settings:frame.breadcrumb")} data-settings-breadcrumb="">
      <ol className="t-caption flex flex-wrap items-center" style={{ gap: "var(--ts-space-xs)" }}>
        <li>
          <Link to="/settings" style={{ color: "var(--ts-muted)" }}>
            {t("settings:title")}
          </Link>
        </li>
        <li aria-hidden="true">›</li>
        <li aria-current="page" style={{ color: "var(--ts-text)" }}>
          {page}
        </li>
      </ol>
    </nav>
  );
}
